import { broadcastsService } from '../services/broadcasts.js';

export const createBroadcastController = async (req, res, next) => {
  try {
    const result = await broadcastsService.createAndSend(req.tenantId, req.userId, req.body);
    res.status(201).json({
      message: `Broadcast started for ${result.audienceCount} contact(s)`,
      broadcast: result.broadcast,
      audienceCount: result.audienceCount,
    });
  } catch (error) {
    next(error);
  }
};

export const previewCountController = async (req, res, next) => {
  try {
    const count = await broadcastsService.previewCount(req.tenantId, req.body.audience);
    res.json({ count });
  } catch (error) {
    next(error);
  }
};

export const listBroadcastsController = async (req, res, next) => {
  try {
    const result = await broadcastsService.list(req.tenantId, { page: req.query.page, limit: req.query.limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const getBroadcastController = async (req, res, next) => {
  try {
    const broadcast = await broadcastsService.getOne(req.tenantId, req.params.id);
    res.json(broadcast);
  } catch (error) {
    next(error);
  }
};

export const pauseBroadcastController = async (req, res, next) => {
  try {
    const broadcast = await broadcastsService.pause(req.tenantId, req.params.id);
    res.json({ message: 'Broadcast paused', broadcast });
  } catch (error) {
    next(error);
  }
};

export const resumeBroadcastController = async (req, res, next) => {
  try {
    const broadcast = await broadcastsService.resume(req.tenantId, req.params.id);
    res.json({ message: 'Broadcast resumed', broadcast });
  } catch (error) {
    next(error);
  }
};
