import { WhatsAppConfig } from '../../models/WhatsAppConfig.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { MetaClient, PhoneAPI, createPhoneAPI } from '../meta/index.js';

export class WhatsAppConfigService {
  async getConfig(tenantId) {
    const config = await WhatsAppConfig.findOne({ tenantId });
    if (!config) return null;
    
    return {
      ...config.toObject(),
      accessToken: decrypt(config.accessTokenEnc),
      pin: config.pinEnc ? decrypt(config.pinEnc) : null,
    };
  }

  async saveConfig(tenantId, data) {
    const { accessToken, phoneNumberId, wabaId, businessAccountId, pin, ...rest } = data;
    
    const update = {
      ...rest,
      accessTokenEnc: encrypt(accessToken),
      pinEnc: pin ? encrypt(pin) : undefined,
    };
    
    const config = await WhatsAppConfig.findOneAndUpdate(
      { tenantId },
      { $set: update },
      { upsert: true, new: true, runValidators: true }
    );
    
    return config;
  }

  async verifyAndRegister(tenantId) {
    const config = await this.getConfig(tenantId);
    if (!config) throw new Error('WhatsApp not configured');
    
    const phoneAPI = createPhoneAPI(config.accessToken);
    
    const phoneInfo = await phoneAPI.verifyPhoneNumber(config.phoneNumberId, config.accessToken);
    
    let registered = config.isRegistered;
    if (!registered && config.pin) {
      const registerResult = await phoneAPI.registerPhoneNumber(config.phoneNumberId, config.accessToken, config.pin);
      registered = registerResult.success;
    }
    
    if (registered && config.wabaId) {
      try {
        await phoneAPI.subscribeWabaToApp(config.wabaId, config.accessToken);
      } catch (e) {
        console.warn('WABA subscription failed:', e.message);
      }
    }
    
    await WhatsAppConfig.findOneAndUpdate(
      { tenantId },
      { 
        $set: { 
          isRegistered: registered,
          displayPhoneNumber: phoneInfo.displayPhoneNumber,
          verifiedName: phoneInfo.verifiedName,
          qualityRating: phoneInfo.qualityRating,
          lastSyncAt: new Date(),
        } 
      }
    );
    
    return { ...config, ...phoneInfo, isRegistered: registered };
  }

  async updateQualityRating(tenantId) {
    const config = await this.getConfig(tenantId);
    if (!config) return null;
    
    const phoneAPI = createPhoneAPI(config.accessToken);
    const quality = await phoneAPI.getQualityRating(config.phoneNumberId, config.accessToken);
    
    await WhatsAppConfig.findOneAndUpdate(
      { tenantId },
      { $set: { qualityRating: quality, lastQualityCheckAt: new Date() } }
    );
    
    return quality;
  }

  async testConnection(tenantId) {
    try {
      const result = await this.verifyAndRegister(tenantId);
      return { success: true, ...result };
    } catch (error) {
      await WhatsAppConfig.findOneAndUpdate(
        { tenantId },
        { $set: { status: 'error' } }
      );
      return { success: false, error: error.message };
    }
  }
}

export const whatsAppConfigService = new WhatsAppConfigService();