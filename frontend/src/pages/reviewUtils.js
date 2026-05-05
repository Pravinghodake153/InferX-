/**
 * Review & Correct — Masking Utilities
 * Handles PII token creation, auto-increment, and text masking/unmasking.
 */

export const MASK_TYPES = [
  { id: 'NAME', label: 'Name', example: '<NAME_1>' },
  { id: 'ORG', label: 'Organization', example: '<ORG_1>' },
  { id: 'GST', label: 'GSTIN', example: '<GST_1>' },
  { id: 'PAN', label: 'PAN', example: '<PAN_1>' },
  { id: 'PHONE', label: 'Phone', example: '<PHONE_1>' },
  { id: 'EMAIL', label: 'Email', example: '<EMAIL_1>' },
  { id: 'AADHAAR', label: 'Aadhaar', example: '<AADHAAR_1>' },
  { id: 'VOTER_ID', label: 'Voter ID', example: '<VOTER_ID_1>' },
  { id: 'DL', label: 'Driving License', example: '<DL_1>' },
  { id: 'PASSPORT', label: 'Passport', example: '<PASSPORT_1>' },
  { id: 'BANK_ACC', label: 'Bank Account', example: '<BANK_ACC_1>' },
  { id: 'IFSC', label: 'IFSC Code', example: '<IFSC_1>' },
  { id: 'ADDRESS', label: 'Address', example: '<ADDR_1>' },
  { id: 'PIN_CODE', label: 'PIN Code', example: '<PIN_CODE_1>' },
  { id: 'CUSTOM', label: 'Custom', example: '<CUSTOM_1>' },
];

/**
 * Create a new mask token for a given type.
 * @param {string} type - e.g. 'ORG'
 * @param {Object} counters - current counters { ORG: 2, NAME: 1, ... }
 * @returns {{ token: string, newCounters: Object }}
 */
export function createMaskToken(type, counters) {
  const safeCounters = counters || {};
  const prefix = type === 'ADDRESS' ? 'ADDR' : type;
  const count = (safeCounters[type] || 0) + 1;
  const token = `<${prefix}_${count}>`;
  return { token, newCounters: { ...safeCounters, [type]: count } };
}

/**
 * Automatically detect PII in text using regex patterns.
 * @param {string} text - The full document text to scan
 * @param {Object} currentMasks - Existing manual masks
 * @param {Object} currentCounters - Existing mask counters
 * @returns {{ masks: Object, counters: Object, addedCount: number }}
 */
export function autoDetectMasks(text, currentMasks, currentCounters) {
  if (!text) return { masks: currentMasks, counters: currentCounters, addedCount: 0 };
  
  let newMasks = { ...currentMasks };
  let newCounters = { ...currentCounters };
  let addedCount = 0;
  
  const patterns = [
    { type: 'EMAIL', regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi },
    { type: 'PHONE', regex: /\b(?:\+?91[-\s]?)?[6789]\d{9}\b/g },
    { type: 'PAN', regex: /\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/gi },
    { type: 'GST', regex: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}\b/gi },
    { type: 'AADHAAR', regex: /\b\d{4}\s?\d{4}\s?\d{4}\b/g },
    { type: 'IFSC', regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/gi },
    { type: 'PIN_CODE', regex: /\b[1-9][0-9]{5}\b/g },
    { type: 'VOTER_ID', regex: /\b[A-Z]{3}\d{7}\b/gi },
    { type: 'PASSPORT', regex: /\b[A-PR-WYa-pr-wy][1-9]\d\s?\d{4}[1-9]\b/gi },
    { type: 'DL', regex: /\b[A-Z]{2}\d{2}[A-Z\d]{11}\b/gi }
  ];

  for (const p of patterns) {
    const matches = text.match(p.regex);
    if (matches) {
      for (const match of matches) {
        // Skip if already masked or if it's too short
        if (!newMasks[match] && match.length >= 3) {
          const { token, newCounters: nc } = createMaskToken(p.type, newCounters);
          newMasks[match] = { token, type: p.type };
          newCounters = nc;
          addedCount++;
        }
      }
    }
  }
  
  return { masks: newMasks, counters: newCounters, addedCount };
}

/**
 * Apply all masks to a text string.
 * @param {string} text - original text
 * @param {Object} masks - { "John Smith": { token: "<NAME_1>", type: "NAME" }, ... }
 * @param {boolean} showMasked - if true, show tokens; if false, show originals
 * @returns {Array} - array of { text, isMasked, token, original } segments for rendering
 */
export function renderMaskedText(rawText, masks, showMasked) {
  const text = typeof rawText === 'string' ? rawText : String(rawText || '');
  if (!text || !masks || Object.keys(masks).length === 0) {
    return [{ text, isMasked: false }];
  }

  if (!showMasked) {
    return [{ text, isMasked: false }];
  }

  // Sort by length descending to match longer strings first
  const entries = Object.entries(masks).sort((a, b) => b[0].length - a[0].length);
  let segments = [{ text, isMasked: false }];

  for (const [original, maskInfo] of entries) {
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedOriginal, 'gi');
    const newSegments = [];
    
    for (const seg of segments) {
      if (seg.isMasked) {
        newSegments.push(seg);
        continue;
      }
      
      let match;
      let lastIndex = 0;
      // Need to reset lastIndex because it's a global regex
      regex.lastIndex = 0;
      
      while ((match = regex.exec(seg.text)) !== null) {
        if (match.index > lastIndex) {
          newSegments.push({ text: seg.text.substring(lastIndex, match.index), isMasked: false });
        }
        newSegments.push({
          text: maskInfo.token,
          isMasked: true,
          token: maskInfo.token,
          original: match[0],
          type: maskInfo.type,
        });
        lastIndex = regex.lastIndex;
      }
      if (lastIndex < seg.text.length) {
        newSegments.push({ text: seg.text.substring(lastIndex), isMasked: false });
      }
    }
    segments = newSegments;
  }
  return segments;
}

/**
 * Apply masks to raw text (string replacement, for export/AI).
 */
export function applyMasksToText(text, masks) {
  if (!text || !masks) return text;
  let result = String(text);
  const entries = Object.entries(masks).sort((a, b) => b[0].length - a[0].length);
  for (const [original, maskInfo] of entries) {
    const escapedOriginal = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedOriginal, 'gi');
    result = result.replace(regex, maskInfo.token);
  }
  return result;
}
