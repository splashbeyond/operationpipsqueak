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
 * Keep only header values that exist on this file (exact string match).
 * @param {Record<string, string | null | undefined>} map
 * @param {string[]} headers
 */
function coerceHeaderMap(map, headers) {
  const set = new Set(headers.filter(Boolean));
  /** @type {{ name: string | null, phone: string | null, campaign_type: string | null, reward: string | null }} */
  const out = {
    name: null,
    phone: null,
    campaign_type: null,
    reward: null,
  };
  for (const key of ['name', 'phone', 'campaign_type', 'reward']) {
    const v = map[key];
    if (v != null && String(v).trim() !== '' && set.has(String(v))) {
      out[key] = String(v);
    }
  }
  return out;
}

/**
 * Pick the column whose non-empty sample cells most often normalize to US E.164.
 * @param {string[]} headers
 * @param {Record<string, string>[]} rows
 */
function guessPhoneColumn(headers, rows) {
  let best = null;
  let bestScore = -1;
  const limit = Math.min(rows.length, 20);
  for (const h of headers) {
    if (!h) continue;
    let valid = 0;
    let total = 0;
    for (let i = 0; i < limit; i++) {
      const v = rows[i]?.[h];
      if (v == null || String(v).trim() === '') continue;
      total++;
      if (normalizePhoneUS(v)) valid++;
    }
    const score = total > 0 ? valid / total : 0;
    if (score > bestScore) {
      bestScore = score;
      best = h;
    }
  }
  return bestScore >= 0.4 ? best : null;
}

/**
 * Common CRM / sheet headers for contact name.
 * @param {string[]} headers
 */
function guessNameColumn(headers) {
  const h = headers.filter(Boolean);
  const ranked = [
    /^(first\s*name|firstname|given\s*name|fname)$/i,
    /^(full\s*name|name|contact\s*name)$/i,
    /^contact$/i,
    /\b(first|given)\b.*\bname\b/i,
    /\bfull\b.*\bname\b/i,
  ];
  for (const re of ranked) {
    const hit = h.find((col) => re.test(col.trim()));
    if (hit) return hit;
  }
  return h[0] ?? null;
}

/**
 * Use first whitespace-delimited token for SMS greeting ("Sarah Smith" → "Sarah").
 * @param {string} raw
 */
function displayFirstName(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  return s.split(/\s+/)[0] || '';
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
    const rawName = nameCol ? String(row[nameCol] ?? '').trim() : '';
    const first = displayFirstName(rawName);
    const phoneRaw = phoneCol ? String(row[phoneCol] ?? '').trim() : '';
    const campaignType = campaignCol
      ? String(row[campaignCol] ?? '').trim()
      : '';
    const reward = rewardCol ? String(row[rewardCol] ?? '').trim() : '';

    const phone = normalizePhoneUS(phoneRaw);
    if (!phone) continue;

    leads.push({
      name: first || 'Friend',
      phone,
      campaignType: campaignType || 'review',
      reward,
    });
  }

  return leads;
}

/**
 * @param {Buffer} fileBuffer
 * @returns {Promise<{ leads: { name: string, phone: string, campaignType: string, reward: string }[], dataRowCount: number }>}
 */
async function processCSV(fileBuffer) {
  const { headers, rows, rawText } = parseCSV(fileBuffer);
  let headerMap = coerceHeaderMap(await mapHeaders(headers, rawText), headers);
  if (!headerMap.phone) headerMap = { ...headerMap, phone: guessPhoneColumn(headers, rows) };
  if (!headerMap.name) headerMap = { ...headerMap, name: guessNameColumn(headers) };
  const leads = extractLeads(rows, headerMap);
  return { leads, dataRowCount: rows.length, headerMap };
}

/**
 * Parse CSV and build preview + suggested mapping (OpenAI + heuristics).
 * @param {Buffer} fileBuffer
 * @param {{ name: string | null, phone: string | null, campaign_type: string | null, reward: string | null } | null} [overrideMap] If set, skip LLM and use this mapping (after coerce).
 * @param {number} [sampleLimit]
 */
async function previewCSV(fileBuffer, overrideMap = null, sampleLimit = 15) {
  const { headers, rows, rawText } = parseCSV(fileBuffer);
  const lim = Math.min(Math.max(Number(sampleLimit) || 15, 5), 50);
  const sampleRowSlice = rows.slice(0, lim);

  let headerMap;
  if (overrideMap) {
    headerMap = coerceHeaderMap(overrideMap, headers);
  } else {
    headerMap = coerceHeaderMap(await mapHeaders(headers, rawText), headers);
    if (!headerMap.phone) headerMap = { ...headerMap, phone: guessPhoneColumn(headers, rows) };
    if (!headerMap.name) headerMap = { ...headerMap, name: guessNameColumn(headers) };
  }

  const previewLeads = extractLeads(sampleRowSlice, headerMap);
  let nonEmptyPhoneAttempts = 0;
  if (headerMap.phone) {
    for (const row of sampleRowSlice) {
      const raw = row[headerMap.phone];
      if (raw != null && String(raw).trim() !== '') nonEmptyPhoneAttempts++;
    }
  }

  return {
    headers,
    dataRowCount: rows.length,
    suggestedMapping: headerMap,
    previewLeads,
    previewSample: {
      rowsInSample: sampleRowSlice.length,
      validPhonesInSample: previewLeads.length,
      nonEmptyPhoneCellsInSample: nonEmptyPhoneAttempts,
    },
  };
}

/**
 * @param {Buffer} fileBuffer
 * @param {{ name: string | null, phone: string | null, campaign_type: string | null, reward: string | null }} headerMap Must use exact header strings from file.
 */
function processCSVWithMapping(fileBuffer, headerMap) {
  const { headers, rows } = parseCSV(fileBuffer);
  const map = coerceHeaderMap(headerMap, headers);
  const leads = extractLeads(rows, map);
  return { leads, dataRowCount: rows.length, headerMap: map };
}

module.exports = {
  parseCSV,
  mapHeaders,
  extractLeads,
  processCSV,
  processCSVWithMapping,
  previewCSV,
  coerceHeaderMap,
  normalizePhoneUS,
};
