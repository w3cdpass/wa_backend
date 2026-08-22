import crypto from 'crypto';
import { config } from '../config/index.js';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getKey() {
  const key = config.encryption.key;
  if (key.length === 44 && key.endsWith('==')) {
    return Buffer.from(key, 'base64');
  }
  if (key.length === 32) {
    return Buffer.from(key, 'utf8');
  }
  return crypto.createHash('sha256').update(key).digest();
}

export function encrypt(text) {
  if (!text) return null;
  
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  const encrypted = Buffer.concat([
    cipher.update(text, 'utf8'),
    cipher.final()
  ]);
  
  const tag = cipher.getAuthTag();
  
  return Buffer.concat([iv, encrypted, tag]).toString('base64');
}

export function decrypt(encryptedText) {
  if (!encryptedText) return null;
  
  try {
    const key = getKey();
    const buffer = Buffer.from(encryptedText, 'base64');
    
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(buffer.length - TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH, buffer.length - TAG_LENGTH);
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    
    const decrypted = Buffer.concat([
      decipher.update(encrypted),
      decipher.final()
    ]);
    
    return decrypted.toString('utf8');
  } catch (error) {
    console.error('Decryption failed:', error.message);
    throw new Error('Failed to decrypt data');
  }
}

export function encryptObject(obj) {
  if (!obj) return null;
  return encrypt(JSON.stringify(obj));
}

export function decryptObject(encryptedText) {
  if (!encryptedText) return null;
  const decrypted = decrypt(encryptedText);
  return JSON.parse(decrypted);
}