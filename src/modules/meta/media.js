import { MetaClient } from './client.js';
import fs from 'fs';
import path from 'path';

export class MediaAPI {
  constructor(metaClient) {
    this.client = metaClient;
  }

  async uploadMedia({ phoneNumberId, accessToken, filePath, mimeType, fileName }) {
    const client = new MetaClient(accessToken);
    
    const formData = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    const blob = new Blob([fileBuffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', this.getMediaType(mimeType));

    const response = await client.post(`/${phoneNumberId}/media`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    return response;
  }

  async uploadMediaBuffer({ phoneNumberId, accessToken, buffer, mimeType, fileName }) {
    const client = new MetaClient(accessToken);
    
    const formData = new FormData();
    const blob = new Blob([buffer], { type: mimeType });
    formData.append('file', blob, fileName);
    formData.append('messaging_product', 'whatsapp');
    formData.append('type', this.getMediaType(mimeType));

    const response = await client.post(`/${phoneNumberId}/media`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });

    return response;
  }

  async getMediaUrl(mediaId, accessToken) {
    const client = new MetaClient(accessToken);
    const response = await client.get(`/${mediaId}`);
    return response.url;
  }

  async downloadMedia(mediaId, accessToken) {
    const client = new MetaClient(accessToken);
    const mediaInfo = await client.get(`/${mediaId}`);
    
    if (!mediaInfo.url) {
      throw new Error('Media URL not available');
    }

    const response = await axios.get(mediaInfo.url, {
      responseType: 'arraybuffer',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return {
      buffer: Buffer.from(response.data),
      contentType: response.headers['content-type'],
      contentLength: response.headers['content-length'],
    };
  }

  async deleteMedia(mediaId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.delete(`/${mediaId}`);
  }

  getMediaType(mimeType) {
    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (mimeType === 'application/pdf') return 'document';
    return 'document';
  }

  async createResumableUploadSession({ phoneNumberId, accessToken, fileLength, mimeType, fileName }) {
    const client = new MetaClient(accessToken);
    return client.post(`/${phoneNumberId}/media`, {
      messaging_product: 'whatsapp',
      file_length: fileLength,
      file_type: mimeType,
      file_name: fileName,
    }, { headers: { 'Content-Type': 'application/json' } });
  }

  async uploadResumableChunk({ uploadUrl, chunkBuffer, startByte, endByte, fileLength }) {
    const client = new MetaClient('');
    return client.post(uploadUrl, chunkBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Range': `bytes ${startByte}-${endByte}/${fileLength}`,
      },
    });
  }
}

export function createMediaAPI(accessToken) {
  const client = new MetaClient(accessToken);
  return new MediaAPI(client);
}