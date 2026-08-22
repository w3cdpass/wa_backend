const COUNTRY_CODES = {
  IN: 91, US: 1, GB: 44, CA: 1, AU: 61, DE: 49, FR: 33, ES: 34,
  IT: 39, BR: 55, MX: 52, AR: 54, CO: 57, PE: 51, CL: 56, ZA: 27,
  NG: 234, KE: 254, GH: 233, EG: 20, AE: 971, SA: 966, SG: 65,
  MY: 60, TH: 66, VN: 84, ID: 62, PH: 63, JP: 81, KR: 82, CN: 86,
  HK: 852, TW: 886, IL: 972, TR: 90, RU: 7, UA: 380, PL: 48,
  NL: 31, BE: 32, CH: 41, AT: 43, SE: 46, NO: 47, DK: 45, FI: 358,
  IE: 353, PT: 351, GR: 30, CZ: 420, HU: 36, RO: 40, BG: 359,
  HR: 385, SI: 386, SK: 421, LT: 370, LV: 371, EE: 372,
};

export function normalizePhone(phone, defaultCountry = 'IN') {
  if (!phone) return null;
  
  let cleaned = phone.replace(/[\s\-\(\)\+]/g, '');
  
  if (cleaned.startsWith('00')) {
    cleaned = cleaned.substring(2);
  }
  
  if (!cleaned.match(/^\d+$/)) return null;
  
  if (cleaned.length <= 10) {
    const code = COUNTRY_CODES[defaultCountry.toUpperCase()] || COUNTRY_CODES.IN;
    cleaned = code + cleaned;
  }
  
  if (cleaned.length > 15) return null;
  
  return cleaned;
}

export function formatE164(phone, defaultCountry = 'IN') {
  const normalized = normalizePhone(phone, defaultCountry);
  if (!normalized) return null;
  return '+' + normalized;
}

export function phoneVariants(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  
  const variants = new Set();
  variants.add(normalized);
  
  if (normalized.length > 10) {
    const withoutCountry = normalized.slice(-10);
    variants.add(withoutCountry);
    variants.add('0' + withoutCountry);
  }
  
  return Array.from(variants);
}

export function isValidE164(phone) {
  if (!phone) return false;
  const e164 = phone.startsWith('+') ? phone : '+' + phone;
  return /^\+[1-9]\d{1,14}$/.test(e164);
}

export function extractCountryCode(phone) {
  const e164 = phone.startsWith('+') ? phone : '+' + phone;
  for (let i = 1; i <= 4; i++) {
    const code = e164.substring(1, 1 + i);
    if (Object.values(COUNTRY_CODES).includes(parseInt(code))) {
      return code;
    }
  }
  return null;
}

export function getCountryFromPhone(phone) {
  const code = extractCountryCode(phone);
  if (!code) return null;
  return Object.keys(COUNTRY_CODES).find(k => COUNTRY_CODES[k] === parseInt(code)) || null;
}

export function formatForDisplay(phone) {
  const e164 = phone.startsWith('+') ? phone : '+' + phone;
  if (e164.length < 3) return e164;
  
  const countryCode = extractCountryCode(e164);
  if (!countryCode) return e164;
  
  const national = e164.substring(1 + countryCode.length);
  
  if (countryCode === '91' && national.length === 10) {
    return `+${countryCode} ${national.slice(0, 5)} ${national.slice(5)}`;
  }
  
  if (countryCode === '1' && national.length === 10) {
    return `+${countryCode} (${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
  }
  
  return `+${countryCode} ${national}`;
}