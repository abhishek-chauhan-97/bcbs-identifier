// ═══════════════════════════════════════════════════════════════════════════
// BCBS Prefix Scraper — Quarterly automated sync
// Uses puppeteer-core + system Chrome (no bundled browser download)
// ═══════════════════════════════════════════════════════════════════════════

const puppeteer = require('puppeteer-core');
const fetch = require('node-fetch');

const CONFIG = {
  delayMs: 200,
  batchSize: 50,
  testMode: process.argv.includes('--test'),
  testPrefixes: ['WSJ', 'ABC', 'AAA', 'ZZZ', 'XQA', 'RAA', 'FEP', 'BCA', 'A2A', 'YEP',
                 'WSA', 'WSB', 'WSC', 'WSD', 'WSE', 'WSF', 'WSG', 'WSH', 'WSI', 'WSK'],
  cfAccountId: '90652237702a9ed8d5bd48ad66b466a0',
  cfDatabaseId: '704682fb-fcfd-4c41-b5aa-4da131295a6b',
  cfApiToken: process.env.CF_API_TOKEN,
  resendApiKey: process.env.RESEND_API_KEY,
  alertEmail: 'abhishek.chauhan.work97@gmail.com',
  fromEmail: 'onboarding@resend.dev',
  bcbsUrl: 'https://www.bcbs.com/planfinder/prefix',
  // System Chrome path passed via env, with fallbacks
  chromePath: process.env.CHROME_PATH ||
    '/usr/bin/google-chrome-stable' ||
    '/usr/bin/google-chrome' ||
    '/usr/bin/chromium-browser'
};

function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }

function generateAllPrefixes() {
  const prefixes = [];
  for (let i = 65; i <= 90; i++)
    for (let j = 65; j <= 90; j++)
      for (let k = 65; k <= 90; k++)
        prefixes.push(String.fromCharCode(i, j, k));
  return prefixes;
}

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

async function getAllPrefixesFromD1() {
  const result = await d1Query('SELECT alpha_prefix, plan_name FROM prefixes ORDER BY alpha_prefix ASC');
  const map = {};
  (result.results || []).forEach(row => { map[row.alpha_prefix] = row.plan_name; });
  return map;
}

async function upsertPrefix(prefix, planName, url) {
  await d1Query(
    `INSERT OR REPLACE INTO prefixes 
     (alpha_prefix, plan_name, state, prefix_count, website_url, availity_payer_ids,
      has_270, has_pa_in, has_pa_out, has_ref, has_275)
     VALUES (?, ?, '', 0, ?, '', 0, 0, 0, 0, 0)`,
    [prefix, planName, url]
  );
}

async function updatePlanName(prefix, planName) {
  await d1Query('UPDATE prefixes SET plan_name = ? WHERE alpha_prefix = ?', [planName, prefix]);
}

async function deletePrefix(prefix) {
  await d1Query('DELETE FROM prefixes WHERE alpha_prefix = ?', [prefix]);
}

async function scrapePrefixes(page, prefixes) {
  const results = {};
  let done = 0;

  for (const prefix of prefixes) {
    try {
      const data = await page.evaluate(async (pfx, url) => {
        try {
          const r = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ prefix: pfx })
          });
          if (!r.ok) return null;
          const json = await r.json();
          return Array.isArray(json) && json.length > 0 ? json[0] : null;
        } catch(e) { return null; }
      }, prefix, CONFIG.bcbsUrl);

      results[prefix] = data || null;
      if (data) log(`  ✅ ${prefix} → ${data.name}`);

    } catch (e) {
      log(`  ❌ ${prefix} → ${e.message}`);
      results[prefix] = null;
    }

    done++;
    if (done % CONFIG.batchSize === 0) {
      const found = Object.values(results).filter(Boolean).length;
      log(`  Progress: ${done}/${prefixes.length} (${Math.round(done/prefixes.length*100)}%) | Found: ${found}`);
    }
    await delay(CONFIG.delayMs);
  }

  return results;
}

async function sendEmail(subject, html) {
  if (!CONFIG.resendApiKey) { log('No RESEND_API_KEY — skipping email'); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CONFIG.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: CONFIG.fromEmail, to: CONFIG.alertEmail, subject, html })
  });
  const data = await res.json();
  log(res.ok ? `Email sent: ${data.id}` : `Email failed: ${JSON.stringify(data)}`);
}

function buildEmail(added, changed, removed, total, runDate) {
  const hasChanges = added.length || changed.length || removed.length;
  let html = `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;color:#111">
    <div style="background:linear-gradient(135deg,#1e3a8a,#2563eb);padding:24px;border-radius:8px 8px 0 0">
      <h1 style="color:#fff;margin:0;font-size:20px">BCBS Prefix Database Update</h1>
      <p style="color:rgba(255,255,255,.8);margin:6px 0 0;font-size:13px">Quarterly scrape — ${runDate}</p>
    </div>
    <div style="background:#f8fafc;padding:20px;border:1px solid #e5e7eb;border-top:none">
      <p style="margin:0 0 16px;font-size:14px">Total prefixes: <strong>${total.toLocaleString()}</strong></p>`;

  if (!hasChanges) {
    html += `<div style="background:#dcfce7;border:1px solid #bbf7d0;border-radius:6px;padding:14px;color:#15803d">✅ No changes detected.</div>`;
  } else {
    html += `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:14px;color:#92400e;margin-bottom:16px">
      ⚠️ ${added.length + changed.length + removed.length} change(s) applied automatically.</div>`;
  }

  if (added.length) {
    html += `<h3 style="color:#15803d;font-size:14px;margin:16px 0 8px">✅ ${added.length} New Prefix${added.length>1?'es':''}</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f1f5f9"><th style="padding:6px 10px;text-align:left">Prefix</th><th style="padding:6px 10px;text-align:left">Plan</th></tr>`;
    added.forEach(({prefix, plan}) => {
      html += `<tr><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:700">${prefix}</td><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9">${plan}</td></tr>`;
    });
    html += `</table>`;
  }

  if (changed.length) {
    html += `<h3 style="color:#d97706;font-size:14px;margin:16px 0 8px">⚠️ ${changed.length} Changed</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f1f5f9"><th style="padding:6px 10px;text-align:left">Prefix</th><th style="padding:6px 10px;text-align:left">Was</th><th style="padding:6px 10px;text-align:left">Now</th></tr>`;
    changed.forEach(({prefix, oldPlan, newPlan}) => {
      html += `<tr><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:700">${prefix}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#dc2626">${oldPlan}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#15803d">${newPlan}</td></tr>`;
    });
    html += `</table>`;
  }

  if (removed.length) {
    html += `<h3 style="color:#dc2626;font-size:14px;margin:16px 0 8px">❌ ${removed.length} Removed</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="background:#f1f5f9"><th style="padding:6px 10px;text-align:left">Prefix</th><th style="padding:6px 10px;text-align:left">Was</th></tr>`;
    removed.forEach(({prefix, oldPlan}) => {
      html += `<tr><td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;font-family:monospace;font-weight:700">${prefix}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #f1f5f9;color:#dc2626">${oldPlan}</td></tr>`;
    });
    html += `</table>`;
  }

  html += `</div>
    <div style="padding:14px 20px;background:#f1f5f9;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;font-size:12px;color:#6b7280">
      Automated alert from BCBS Home State Identifier scraper. Changes applied to Cloudflare D1.<br>
      <a href="https://arcane-owl-97.github.io/bcbs-identifier/" style="color:#2563eb">View tool ↗</a>
    </div></div>`;
  return html;
}

async function main() {
  const runDate = new Date().toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' });
  log(`BCBS Prefix Scraper — ${runDate} — ${CONFIG.testMode ? 'TEST' : 'FULL'} mode`);

  if (!CONFIG.cfApiToken) throw new Error('CF_API_TOKEN not set');

  log('Loading current D1 state...');
  const currentD1 = await getAllPrefixesFromD1();
  log(`D1 has ${Object.keys(currentD1).length} prefixes`);

  log(`Launching Chrome from: ${CONFIG.chromePath}`);
  const browser = await puppeteer.launch({
    executablePath: CONFIG.chromePath,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');

  log('Navigating to BCBS planfinder...');
  await page.goto('https://www.bcbs.com/planfinder/prefix', { waitUntil: 'networkidle2', timeout: 30000 });
  log('Page loaded');

  const prefixes = CONFIG.testMode ? CONFIG.testPrefixes : generateAllPrefixes();
  log(`Scraping ${prefixes.length} prefixes...`);
  const scraped = await scrapePrefixes(page, prefixes);
  await browser.close();
  log('Browser closed');

  const added = [], changed = [], removed = [];

  for (const [prefix, planData] of Object.entries(scraped)) {
    if (!planData) continue;
    const newName = planData.name;
    const existing = currentD1[prefix];
    if (!existing) {
      added.push({ prefix, plan: newName });
      const url = planData.urls?.general || planData.urls?.individualsFamilies || '';
      await upsertPrefix(prefix, newName, url);
      log(`  Added: ${prefix} → ${newName}`);
    } else if (existing !== newName) {
      changed.push({ prefix, oldPlan: existing, newPlan: newName });
      await updatePlanName(prefix, newName);
      log(`  Changed: ${prefix} — ${existing} → ${newName}`);
    }
  }

  if (!CONFIG.testMode) {
    for (const [prefix, existingPlan] of Object.entries(currentD1)) {
      if (scraped[prefix] === null) {
        removed.push({ prefix, oldPlan: existingPlan });
        await deletePrefix(prefix);
        log(`  Removed: ${prefix}`);
      }
    }
  }

  const total = Object.keys(currentD1).length + added.length - removed.length;
  log(`Done — Added: ${added.length} | Changed: ${changed.length} | Removed: ${removed.length} | Total: ${total}`);

  const hasChanges = added.length || changed.length || removed.length;
  const subject = hasChanges
    ? `⚠️ BCBS Prefix Update — ${added.length} added, ${changed.length} changed, ${removed.length} removed`
    : `✅ BCBS Prefix Check Complete — No changes (${runDate})`;

  await sendEmail(subject, buildEmail(added, changed, removed, total, runDate));
  log('Complete.');
  process.exit(0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
