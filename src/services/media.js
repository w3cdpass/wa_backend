import { Media } from '../models/index.js';
import { config } from '../config/index.js';
import { AppError } from '../middleware/errorHandler.js';
import crypto from 'crypto';

const ALLOWED_TYPES = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  video: ['video/mp4', 'video/quicktime'],
  pdf: ['application/pdf'],
};

const MAX_SIZES = {
  image: config.mediaLimits.image,
  video: config.mediaLimits.video,
  pdf: config.mediaLimits.pdf,
};

export const validateMediaFile = (file, mediaType) => {
  const allowed = ALLOWED_TYPES[mediaType];
  if (!allowed?.includes(file.mimetype)) {
    throw new AppError(`Invalid file type for ${mediaType}. Allowed: ${allowed.join(', ')}`, 400);
  }
  const maxSize = MAX_SIZES[mediaType];
  if (file.size > maxSize) {
    throw new AppError(`File too large. Max size for ${mediaType}: ${maxSize / 1024 / 1024}MB`, 400);
  }
};

export const generatePresignedUpload = async (tenantId, userId, fileName, fileType, fileSize, mediaType) => {
  const ext = fileName.split('.').pop().toLowerCase();
  const key = `uploads/${tenantId}/${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;

  const hasS3Config = config.storage.s3.accessKeyId && config.storage.s3.secretAccessKey && config.storage.s3.bucket;
  
  if (config.storage.provider === 's3' && hasS3Config) {
    return generateS3PresignedUrl(key, fileType, fileSize);
  }

  // Fallback: return a mock presigned URL for development
  return {
    uploadUrl: `/api/media/upload-direct?key=${encodeURIComponent(key)}`,
    fileUrl: `https://mock-storage.example.com/${key}`,
    fields: { key },
  };
};

async function generateS3PresignedUrl(key, contentType, fileSize) {
  const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
  const { getSignedUrl } = await import('@aws-sdk/s3-request-presigner');

  const client = new S3Client({
    region: config.storage.s3.region,
    endpoint: config.storage.s3.endpoint,
    credentials: {
      accessKeyId: config.storage.s3.accessKeyId,
      secretAccessKey: config.storage.s3.secretAccessKey,
    },
  });

  const command = new PutObjectCommand({
    Bucket: config.storage.s3.bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(client, command, { expiresIn: 3600 });
  const fileUrl = `${config.storage.s3.publicUrl}/${key}`;

  return { uploadUrl, fileUrl, fields: { key } };
}

export const saveMediaRecord = async (tenantId, userId, data) => {
  return Media.create({
    fileName: data.fileName,
    fileUrl: data.fileUrl,
    fileType: data.fileType,
    fileSize: data.fileSize,
    tenantId,
    userId,
  });
};

export const deleteMedia = async (tenantId, id) => {
  const media = await Media.findOne({ _id: id, tenantId });
  if (!media) throw new AppError('Media not found', 404);

  await Media.findByIdAndDelete(id);
  return { success: true };
};

export const listMedia = async (tenantId, filters = {}) => {
  const page = parseInt(filters.page || 1, 10);
  const limit = parseInt(filters.limit || 20, 10);
  const skip = (page - 1) * limit;

  const [media, total] = await Promise.all([
    Media.find({ tenantId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit),
    Media.countDocuments({ tenantId }),
  ]);

  return { media, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};