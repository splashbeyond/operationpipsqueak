require('../env');

const Papa = require('papaparse');
const OpenAI = require('openai');

/**
 * @param {Buffer} fileBuffer
 * @returns {{ headers: string[], rows: Record<string, string>[], rawText: string }}
 */
function parseCSV(fileBuffer) {
  const rawText = fileBuffer.toString('utf8');
  const parsed = Papa.parse(rawText, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (h) => String(h || '').trim(),
  });

  const headers = parsed.meta.fields ? parsed.meta.fields.filter(Boolean) : [];
  const rows = (parsed.data || []).map((row) => {
    /** @type {Record<string, string>} */
    const out = {};
    for (const h of headers) {
      const v = row[h];
      out[h] = v === undefined || v === null ? '' : String(v).trim();
    }
    return out;
  });

  return { headers, rows, rawText };
}

/**
 * @param {string[]} headers
 * @param {string} rawCSVText
 * @returns {Promise<{ name: string | null, phone: string | null, campaign_type: string | null, reward: string | null }>}
 */
async function mapHeaders(headers, rawCSVText) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return fallbackHeaderMap(headers);
  }

  const sample = rawCSVText.split(/\r?\n/).slice(0, 12).join('\n');
  const headerList = headers.length ? headers.join(', ') : '(no headers parsed)';

  const client = new OpenAI({ apiKey });
  try {
    const completion = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 200,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You map CSV columns to lead fields. Reply with ONLY valid JSON, no markdown, no explanation. Shape: {"name":"Column Name or null","phone":"Column Name or null","campaign_type":"Column Name or null","reward":"Column Name or null"} — reward is optional (incentive/gift text per row). Use exact header strings from the CSV.',
        },
        {
          role: 'user',
          content: `Headers: ${headerList}\n\nFirst rows:\n${sample}`,
        },
      ],
    });

    const text = completion.choices[0]?.message?.content?.trim() || '';
    const json = JSON.parse(stripJsonFence(text));
    return {
      name: json.name ?? null,
      phone: json.phone ?? null,
      campaign_type: json.campaign_type ?? null,
      reward: json.reward ?? null,
    };
  } catch {
    return fallbackHeaderMap(headers);
  }
}

/**
 * @param {string} text
 */
function stripJsonFence(text) {
  const m = text.match(/\{[\s\S]*\}/);
  return m ? m[0] : text;
}

/**
 * @param {string[]} headers
 */
function fallbackHeaderMap(headers) {
  const h = headers.filter(Boolean);
  const rewardHeader =
    h.find((col) => /^(reward|incentive|gift|offer|promo)\b/i.test(col)) ||
    h.find((col) => /\b(reward|incentive)\b/i.test(col)) ||
    null;
  return {
    name: h[0] ?? null,
    phone: h[1] ?? null,
    campaign_type: h[2] ?? null,
    reward: rewardHeader,
  };
}

/**
 * @param {string} phoneRaw
 * @returns {string | null} E.164 +1XXXXXXXXXX or null
 */
function normalizePhoneUS(phoneRaw) {
  const digits = String(phoneRaw || '').replace(/\D/g, '');
  if (digits.length === 10) {
    return `+1${digits}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+${digits}`;
  }
  return null;
}

/**
 * @param {Record<string, string>[]} rows
 * @param {{ name: string | null, phone: string | null, campaign_type: string | null, reward: string | null }} headerMap
 * @returns {{ name: string, phone: string, campaignType: string, reward: string }[]}
 */
function extractLeads(rows, headerMap) {
  const nameCol = headerMap.name;
  const phoneCol = headerMap.phone;
  const campaignCol = headerMap.campaign_type;
  const rewardCol = headerMap.reward;

  /** @type {{ name: string, phone: string, campaignType: string, reward: string }[]} */
  const leads = [];

  for (const row of rows) {
    const name = nameCol ? String(row[nameCol] ?? '').trim() : '';
    const phoneRaw = phoneCol ? String(row[phoneCol] ?? '').trim() : '';
    const campaignType = campaignCol
      ? String(row[campaignCol] ?? '').trim()
      : '';
    const reward = rewardCol ? String(row[rewardCol] ?? '').trim() : '';

    const phone = normalizePhoneUS(phoneRaw);
    if (!phone) continue;

    leads.push({
      name: name || 'Friend',
      phone,
      campaignType: campaignType || 'review',
      reward,
    });
  }

  return leads;
}

/**
 * @param {Buffer} fileBuffer
 */
async function processCSV(fileBuffer) {
  const { headers, rows, rawText } = parseCSV(fileBuffer);
  const headerMap = await mapHeaders(headers, rawText);
  return extractLeads(rows, headerMap);
}

module.exports = {
  parseCSV,
  mapHeaders,
  extractLeads,
  processCSV,
  normalizePhoneUS,
};
