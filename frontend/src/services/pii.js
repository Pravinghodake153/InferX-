/**
 * PII Client-Side Utilities
 * Handles PII token display, reveal state, and session management.
 */

// PII token regex for detecting tokens in text
const PII_TOKEN_REGEX = /(ORG_\d+|ID_GSTIN_\d+|ID_PAN_\d+|CONTACT_PHONE_\d+|CONTACT_EMAIL_\d+|PERSON_\d+)/g;

/**
 * Check if a string contains PII tokens.
 */
export function containsPIITokens(text) {
  if (!text || typeof text !== 'string') return false;
  return PII_TOKEN_REGEX.test(text);
}

/**
 * Extract all PII tokens from a text string.
 */
export function extractPIITokens(text) {
  if (!text || typeof text !== 'string') return [];
  return [...new Set(text.match(PII_TOKEN_REGEX) || [])];
}

/**
 * Get the display type for a PII token.
 */
export function getTokenType(token) {
  if (token.startsWith('ORG_')) return 'Organization';
  if (token.startsWith('ID_GSTIN_')) return 'GSTIN';
  if (token.startsWith('ID_PAN_')) return 'PAN';
  if (token.startsWith('CONTACT_PHONE_')) return 'Phone';
  if (token.startsWith('CONTACT_EMAIL_')) return 'Email';
  if (token.startsWith('PERSON_')) return 'Person';
  return 'Unknown';
}

