import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  tenantId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tenant', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  contactId: { type: mongoose.Schema.Types.ObjectId, ref: 'Contact', required: true },
  direction: { type: String, enum: ['inbound', 'outbound'], required: true },
  contentType: { type: String, enum: ['text', 'image', 'document', 'audio', 'video', 'location', 'template', 'interactive', 'contacts', 'sticker', 'reaction'], required: true },
  contentText: String,
  mediaUrl: String,
  mediaType: String,
  mediaSize: Number,
  mediaCaption: String,
  metaMessageId: { type: String, sparse: true },
  status: { type: String, enum: ['pending', 'sent', 'delivered', 'read', 'failed', 'deleted'], default: 'pending' },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'Template' },
  templateParams: { type: mongoose.Schema.Types.Mixed, default: {} },
  interactiveReplyId: String,
  errorCode: String,
  errorMessage: String,
  sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  isFromFlow: { type: Boolean, default: false },
  flowRunId: { type: mongoose.Schema.Types.ObjectId, ref: 'FlowRun' },
  context: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ tenantId: 1, direction: 1, createdAt: -1 });
messageSchema.index({ metaMessageId: 1 }, { unique: true, sparse: true });
messageSchema.index({ contactId: 1, createdAt: -1 });
messageSchema.index({ templateId: 1 });
messageSchema.index({ flowRunId: 1 });

export const Message = mongoose.model('Message', messageSchema);
export default Message;