// ═══════════════════════════════════════════════════════════════════════════
// Availity Transaction Support Refresh
// Queries the public Availity payer list API for each payer in D1
// Updates has_270, has_pa_in, has_pa_out, has_ref based on live REST routes
// Run as part of quarterly GitHub Actions scraper
// ═══════════════════════════════════════════════════════════════════════════

const fetch = require('node-fetch');

const CONFIG = {
  cfAccountId: '90652237702a9ed8d5bd48ad66b466a0',
  cfDatabaseId: '704682fb-fcfd-4c41-b5aa-4da131295a6b',
  cfApiToken: process.env.CF_API_TOKEN,
  availityUrl: 'https://essentials.availity.com/cloud/public/onb/epdm/es/public/v1/payers-hipaa',
  // REST modeCode
  REST_MODE: 10,
  // Transaction type codes → what they mean
  TX: {
    ELIG_270:   [1],           // 270 Eligibility
    PA_OUT:     [6],           // 278 Outpatient PA / Service Review
    PA_IN:      [259, 436],    // 278 Inpatient Auth (HCSC style + Anthem style)
    REF:        [138],         // 278 Referral
    // Skip: 258 (claims attachments), 2 (claim status), 3 (claims), 5 (remittance)
    // Informational only: 24, 25, 26, 177, 260
  },
  // LOB detection from payer name
  LOB_SKIP: ['DENTAL', 'RECLAMATION', 'ENCOUNTER', 'WGS'],
  LOB_MEDICAID: ['MEDICAID', 'MYCARE', 'COMMUNITY HEALTH'],
  LOB_MEDICARE: ['MEDICARE']
};

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── D1 helpers ──────────────────────────────────────────────────────────────
async function d1Query(sql, params = []) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${CONFIG.cfAccountId}/d1/database/${CONFIG.cfDatabaseId}/query`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CONFIG.cfApiToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ sql, params })
  });
  const data = await res.json();
  if (!data.success) throw new Error(`D1 error: ${JSON.stringify(data.errors)}`);
  return data.result[0];
}

// Get all unique Availity payer IDs from D1
async function getAvailityIdsFromD1() {
  const result = await d1Query(
    `SELECT DISTINCT availity_payer_ids, plan_name 
     FROM prefixes 
     WHERE availity_payer_ids IS NOT NULL 
     AND availity_payer_ids != '' 
     GROUP BY availity_payer_ids`
  );
  // Each row may have comma-separated IDs e.g. "G00621,BCBSIL,MCIL2"
  const idMap = {}; // ariesId -> plan_name
  (result.results || []).forEach(row => {
    const ids = row.availity_payer_ids.split(',').map(s => s.trim());
    ids.forEach(id => { idMap[id] = row.plan_name; });
  });
  return idMap;
}

// ── LOB detection ───────────────────────────────────────────────────────────
function detectLob(name) {
  const upper = name.toUpperCase();
  for (const skip of CONFIG.LOB_SKIP) {
    if (upper.includes(skip)) return null; // skip this record
  }
  for (const mc of CONFIG.LOB_MEDICARE) {
    if (upper.includes(mc)) return 'Medicare';
  }
  for (const md of CONFIG.LOB_MEDICAID) {
    if (upper.includes(md)) return 'Medicaid';
  }
  return 'Commercial';
}

// ── Parse REST routes from a payer record ───────────────────────────────────
function parseRestRoutes(processingRoutes) {
  const restCodes = processingRoutes
    .filter(r => r.modeCode === CONFIG.REST_MODE)
    .map(r => r.transactionTypeCode);

  return {
    has_270:    restCodes.some(c => CONFIG.TX.ELIG_270.includes(c)) ? 1 : 0,
    has_pa_out: restCodes.some(c => CONFIG.TX.PA_OUT.includes(c))  ? 1 : 0,
    has_pa_in:  restCodes.some(c => CONFIG.TX.PA_IN.includes(c))   ? 1 : 0,
    has_ref:    restCodes.some(c => CONFIG.TX.REF.includes(c))     ? 1 : 0,
  };
}

// ── Query Availity for a single payer ID ────────────────────────────────────
async function queryAvailityPayer(ariesId) {
  const url = `${CONFIG.availityUrl}?limit=25&offset=0&platform=ARIES&q=${encodeURIComponent(ariesId)}&sortBy=name&sortDirection=asc`;
  const res = await fetch(url, {
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    }
  });
  if (!res.ok) {
    log(`  HTTP ${res.status} for ariesId=${ariesId}`);
    return [];
  }
  const data = await res.json();
  return data.payers || [];
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function refreshAvailityData() {
  log('Starting Availity transaction support refresh...');

  if (!CONFIG.cfApiToken) throw new Error('CF_API_TOKEN not set');

  // Step 1: Get all unique Availity IDs from D1
  log('Loading Availity payer IDs from D1...');
  const idMap = await getAvailityIdsFromD1();
  const uniqueIds = Object.keys(idMap);
  log(`Found ${uniqueIds.length} unique Availity payer IDs to refresh`);

  const results = {
    updated: [],
    unchanged: [],
    notFound: [],
    errors: []
  };

  // Step 2: Query Availity for each payer ID
  for (const ariesId of uniqueIds) {
    try {
      const payers = await queryAvailityPayer(ariesId);

      // Find matching payer records (exact ariesId match, skip dental/reclamation/encounters)
      const matchingPayers = payers.filter(p => {
        if (p.ariesId !== ariesId) return false;
        const lob = detectLob(p.name);
        return lob !== null; // null = skip
      });

      if (!matchingPayers.length) {
        log(`  NOT FOUND: ${ariesId}`);
        results.notFound.push(ariesId);
        await delay(100);
        continue;
      }

      // Aggregate transaction support across all LOBs for this ariesId
      // (if ANY record supports a transaction, mark it as available)
      let has_270 = 0, has_pa_out = 0, has_pa_in = 0, has_ref = 0;
      const lobList = [];

      matchingPayers.forEach(p => {
        const lob = detectLob(p.name);
        if (lob) lobList.push(lob);
        const routes = parseRestRoutes(p.processingRoutes);
        has_270    = Math.max(has_270,    routes.has_270);
        has_pa_out = Math.max(has_pa_out, routes.has_pa_out);
        has_pa_in  = Math.max(has_pa_in,  routes.has_pa_in);
        has_ref    = Math.max(has_ref,    routes.has_ref);
      });

      const lobs = [...new Set(lobList)].sort().join(',');

      // Step 3: Update D1
      await d1Query(
        `UPDATE prefixes 
         SET has_270 = ?, has_pa_in = ?, has_pa_out = ?, has_ref = ?
         WHERE availity_payer_ids LIKE ?`,
        [has_270, has_pa_in, has_pa_out, has_ref, `%${ariesId}%`]
      );

      log(`  ✅ ${ariesId} (${lobs}) → 270:${has_270} PA-IN:${has_pa_in} PA-OUT:${has_pa_out} REF:${has_ref}`);
      results.updated.push({ ariesId, lobs, has_270, has_pa_in, has_pa_out, has_ref });

    } catch (e) {
      log(`  ❌ ${ariesId} → ${e.message}`);
      results.errors.push({ ariesId, error: e.message });
    }

    await delay(150); // be respectful to Availity servers
  }

  // Step 4: Summary
  log(`\nAvaility refresh complete:`);
  log(`  Updated: ${results.updated.length}`);
  log(`  Not found: ${results.notFound.length}`);
  log(`  Errors: ${results.errors.length}`);

  if (results.notFound.length) {
    log(`  Not found IDs: ${results.notFound.join(', ')}`);
  }

  return results;
}

module.exports = { refreshAvailityData };

// Run directly if called as main script
if (require.main === module) {
  refreshAvailityData()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal:', err); process.exit(1); });
}
