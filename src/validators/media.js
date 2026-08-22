import { z } from 'zod';

export const presignUploadSchema = z.object({
  body: z.object({
    fileName: z.string().min(1, 'File name is required'),
    fileType: z.string().min(1, 'File type is required'),
    fileSize: z.number().int().positive('File size is required'),
  }),
});

export const deleteMediaSchema = z.object({
  params: z.object({
    id: z.string().min(1),
  }),
});