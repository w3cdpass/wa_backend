// Template approval-readiness checker based on Meta's template guidelines and
// WATI's published best practices:
// - Correct category (Meta may auto-reclassify UTILITY -> MARKETING and bill accordingly)
// - Clear, complete messages (no vague one-liners)
// - Correct variable formatting ({{1}}, no spaces/special chars, never whole message in a var)
// - No shortened URLs, no requests for sensitive info, no threatening language
// - Content language must match the selected language
// - Sample values for every variable, representative media examples
export const checkTemplateCompliance = (t) => {
  const errors = [];
  const warnings = [];
  const tips = [];

  const body = String(t.bodyText || '');
  const footer = String(t.footerText || '');
  const buttons = Array.isArray(t.buttons) ? t.buttons : [];
  const cards = Array.isArray(t.cards) ? t.cards : [];
  const category = t.category || 'MARKETING';
  const language = t.language || 'en_US';
  const samples = t.sampleValues || {};
  const bodySampleList = Array.isArray(samples.body) ? samples.body : [];
  const headerSampleList = Array.isArray(samples.header) ? samples.header : [];
  const allText = [body, footer, ...cards.map((c) => c?.bodyText || '')].join('\n');

  // ---- Variables -----------------------------------------------------------
  const openCount = (body.match(/\{\{/g) || []).length;
  const closeCount = (body.match(/\}\}/g) || []).length;
  if (openCount !== closeCount) {
    errors.push({ code: 'unbalanced_braces', message: 'Unbalanced curly braces in the body text. Every variable must look like {{1}}.' });
  }
  const badTokens = (body.match(/\{\{[^}]*\}\}/g) || []).filter((tok) => !/^\{\{\s*\d+\s*\}\}$/.test(tok));
  if (badTokens.length) {
    errors.push({
      code: 'malformed_variable',
      message: `Invalid variable format: ${badTokens.join(', ')}. Use double curly braces with a number only, e.g. {{1}} — no spaces or special characters.`,
    });
  }

  const varIndices = (body.match(/\{\{\s*(\d+)\s*\}\}/g) || [])
    .map((tok) => parseInt(tok.replace(/\D/g, ''), 10))
    .filter((n) => Number.isFinite(n));
  const maxPos = varIndices.length ? Math.max(...varIndices) : 0;

  if (varIndices.length === 1 && body.replace(/\{\{\s*\d+\s*\}\}/g, '').replace(/[^A-Za-z\u00C0-\u024F\u0900-\u097F]/g, '').trim().length < 10) {
    errors.push({
      code: 'whole_message_variable',
      message: 'The entire message is inside one variable. Reviewers cannot tell what you send — keep fixed text around variables.',
    });
  }

  const missingSamples = [];
  for (let i = 1; i <= maxPos; i += 1) {
    if (!String(bodySampleList[i - 1] || '').trim()) missingSamples.push(`{{${i}}}`);
  }
  if (missingSamples.length) {
    errors.push({
      code: 'missing_samples',
      message: `Add realistic sample values for ${missingSamples.join(', ')}. Meta rejects templates with empty placeholders during review.`,
    });
  }
  const headerVars = t.headerType === 'text' ? ((String(t.headerContent || '').match(/\{\{\s*(\d+)\s*\}\}/g) || []).map((tok) => parseInt(tok.replace(/\D/g, ''), 10))) : [];
  const missingHeaderSamples = headerVars.filter((i) => !String(headerSampleList[i - 1] || '').trim());
  if (missingHeaderSamples.length) {
    errors.push({
      code: 'missing_header_samples',
      message: `Add sample values for header variable(s) ${missingHeaderSamples.map((i) => `{{${i}}}`).join(', ')}.`,
    });
  }

  // ---- Formatting hygiene --------------------------------------------------
  if (/[ \t]{2,}/.test(body)) {
    warnings.push({ code: 'extra_whitespace', message: 'Body contains tabs or multiple consecutive spaces. Clean spacing avoids formatting-related rejections.' });
  }

  const capsWords = body.match(/\b[A-Z]{5,}\b/g) || [];
  const allowedCaps = /^(OTP|COD|GST|RTO|ND|FREE|NOW|BUY)$/;
  const realCaps = capsWords.filter((w) => !allowedCaps.test(w));
  if (realCaps.length >= 3) {
    warnings.push({ code: 'excessive_caps', message: `${realCaps.length} ALL-CAPS words (${[...new Set(realCaps)].slice(0, 5).join(', ')}…). Shouting reads as spam to reviewers — use normal capitalisation.` });
  }

  const emojiCount = (body.match(/\p{Extended_Pictographic}/gu) || []).length;
  if (emojiCount > 4) {
    tips.push({ code: 'many_emojis', message: `${emojiCount} emojis used. A couple is fine; walls of emojis often fail review.` });
  }

  // ---- Shortened URLs ------------------------------------------------------
  const SHORTENER_HOSTS = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'is.gd', 'cutt.ly', 'rb.gy', 'shorturl.at', 'tiny.cc', 'rebrand.ly', 'ow.ly', 'buff.ly', 'bit.do', 's.id', 'lnkd.in'];
  const urlTargets = [
    ...buttons.filter((b) => b?.url).map((b) => ({ label: b.text || 'button', url: b.url })),
    ...cards.flatMap((c) => (c?.buttons || []).filter((b) => b?.url).map((b) => ({ label: b.text || 'card button', url: b.url }))),
  ];
  for (const target of urlTargets) {
    let host = '';
    try { host = new URL(target.url).hostname.toLowerCase(); } catch { /* non-URL string */ }
    if (SHORTENER_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) {
      errors.push({
        code: 'shortened_url',
        message: `"${target.label}" uses the shortener ${host}. Meta hides nothing — use the full destination URL (e.g. https://yourbrand.com/orders/12345).`,
      });
    }
  }
  const bodyLinks = body.match(/https?:\/\/\S+/g) || [];
  for (const link of bodyLinks) {
    let host = '';
    try { host = new URL(link).hostname.toLowerCase(); } catch { /* skip */ }
    if (SHORTENER_HOSTS.some((s) => host === s || host.endsWith(`.${s}`))) {
      errors.push({ code: 'shortened_url_body', message: `Shortened link ${host} found in the body text. Replace it with the full URL.` });
    }
  }

  // ---- Sensitive information ----------------------------------------------
  const SENSITIVE_NOUNS = /\b(password|passwd|cvv|cvc|credit card|debit card|bank account|account number|card number|otp|one[- ]time (code|password)|pin|ssn|aadhaar|aadhar|upi pin)\b/i;
  const REQUEST_VERBS = /\b(reply|respond|send|share|provide|enter|confirm|give|tell|type)\b/i;
  const sentences = body.split(/[.!?\n]+/).filter(Boolean);
  const riskySentences = sentences.filter((s) => SENSITIVE_NOUNS.test(s) && REQUEST_VERBS.test(s));
  if (riskySentences.length) {
    errors.push({
      code: 'sensitive_info_request',
      message: `Never ask customers to share sensitive details ("${riskySentences[0].trim().slice(0, 80)}…"). WhatsApp policy forbids requesting passwords, card numbers, CVV, OTPs or bank details.`,
    });
  }

  // ---- Threatening / pressure language ------------------------------------
  const THREATS = /(act now or|respond immediately or|reply immediately or|final warning|account will be (suspended|closed|blocked)|legal action)/i;
  if (THREATS.test(allText)) {
    warnings.push({ code: 'threat_language', message: 'Threatening or high-pressure wording detected ("respond or your account will be suspended"). Professional, neutral tone passes review far more reliably.' });
  }

  // ---- Category vs content -------------------------------------------------
  const PROMO_MARKETS = /(\d+\s*%\s*off|% off|discount|sale\b|special offer|limited (time|period|offer)|coupon|promo(\s*code)?|buy now|shop now|order now|hurry|flash sale|clearance|best price|save \d+|free gift|exclusive deal)/i;
  if (category === 'UTILITY' && PROMO_MARKETS.test(allText)) {
    warnings.push({
      code: 'utility_reclassification',
      message: 'Promotional wording in a UTILITY template. Since Apr 2025 Meta auto-reclassifies it as MARKETING before approval — you pay marketing rates per message. Move offers to a MARKETING template or remove promotional phrases.',
    });
  }
  if (category === 'UTILITY' && !/\{\{\s*\d+\s*\}\}/.test(body) && !/(order|booking|appointment|payment|invoice|refund|shipment|delivery|ticket|transaction|account|opt)/i.test(body)) {
    tips.push({
      code: 'utility_context',
      message: 'UTILITY templates should be triggered by a customer action and reference specifics (order number, appointment date, refund amount). Generic updates risk reclassification.',
    });
  }
  if (category === 'AUTHENTICATION') {
    const hasCodeButton = buttons.some((b) => ['COPY_CODE', 'OTP'].includes(b.type));
    if (!hasCodeButton) {
      errors.push({ code: 'auth_needs_code_button', message: 'AUTHENTICATION templates require a Copy code or One-tap autofill button so the OTP can be delivered.' });
    }
    if (!/\{\{\s*\d+\s*\}\}/.test(body)) {
      errors.push({ code: 'auth_needs_code_variable', message: 'AUTHENTICATION body must include a variable for the verification code, e.g. "{{1}} is your login code."' });
    }
  }
  if (category === 'MARKETING' && !/(stop|unsubscribe|opt ?out|cancel)/i.test(footer)) {
    tips.push({
      code: 'marketing_optout',
      message: 'Marketing templates should offer an opt-out. Adding a footer like "Reply STOP to unsubscribe" improves approval odds and protects quality rating.',
    });
  }

  // ---- Message clarity -----------------------------------------------------
  const trimmed = body.trim();
  const GENERIC_ONLY = /^(congratulations+|congrats|thank you|thanks|tell us what you think|hello|hi|hey)[\s!.]*$/i;
  if (!trimmed) {
    errors.push({ code: 'empty_body', message: 'Body text is required.' });
  } else if (trimmed.length < 25 || GENERIC_ONLY.test(trimmed)) {
    warnings.push({
      code: 'vague_message',
      message: 'Message looks too vague. Say why the customer is receiving it — e.g. "Congratulations! Your order {{1}} has been confirmed." beats a bare "Congratulations!".',
    });
  }
  if (category === 'MARKETING' && !PROMO_MARKETS.test(allText) && !/(offer|launch|new|invite|event|update|news|back in stock)/i.test(allText)) {
    tips.push({ code: 'marketing_purposeless', message: 'This MARKETING template has no clear offer or announcement. Reviewers approve messages whose purpose is obvious.' });
  }

  // ---- Language match ------------------------------------------------------
  const SCRIPTS = {
    hi: [0x0900, 0x097f], mr: [0x0900, 0x097f], ne: [0x0900, 0x097f],
    ar: [0x0600, 0x06ff], ur: [0x0600, 0x06ff], fa: [0x0600, 0x06ff],
    bn: [0x0980, 0x09ff], ta: [0x0b80, 0x0bff], te: [0x0c00, 0x0c7f],
    kn: [0x0c80, 0x0cff], ml: [0x0d00, 0x0d7f], gu: [0x0a80, 0x0aff],
    pa: [0x0a00, 0x0a7f], ru: [0x0400, 0x04ff], uk: [0x0400, 0x04ff],
    zh: [0x4e00, 0x9fff], ja: [0x3040, 0x30ff], ko: [0xac00, 0xd7af],
  };
  const langPrefix = language.split('_')[0];
  const letters = body.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 8) {
    let inScript = 0;
    let totalLetters = 0;
    if (SCRIPTS[langPrefix]) {
      const [lo, hi] = SCRIPTS[langPrefix];
      for (const ch of letters) {
        totalLetters += 1;
        const cp = ch.codePointAt(0);
        if (cp >= lo && cp <= hi) inScript += 1;
      }
      if (totalLetters && inScript / totalLetters < 0.5) {
        warnings.push({
          code: 'language_mismatch',
          message: `Selected language "${language}" but the text does not appear to be written in it. Meta reviews in the chosen language — write everything in ${language}, or create separate templates per language.`,
        });
      }
    } else {
      // Latin-script languages: flag dominance of other scripts
      for (const ch of letters) {
        totalLetters += 1;
        const cp = ch.codePointAt(0);
        if (!(cp >= 0x41 && cp <= 0x52a)) inScript += 1; // anything beyond Latin/Greek/Cyrillic-ish block start
      }
      const nonLatin = totalLetters ? 1 - (letters.match(/[\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}]/gu)?.length / totalLetters) : 0;
      if (nonLatin > 0.5) {
        warnings.push({
          code: 'language_mismatch',
          message: `Most of the text is not in Latin script but language is "${language}". Pick the matching language or rewrite the content to avoid rejection.`,
        });
      }
    }
  }

  // ---- Media ----------------------------------------------------------------
  const needsMedia = t.headerType && ['image', 'video', 'document'].includes(t.headerType);
  if (needsMedia && !t.headerHandle && !t.headerMediaUrl) {
    warnings.push({ code: 'media_example_missing', message: 'Media header selected but no example media uploaded yet — it uploads automatically when you submit. Keep it ready.' });
  }

  // ---- Standing advice -------------------------------------------------------
  tips.push({ code: 'submit_early', message: 'Meta review usually completes within minutes to a few hours (worst case 24 h), and pending templates are locked. Submit at least 24 h before your campaign.' });

  return { passed: errors.length === 0, errors, warnings, tips };
};

export default checkTemplateCompliance;
