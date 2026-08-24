import { WhatsAppConfig } from '../../models/WhatsAppConfig.js';
import { encrypt, decrypt } from '../../utils/encryption.js';
import { MetaClient, PhoneAPI, createPhoneAPI } from '../meta/index.js';
import crypto from 'crypto';

export class WhatsAppConfigService {
  async getConfig(tenantId) {
    const config = await WhatsAppConfig.findOne({ tenantId });
    if (!config) return null;
    
    return {
      ...config.toObject(),
      accessToken: decrypt(config.accessTokenEnc),
      appSecret: config.appSecretEnc ? decrypt(config.appSecretEnc) : null,
      pin: config.pinEnc ? decrypt(config.pinEnc) : null,
    };
  }

  async saveConfig(tenantId, data) {
    const { accessToken, phoneNumberId, wabaId, businessAccountId, appSecret, pin } = data;

    const update = { status: 'pending' };
    if (accessToken) update.accessTokenEnc = encrypt(accessToken);
    if (phoneNumberId) update.phoneNumberId = phoneNumberId;
    const resolvedWabaId = wabaId || businessAccountId;
    if (resolvedWabaId) update.wabaId = resolvedWabaId;
    if (appSecret) update.appSecretEnc = encrypt(appSecret);
    if (pin) update.pinEnc = encrypt(pin);

    const config = await WhatsAppConfig.findOneAndUpdate(
      { tenantId },
      { $set: update, $setOnInsert: { verifyToken: crypto.randomBytes(16).toString('hex') } },
      { upsert: true, new: true, runValidators: true }
    );
    
    return config;
  }

  async getMaskedConfig(tenantId) {
    const config = await WhatsAppConfig.findOne({ tenantId }).select('-accessTokenEnc -pinEnc -appSecretEnc');
    if (!config) return null;
    return config;
  }

  async ensureVerifyToken(tenantId) {
    let config = await WhatsAppConfig.findOne({ tenantId });
    if (!config) throw new Error('WhatsApp not configured. Save your credentials first.');
    if (!config.verifyToken) {
      config.verifyToken = crypto.randomBytes(16).toString('hex');
      await config.save();
    }
    return config;
  }

  async disconnect(tenantId) {
    const config = await WhatsAppConfig.findOne({ tenantId });
    if (!config) throw new Error('WhatsApp not configured');
    await WhatsAppConfig.findOneAndUpdate(
      { tenantId },
      { $set: { status: 'disconnected', isRegistered: false } }
    );
    return { success: true };
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
          status: 'connected',
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