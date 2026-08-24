import { config } from '../../config/index.js';

const META_API_VERSION = config.whatsapp.meta.apiVersion || 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Meta requires an `example.header_handle` (from the Resumable Upload API)
 * for IMAGE/VIDEO/DOCUMENT headers — a plain URL is rejected at creation.
 * This uploads the bytes and returns the handle.
 */
async function readMetaError(res) {
  let body = '';
  try {
    const data = await res.json();
    body = data?.error?.message || JSON.stringify(data);
  } catch {
    try { body = await res.text(); } catch { /* ignore */ }
  }
  return body ? `${res.status} — ${body}` : String(res.status);
}

export async function uploadResumableMedia({ accessToken, fileName, mimeType, bytes }) {
  const appId = config.whatsapp.meta.appId;
  if (!appId) {
    const err = new Error(
      'META_APP_ID is not set in backend env — cannot pre-upload media handles (will fall back to public URL).'
    );
    err.code = 'NO_APP_ID';
    throw err;
  }

  const startParams = new URLSearchParams({
    file_name: fileName,
    file_length: String(bytes.byteLength),
    file_type: mimeType,
    access_token: accessToken,
  });

  const startRes = await fetch(`${META_API_BASE}/${appId}/uploads?${startParams.toString()}`, {
    method: 'POST',
  });
  if (!startRes.ok) {
    throw new Error(`Meta resumable upload start failed: ${await readMetaError(startRes)}`);
  }
  const startData = await startRes.json();
  if (!startData.id) throw new Error('Resumable upload did not return a session id.');

  const uploadRes = await fetch(`${META_API_BASE}/${startData.id}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${accessToken}`,
      file_offset: '0',
    },
    body: bytes,
  });
  if (!uploadRes.ok) {
    throw new Error(`Meta resumable upload failed: ${await readMetaError(uploadRes)}`);
  }
  const uploadData = await uploadRes.json();
  if (!uploadData.h) throw new Error('Resumable upload did not return a handle.');
  return { handle: uploadData.h };
}

const IMAGE_TYPES = ['image/jpeg', 'image/png'];
const IMAGE_MAX = 5 * 1024 * 1024;
const VIDEO_TYPES = ['video/mp4'];
const VIDEO_MAX = 30 * 1024 * 1024;

/**
 * Ensures template.headerHandle (or card.headerHandle) exists by
 * downloading headerMediaUrl and uploading to Meta. Image-only parity
 * with wacrm; video/doc follow same shape when Meta accepts them here.
 */
export async function ensureHeaderHandle(template, accessToken) {
  const targets = [];
  if (template.headerType && !['none', 'text'].includes(template.headerType)) {
    targets.push(template);
  }
  (template.cards || []).forEach((card) => targets.push(card));

  for (const target of targets) {
    const isCard = target !== template;
    const type = isCard ? 'image' : template.headerType;
    if (type !== 'image') continue;
    if (target.headerHandle || !target.headerMediaUrl) continue;

    let res;
    try {
      res = await fetch(target.headerMediaUrl, { redirect: 'follow', signal: AbortSignal.timeout(15000) });
    } catch {
      throw new Error('Could not fetch the header image URL. Make sure it is publicly reachable.');
    }
    if (!res.ok) {
      throw new Error(`Header image URL returned ${res.status}. It must be publicly reachable.`);
    }

    const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (contentType && !IMAGE_TYPES.includes(contentType)) {
      throw new Error(`Header images must be JPEG or PNG (got ${contentType}).`);
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength) throw new Error('Header image is empty.');
    if (bytes.byteLength > IMAGE_MAX) {
      throw new Error(
        `Header image is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is 5 MB.`
      );
    }

    const mimeType = IMAGE_TYPES.includes(contentType) ? contentType : 'image/jpeg';
    const { handle } = await uploadResumableMedia({
      accessToken,
      fileName: mimeType === 'image/png' ? 'header.png' : 'header.jpg',
      mimeType,
      bytes,
    });
    target.headerHandle = handle;
  }
}
