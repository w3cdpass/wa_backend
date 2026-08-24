import axios from 'axios';
import { config } from '../../config/index.js';
import { AppError } from '../../middleware/errorHandler.js';

const META_API_VERSION = config.whatsapp.meta.apiVersion || 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

const META_ERROR_CODES = {
  131000: 'PARAMETER_ERROR',
  131001: 'ACCESS_DENIED',
  131002: 'INVALID_PHONE_NUMBER',
  131003: 'INVALID_TEMPLATE',
  131004: 'TEMPLATE_NOT_FOUND',
  131005: 'TEMPLATE_REJECTED',
  131006: 'TEMPLATE_PENDING',
  131007: 'MESSAGE_TOO_LONG',
  131008: 'MEDIA_DOWNLOAD_FAILED',
  131009: 'RATE_LIMITED',
  131026: 'OPT_OUT',
  131027: 'INVALID_NUMBER',
  131028: 'TEMPLATE_LIMIT_EXCEEDED',
  131029: 'QUALITY_DROP',
  131047: 'RE_ENGAGEMENT_FAILED',
  131051: 'MEDIA_TYPE_NOT_SUPPORTED',
  131052: 'MEDIA_SIZE_EXCEEDED',
  132000: 'BUSINESS_VERIFICATION_FAILED',
  132001: 'ACCOUNT_NOT_VERIFIED',
  133000: 'WEBHOOK_VERIFICATION_FAILED',
  133001: 'WEBHOOK_DELIVERY_FAILED',
  133005: 'PHONE_ALREADY_REGISTERED',
};

class MetaAPIError extends Error {
  constructor(message, code, subCode, httpStatus, data) {
    super(message);
    this.name = 'MetaAPIError';
    this.code = code;
    this.subCode = subCode;
    this.httpStatus = httpStatus;
    this.statusCode = httpStatus; // consumed by the global error handler
    this.data = data;
    this.isRetryable = [131009, 131026, 131047].includes(code);
    this.isPermanent = [131001, 131002, 131003, 131005, 131027, 132000].includes(code);
  }
}

function parseMetaError(error) {
  if (error.response?.data?.error) {
    const { message, code, error_subcode, fbtrace_id } = error.response.data.error;
    return new MetaAPIError(
      message,
      code,
      error_subcode,
      error.response.status,
      { fbtrace_id, ...error.response.data }
    );
  }
  if (error.response) {
    return new MetaAPIError(
      `Meta API error: ${error.response.status}`,
      error.response.status,
      null,
      error.response.status,
      error.response.data
    );
  }
  return new MetaAPIError(error.message || 'Unknown Meta API error', 'UNKNOWN', null, 500, {});
}

function getBackoffMs(attempt, baseMs = 1000) {
  return Math.min(baseMs * Math.pow(2, attempt) + Math.random() * 500, 30000);
}

export class MetaClient {
  constructor(accessToken) {
    this.accessToken = accessToken;
    this.client = axios.create({
      baseURL: META_API_BASE,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
    
    this.client.interceptors.request.use((req) => {
      if (this.accessToken) {
        req.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return req;
    });
  }

  setToken(token) {
    this.accessToken = token;
  }

  async request(method, path, data = null, options = {}) {
    const { retries = 3, idempotencyKey } = options;
    let lastError;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const headers = {};
        if (idempotencyKey) {
          headers['Idempotency-Key'] = idempotencyKey;
        }

        const response = await this.client.request({
          method,
          url: path,
          data,
          headers,
        });
        return response.data;
      } catch (error) {
        lastError = parseMetaError(error);
        
        if (lastError.isPermanent || attempt === retries) {
          throw lastError;
        }

        if (lastError.isRetryable || error.code === 'ECONNABORTED' || error.code === 'ENOTFOUND') {
          const backoff = getBackoffMs(attempt);
          console.warn(`Meta API retry ${attempt + 1}/${retries} after ${backoff}ms:`, lastError.message);
          await new Promise(r => setTimeout(r, backoff));
          continue;
        }

        throw lastError;
      }
    }
    
    throw lastError;
  }

  async get(path, options) {
    return this.request('GET', path, null, options);
  }

  async post(path, data, options) {
    return this.request('POST', path, data, options);
  }

  async delete(path, options) {
    return this.request('DELETE', path, null, options);
  }
}

export function createMetaClient(accessToken) {
  return new MetaClient(accessToken);
}

export { MetaAPIError, META_ERROR_CODES };