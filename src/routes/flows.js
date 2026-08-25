import { Router } from 'express';
import { Flow, FlowRun, Contact, Conversation, Template, WhatsAppConfig } from '../models/index.js';
import { WhatsAppConfigService } from '../modules/whatsapp/config.js';
import { flowEngine } from '../modules/whatsapp/flow.js';
import { AppError } from '../middleware/errorHandler.js';
import { createMessageAPI } from '../modules/meta/index.js';
import { authenticate } from '../middleware/auth.js';

const configService = new WhatsAppConfigService();
const router = Router();
router.use(authenticate);

// Save flow (create or update)
router.post('/', async (req, res, next) => {
  try {
    const { name, description, trigger, nodes, edges, status } = req.body;
    if (!name) throw new AppError('Flow name is required', 400);

    const flow = await Flow.findOneAndUpdate(
      { tenantId: req.tenantId, name },
      {
        $set: {
          name,
          description,
          trigger: trigger || { type: 'manual', config: {} },
          nodes: nodes || [],
          edges: edges || [],
          status: status || 'draft',
        },
      },
      { new: true, upsert: true },
    );

    res.json(flow);
  } catch (error) {
    next(error);
  }
});

// List flows
router.get('/', async (req, res, next) => {
  try {
    const flows = await Flow.find({ tenantId: req.tenantId })
      .sort({ updatedAt: -1 })
      .select('name description status trigger createdAt updatedAt');
    res.json({ flows });
  } catch (error) {
    next(error);
  }
});

// Get flow
router.get('/:id', async (req, res, next) => {
  try {
    const flow = await Flow.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!flow) throw new AppError('Flow not found', 404);
    res.json(flow);
  } catch (error) {
    next(error);
  }
});

// Delete flow
router.delete('/:id', async (req, res, next) => {
  try {
    await Flow.findOneAndDelete({ _id: req.params.id, tenantId: req.tenantId });
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Send flow to recipients — creates a FlowRun per recipient and sends the
// first node (which should be a send_template or send_buttons node).
router.post('/:id/send', async (req, res, next) => {
  try {
    const { recipients } = req.body; // ['919878261754', ...]
    if (!Array.isArray(recipients) || !recipients.length) {
      throw new AppError('Provide at least one recipient phone number', 400);
    }

    const flow = await Flow.findOne({ _id: req.params.id, tenantId: req.tenantId });
    if (!flow) throw new AppError('Flow not found', 404);

      const config = await configService.getConfig(req.tenantId);
      if (!config?.accessToken || !config?.phoneNumberId) {
      throw new AppError('WhatsApp not configured — save credentials first', 400);
    }

    const messageAPI = createMessageAPI(config.accessToken);
    const runs = [];

    for (const phone of recipients) {
      // Find or create contact
      let contact = await Contact.findOne({ tenantId: req.tenantId, phone: phone.replace(/\D/g, '') });
      if (!contact) {
        contact = await Contact.create({
          tenantId: req.tenantId,
          phone: phone.replace(/\D/g, ''),
          name: `Flow recipient ${phone}`,
          source: 'manual',
        });
      }

      // Find or create conversation
      let conversation = await Conversation.findOne({ tenantId: req.tenantId, contactId: contact._id });
      if (!conversation) {
        conversation = await Conversation.create({
          tenantId: req.tenantId,
          contactId: contact._id,
          phoneNumberId: config.phoneNumberId,
          status: 'open',
        });
      }

      // Get the first node (entry point)
      const startNode = flow.nodes[0];
      if (!startNode) throw new AppError('Flow has no nodes', 400);

      // Close any existing active runs for this contact
      await FlowRun.updateMany(
        { tenantId: req.tenantId, contactId: contact._id, status: { $in: ['running', 'paused'] } },
        { $set: { status: 'failed', error: 'Superseded by new run' } },
      );

      // Create FlowRun
      const run = await FlowRun.create({
        flowId: flow._id,
        tenantId: req.tenantId,
        contactId: contact._id,
        conversationId: conversation._id,
        currentNodeKey: startNode.nodeKey,
        status: 'running',
        variables: {},
      });

      // Execute the first node
      try {
        if (startNode.nodeType === 'send_template') {
          const template = await Template.findOne({
            tenantId: req.tenantId,
            name: startNode.config.templateName,
          });
          if (!template) throw new Error(`Template "${startNode.config.templateName}" not found`);

          const bodyParams = (template.sampleValues?.body || []).map((val) => ({
            type: 'text',
            text: String(val || ''),
          }));

          const result = await messageAPI.sendTemplate({
            phoneNumberId: config.phoneNumberId,
            to: contact.phone,
            templateName: template.name,
            language: template.language,
            components: bodyParams.length ? [{ type: 'body', parameters: bodyParams }] : [],
          });

          if (result.success) {
            await FlowRun.findByIdAndUpdate(run._id, {
              lastPromptNodeKey: startNode.nodeKey,
            });
          }
        } else if (startNode.nodeType === 'send_message') {
          await messageAPI.sendText({
            phoneNumberId: config.phoneNumberId,
            to: contact.phone,
            text: startNode.config.text || '',
          });
        } else if (startNode.nodeType === 'send_buttons') {
          const buttons = (startNode.config.buttons || []).map(b => ({
            id: b.replyId,
            title: b.title,
          }));
          await messageAPI.sendInteractive({
            phoneNumberId: config.phoneNumberId,
            to: contact.phone,
            type: 'button',
            body: startNode.config.body || '',
            header: startNode.config.header,
            footer: startNode.config.footer,
            action: buttons,
          });
        }

        runs.push({ contactId: contact._id, phone: contact.phone, runId: run._id, status: 'sent' });
      } catch (sendError) {
        await FlowRun.findByIdAndUpdate(run._id, { status: 'failed', error: sendError.message });
        runs.push({ contactId: contact._id, phone: contact.phone, runId: run._id, status: 'failed', error: sendError.message });
      }
    }

    res.json({ success: true, runs });
  } catch (error) {
    next(error);
  }
});

// Get flow run status
router.get('/runs/:id', async (req, res, next) => {
  try {
    const run = await FlowRun.findOne({ _id: req.params.id, tenantId: req.tenantId })
      .populate('contactId', 'phone name')
      .populate('flowId', 'name');
    if (!run) throw new AppError('Flow run not found', 404);
    res.json(run);
  } catch (error) {
    next(error);
  }
});

// List flow runs for a flow
router.get('/:id/runs', async (req, res, next) => {
  try {
    const runs = await FlowRun.find({ flowId: req.params.id, tenantId: req.tenantId })
      .populate('contactId', 'phone name')
      .sort({ createdAt: -1 });
    res.json({ runs });
  } catch (error) {
    next(error);
  }
});

export default router;
