import { generatePresignedUpload, saveMediaRecord, deleteMedia, listMedia } from '../services/media.js';
import { validateMediaFile } from '../services/media.js';
import { AppError } from '../middleware/errorHandler.js';

export const presignUploadController = async (req, res, next) => {
  try {
    const { fileName, fileType, fileSize } = req.body;
    
    const mediaType = fileType.startsWith('image/') ? 'image' :
                      fileType.startsWith('video/') ? 'video' :
                      fileType === 'application/pdf' ? 'pdf' : 'none';
    
    if (mediaType !== 'none') {
      const mockFile = { mimetype: fileType, size: fileSize };
      validateMediaFile(mockFile, mediaType);
    }

    const result = await generatePresignedUpload(req.tenantId, req.user.id, fileName, fileType, fileSize, mediaType);
    res.json(result);
  } catch (error) {
    next(error);
  }
};

export const confirmUploadController = async (req, res, next) => {
  try {
    const { fileName, fileUrl, fileType, fileSize } = req.body;
    const media = await saveMediaRecord(req.tenantId, req.user.id, { fileName, fileUrl, fileType, fileSize });
    res.status(201).json(media);
  } catch (error) {
    next(error);
  }
};

export const deleteMediaController = async (req, res, next) => {
  try {
    await deleteMedia(req.tenantId, req.params.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

export const listMediaController = async (req, res, next) => {
  try {
    const { page, limit } = req.query;
    const result = await listMedia(req.tenantId, { page, limit });
    res.json(result);
  } catch (error) {
    next(error);
  }
};