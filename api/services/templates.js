/**
 * SMS template resolution.
 *
 * Outbound (handshake): pick per-campaign handshake (reward/no-reward), fall back to
 *                        global Handshake Matrix.
 * Inbound (payload after YES): pick per-campaign payload (reward/no-reward), fall back to
 *                              global Payload Matrix (Reward/No Reward). No-show, cancellation,
 *                              and reactivation share the Booking payload pair from Company Info.
 *
 * Placeholders: [Name], [Business Name], [Review Link], [Booking Link],
 *               [Membership Link], [Reward].
 */

const { CAMPAIGNS, campaignKey } = require('../config');

const PLACEHOLDERS = {
  '[Name]': 'name',
  '[Business Name]': 'businessName',
  '[Review Link]': 'reviewLink',
  '[Booking Link]': 'bookingLink',
  '[Membership Link]': 'membershipLink',
  '[Reward]': 'reward',
};

/**
 * @param {string} template
 * @param {Record<string, string | undefined | null>} data
 */
function replacePlaceholders(template, data) {
  if (template == null) return '';
  let out = String(template);
  for (const [token, key] of Object.entries(PLACEHOLDERS)) {
    const v = data[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    out = out.split(token).join(String(v));
  }
  return out;
}

/**
 * Resolve a {reward, noReward} pair from a Company Info template tree, choosing the right
 * branch with a fallback to the other branch then a global default.
 *
 * @param {{ reward?: string, noReward?: string } | undefined} pair
 * @param {string} globalReward
 * @param {string} globalNoReward
 * @param {boolean} hasReward
 */
function pickFromPair(pair, globalReward, globalNoReward, hasReward) {
  const r = String(pair?.reward || '').trim();
  const n = String(pair?.noReward || '').trim();
  const gr = String(globalReward || '').trim();
  const gn = String(globalNoReward || '').trim();
  if (hasReward) return r || gr || n || gn;
  return n || gn || r || gr;
}

/**
 * @param {object | null | undefined} company From getCompanyInfo()
 * @param {string} campaignType "review" | "no_show" | …
 * @param {boolean} hasReward
 */
function getHandshakeTemplate(company, campaignType, hasReward) {
  if (!company) return '';
  const key = campaignKey(campaignType);
  const pair = company.handshake?.[key];
  // Handshake has no global "reward / no reward" pair — Handshake Matrix is the only global.
  const handshakeMatrix = String(company.handshakeMatrix || '').trim();
  return pickFromPair(pair, '', '', hasReward) || handshakeMatrix;
}

/**
 * @param {object | null | undefined} company
 * @param {string} campaignType
 * @param {boolean} hasReward
 */
function getPayloadTemplate(company, campaignType, hasReward) {
  if (!company) return '';
  const key = campaignKey(campaignType);
  const pair = company.payload?.[key];
  return pickFromPair(
    pair,
    company.payloadMatrixReward,
    company.payloadMatrixNoReward,
    hasReward
  );
}

/** Coerces any "Reward" cell shape (boolean / select / text / null) to a yes/no flag. */
function hasRewardOffer(raw) {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  if (!s) return false;
  if (['no', 'n', 'false', '0', 'none', 'no reward', 'without reward', 'n/a', 'na'].includes(s))
    return false;
  if (['yes', 'y', 'true', '1', 'reward', 'rewards'].includes(s)) return true;
  if (s.includes('no reward') || s.includes('without reward')) return false;
  return true; // any other free-text incentive ("$10 gift card") = reward
}

/**
 * Tells the upload UI which campaigns are "ready" (handshake template filled).
 * @param {object | null | undefined} company
 */
function listCampaignOptionsFromCompany(company) {
  if (!company) return [];
  return CAMPAIGNS.map(({ value, label }) => {
    const hsR = String(getHandshakeTemplate(company, value, true) || '').trim();
    const hsN = String(getHandshakeTemplate(company, value, false) || '').trim();
    const pR = String(getPayloadTemplate(company, value, true) || '').trim();
    const pN = String(getPayloadTemplate(company, value, false) || '').trim();
    return {
      value,
      label,
      hasHandshake: (hsR || hsN).length > 0,
      hasPayload: (pR || pN).length > 0,
    };
  });
}

module.exports = {
  replacePlaceholders,
  getHandshakeTemplate,
  getPayloadTemplate,
  hasRewardOffer,
  listCampaignOptionsFromCompany,
  // Backwards-compat: outbound.js used `getTemplate` for handshake lookup.
  getTemplate: getHandshakeTemplate,
  CANONICAL_CAMPAIGNS: CAMPAIGNS,
};
