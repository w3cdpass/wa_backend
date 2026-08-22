import { MetaClient, MetaAPIError } from './client.js';

export class PhoneAPI {
  constructor(metaClient) {
    this.client = metaClient;
  }

  async getPhoneInfo(phoneNumberId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.get(`/${phoneNumberId}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status`);
  }

  async verifyPhoneNumber(phoneNumberId, accessToken) {
    const info = await this.getPhoneInfo(phoneNumberId, accessToken);
    return {
      id: info.id,
      displayPhoneNumber: info.display_phone_number,
      verifiedName: info.verified_name,
      qualityRating: info.quality_rating,
      codeVerificationStatus: info.code_verification_status,
    };
  }

  async registerPhoneNumber(phoneNumberId, accessToken, pin) {
    const client = new MetaClient(accessToken);
    try {
      const result = await client.post(`/${phoneNumberId}/register`, {
        messaging_product: 'whatsapp',
        pin,
      });
      return {
        success: true,
        alreadyRegistered: false,
        data: result,
      };
    } catch (error) {
      if (error.code === 133005 && error.message?.toLowerCase().includes('already registered')) {
        return { success: true, alreadyRegistered: true };
      }
      throw error;
    }
  }

  async subscribeWabaToApp(wabaId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.post(`/${wabaId}/subscribed_apps`, {});
  }

  async getSubscribedApps(wabaId, accessToken) {
    const client = new MetaClient(accessToken);
    return client.get(`/${wabaId}/subscribed_apps`);
  }

  async getQualityRating(phoneNumberId, accessToken) {
    const info = await this.getPhoneInfo(phoneNumberId, accessToken);
    return info.quality_rating;
  }

  async setWebhookUrl(phoneNumberId, accessToken, webhookUrl) {
    const client = new MetaClient(accessToken);
    return client.post(`/${phoneNumberId}`, {
      webhook_url: webhookUrl,
    });
  }
}

export function createPhoneAPI(accessToken) {
  const client = new MetaClient(accessToken);
  return new PhoneAPI(client);
}