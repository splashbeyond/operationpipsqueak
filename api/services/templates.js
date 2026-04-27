/**
 * @param {string} template
 * @param {Record<string, string | undefined | null>} data
 */
function replacePlaceholders(template, data) {
  if (template === undefined || template === null) return '';
  let out = String(template);

  const pairs = [
    ['[Name]', data.name],
    ['[Business Name]', data.businessName],
    ['[Review Link]', data.reviewLink],
    ['[Booking Link]', data.bookingLink],
    ['[Membership Link]', data.membershipLink],
    ['[Reward]', data.reward],
  ];

  for (const [token, value] of pairs) {
    if (value === undefined || value === null || String(value).trim() === '') continue;
    out = out.split(token).join(String(value));
  }

  return out;
}

/**
 * @param {object | null | undefined} companyInfo Row from getCompanyInfo()
 * @param {string} campaignType review | no_show | cancellation | reactivation | upsell | referral
 */
function getTemplate(companyInfo, campaignType, hasReward = false) {
  if (!companyInfo) return '';

  const key = campaignTypeKey(campaignType);

  const byCampaign = {
    review: [companyInfo.reviewTemplateReward, companyInfo.reviewTemplateNoReward, companyInfo.reviewTemplate],
    no_show: [companyInfo.noShowTemplateReward, companyInfo.noShowTemplateNoReward, companyInfo.noShowTemplate],
    cancellation: [
      companyInfo.cancellationTemplateReward,
      companyInfo.cancellationTemplateNoReward,
      companyInfo.cancellationTemplate,
    ],
    reactivation: [
      companyInfo.reactivationTemplateReward,
      companyInfo.reactivationTemplateNoReward,
      companyInfo.reactivationTemplate,
    ],
    upsell: [companyInfo.upsellTemplateReward, companyInfo.upsellTemplateNoReward, companyInfo.upsellTemplate],
    referral: [
      companyInfo.referralTemplateReward,
      companyInfo.referralTemplateNoReward,
      companyInfo.referralReviewTemplate,
    ],
  };

  const [rewardVariant, noRewardVariant, generic] = byCampaign[key] || byCampaign.review;
  const rr = String(rewardVariant || '').trim();
  const nr = String(noRewardVariant || '').trim();
  const g = String(generic || '').trim();
  const fallback = String(companyInfo.handshakeMatrix || companyInfo.reviewTemplate || '').trim();

  if (hasReward) return rr || nr || g || fallback;
  return nr || rr || g || fallback;
}

/**
 * Normalize campaign label (e.g. "Review", "No-Show") to internal key.
 * @param {unknown} campaignType
 */
function campaignTypeKey(campaignType) {
  let key = String(campaignType || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/-/g, '_');
  if (key === 'membership' || key === 'membership_upsell') return 'upsell';
  if (key === 'noshow') return 'no_show';
  return key;
}

/**
 * Per-campaign payload pair [rewardText, noRewardText] from Company Info long-text fields.
 * @param {object} companyInfo
 * @param {string} campaignType
 * @returns {[string, string]}
 */
function getCampaignPayloadPair(companyInfo, campaignType) {
  const key = campaignTypeKey(campaignType);
  const pairs = {
    review: [companyInfo.reviewPayloadReward, companyInfo.reviewPayloadNoReward],
    no_show: [companyInfo.noShowPayloadReward, companyInfo.noShowPayloadNoReward],
    cancellation: [companyInfo.cancellationPayloadReward, companyInfo.cancellationPayloadNoReward],
    reactivation: [companyInfo.reactivationPayloadReward, companyInfo.reactivationPayloadNoReward],
    referral: [companyInfo.referralPayloadReward, companyInfo.referralPayloadNoReward],
    upsell: [companyInfo.upsellPayloadReward, companyInfo.upsellPayloadNoReward],
  };
  const pair = pairs[key] || pairs.review;
  return [String(pair[0] ?? '').trim(), String(pair[1] ?? '').trim()];
}

/**
 * Outbound “payload” SMS after customer replies Yes — campaign-specific template + reward branch,
 * then global Payload Matrix (Reward)/(No Reward), then legacy Payload Matrix.
 * @param {object | null | undefined} companyInfo from getCompanyInfo()
 * @param {string} campaignType Campaign log / customer campaign (e.g. Review)
 * @param {boolean} hasReward from Customer Data → Reward
 */
function getPayloadTemplate(companyInfo, campaignType, hasReward) {
  if (!companyInfo) return '';
  const legacy = String(companyInfo.payloadMatrix || '').trim();
  const globalReward = String(companyInfo.payloadMatrixReward || '').trim();
  const globalNoReward = String(companyInfo.payloadMatrixNoReward || '').trim();

  const [specificR, specificN] = getCampaignPayloadPair(companyInfo, campaignType);
  const reward = specificR || globalReward;
  const noReward = specificN || globalNoReward;

  if (hasReward) {
    if (reward) return reward;
    if (noReward) return noReward;
    return legacy;
  }
  if (noReward) return noReward;
  if (reward) return reward;
  return legacy;
}

/** @type {{ value: string, label: string }[]} */
const CANONICAL_CAMPAIGNS = [
  { value: 'review', label: 'Review' },
  { value: 'no_show', label: 'No show' },
  { value: 'cancellation', label: 'Cancellation' },
  { value: 'reactivation', label: 'Reactivation' },
  { value: 'upsell', label: 'Membership / upsell' },
  { value: 'referral', label: 'Referral' },
];

/**
 * Options for the upload UI: campaigns that have handshake copy in Company Info (or global Handshake Matrix).
 * @param {object | null | undefined} companyInfo
 * @returns {{ value: string, label: string, hasHandshake: boolean, hasPayload: boolean }[]}
 */
function listCampaignOptionsFromCompany(companyInfo) {
  if (!companyInfo) return [];
  return CANONICAL_CAMPAIGNS.map(({ value, label }) => {
    const hsReward = String(getTemplate(companyInfo, value, true) || '').trim();
    const hsNoReward = String(getTemplate(companyInfo, value, false) || '').trim();
    const handshake = hsReward || hsNoReward;
    const pr = String(getPayloadTemplate(companyInfo, value, true) || '').trim();
    const pn = String(getPayloadTemplate(companyInfo, value, false) || '').trim();
    return {
      value,
      label,
      hasHandshake: handshake.length > 0,
      hasPayload: pr.length > 0 || pn.length > 0,
    };
  });
}

module.exports = {
  replacePlaceholders,
  getTemplate,
  getPayloadTemplate,
  listCampaignOptionsFromCompany,
  CANONICAL_CAMPAIGNS,
};
