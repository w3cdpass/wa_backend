import { config } from '../../config/index.js';

const META_API_VERSION = config.whatsapp.meta.apiVersion || 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// Meta no longer accepts plain URLs for media-header samples at template
// creation — example.header_handle MUST come from the Resumable Upload API,
// which requires a Meta App ID.
const MEDIA_SPECS = {
  image: {
    mimes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * 1024 * 1024,
    label: 'JPEG or PNG, max 5 MB',
    extFor: (mime) => (mime === 'image/png' ? '.png' : '.jpg'),
  },
  video: {
    mimes: ['video/mp4'],
    maxBytes: 16 * 1024 * 1024,
    label: 'MP4, max 16 MB',
    extFor: () => '.mp4',
  },
  document: {
    mimes: ['application/pdf'],
    maxBytes: 100 * 1024 * 1024,
    label: 'PDF, max 100 MB',
    extFor: () => '.pdf',
  },
};

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
    throw new Error(
      'META_APP_ID is not configured on this server. Media headers (image/video/document) require uploading the sample to Meta via its Resumable Upload API, which needs a Meta App ID. Add META_APP_ID to the backend environment variables.'
    );
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

/**
 * Ensures template.headerHandle (and each carousel card's headerHandle)
 * exists by downloading headerMediaUrl and uploading the bytes to Meta.
 * Throws precise, user-fixable errors — Meta rejects templates whose sample
 * asset cannot be verified, so failing early beats a doomed submission.
 */
export async function ensureHeaderHandle(template, accessToken) {
  const targets = [];
  if (template.headerType && !['none', 'text'].includes(template.headerType)) {
    targets.push({ ref: template, type: template.headerType });
  }
  (template.cards || []).forEach((card) => targets.push({ ref: card, type: 'image' }));

  for (const { ref: target, type } of targets) {
    if (!MEDIA_SPECS[type]) continue;
    if (target.headerHandle || !target.headerMediaUrl) continue;

    const spec = MEDIA_SPECS[type];

    let res;
    try {
      res = await fetch(target.headerMediaUrl, { redirect: 'follow', signal: AbortSignal.timeout(20000) });
    } catch {
      throw new Error(
        `Could not download the ${type} from "${target.headerMediaUrl}". Check the URL — it must be complete and publicly reachable.`
      );
    }
    if (!res.ok) {
      throw new Error(
        `The ${type} URL "${target.headerMediaUrl}" returned HTTP ${res.status}. Fix the URL (it looks truncated or expired) and try again.`
      );
    }

    let contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const urlPath = (() => {
      try { return new URL(target.headerMediaUrl).pathname.toLowerCase(); } catch { return ''; }
    })();

    // Some CDNs serve generic content types — infer from the extension.
    if (!spec.mimes.includes(contentType)) {
      if (urlPath.endsWith('.jpg') || urlPath.endsWith('.jpeg')) contentType = 'image/jpeg';
      else if (urlPath.endsWith('.png')) contentType = 'image/png';
      else if (urlPath.endsWith('.mp4')) contentType = 'video/mp4';
      else if (urlPath.endsWith('.pdf')) contentType = 'application/pdf';
    }

    if (!spec.mimes.includes(contentType)) {
      throw new Error(
        `The ${type} header must be ${spec.label} (got "${contentType || 'unknown type'}" from "${target.headerMediaUrl}").`
      );
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.byteLength) throw new Error(`The ${type} at "${target.headerMediaUrl}" is empty.`);
    if (bytes.byteLength > spec.maxBytes) {
      throw new Error(
        `The ${type} is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB — Meta's limit is ${(spec.maxBytes / 1024 / 1024).toFixed(0)} MB (${spec.label}).`
      );
    }

    const { handle } = await uploadResumableMedia({
      accessToken,
      fileName: `header${spec.extFor(contentType)}`,
      mimeType: contentType,
      bytes,
    });
    target.headerHandle = handle;
  }
}
