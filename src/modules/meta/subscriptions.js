import { createMetaClient } from './client.js';

// Webhook subscription management — lets tenants enable instant template
// status updates (APPROVED/REJECTED) from inside the app, using the access
// token already stored in their WhatsApp settings. No Meta dashboard needed.

export async function listSubscribedApps(wabaId, accessToken) {
  const client = createMetaClient(accessToken);
  const res = await client.get(`/${wabaId}/subscribed_apps`);
  return res?.data || [];
}

export async function subscribeAppToWaba(wabaId, accessToken) {
  const client = createMetaClient(accessToken);
  // Subscribing without a field list subscribes to ALL webhook events for
  // this WABA, including message_template_status_update.
  const res = await client.post(`/${wabaId}/subscribed_apps`, {});
  return res; // { success: true }
}

export async function unsubscribeAppFromWaba(wabaId, accessToken, appId) {
  const client = createMetaClient(accessToken);
  const res = await client.delete(`/${wabaId}/subscribed_apps/${appId}`);
  return res;
}
