// BCBS Home State Identifier — Application Logic
// v2.1 — API-backed
// API: https://project-1.arcaneowl.workers.dev

const API = 'https://project-1.arcaneowl.workers.dev';

window.addEventListener('scroll', function () {
  document.getElementById('gtt').style.display = window.scrollY > 300 ? 'flex' : 'none';
});

function sw(t) {
  ['sub', 'dir', 'pfx'].forEach(function (x) {
    document.getElementById('p-' + x).classList.toggle('hd', x !== t);
    document.getElementById('t-' + x).classList.toggle('on', x === t);
  });
  if (t === 'dir') fd();
}

function bd(v) { return v ? '<span class="ok">Available</span>' : '<span class="no">Not Available</span>'; }
function bds(v) { return v ? '<span class="ok">✓</span>' : '<span class="no">✗</span>'; }

// Badge order: 270 → 278 IP → 278 OP → Ref → 275
function txBadges(t, size) {
  var s = size === 'sm' ? '' : '';
  var h = '';
  h += (t.eligibility_270 || t.has_270    ? '<span class="ok">270</span>'    : '<span class="no">270</span>');
  h += (t.pa_inpatient_278 || t.has_pa_in ? '<span class="ok">278 IP</span>' : '<span class="no">278 IP</span>');
  h += (t.pa_outpatient_278||t.has_pa_out ? '<span class="ok">278 OP</span>' : '<span class="no">278 OP</span>');
  h += (t.referral_278 || t.has_ref       ? '<span class="ok">Ref</span>'    : '<span class="no">Ref</span>');
  h += (t.attachments_275 || t.has_275    ? '<span class="at">275</span>'    : '<span class="no">275</span>');
  return h;
}

var VALID_PFX = /^[A-Z2-9]{3}$/;
var HAS_INVALID = /[^A-Za-z2-9]/;
var HAS_01 = /[01]/;

function vi() {
  var el = document.getElementById('vm');
  var raw = document.getElementById('sId').value.trim();
  if (!raw) { el.innerHTML = ''; return; }
  if (raw.length < 3) { el.innerHTML = '<div class="vm vm-w">Enter at least 3 characters</div>'; return; }
  var pfx = raw.substring(0, 3).toUpperCase();
  if (HAS_INVALID.test(pfx)) { el.innerHTML = '<div class="vm vm-e">✗ BCBS prefixes contain only letters (A-Z) and digits (2-9).</div>'; return; }
  if (HAS_01.test(pfx)) { el.innerHTML = '<div class="vm vm-e">✗ BCBS prefixes do not use digits 0 or 1.</div>'; return; }
  if (!VALID_PFX.test(pfx)) { el.innerHTML = '<div class="vm vm-e">✗ Not a valid BCBS prefix format.</div>'; return; }
  el.innerHTML = '';
}

function lu() {
  var raw = document.getElementById('sId').value.trim().replace(/\s+/g, '');
  var el = document.getElementById('sr');
  if (raw.length < 3) { el.innerHTML = '<div class="al al-e">Enter at least 3 characters.</div>'; return; }
  var pfx = raw.substring(0, 3).toUpperCase();
  if (HAS_INVALID.test(pfx) || HAS_01.test(pfx) || !VALID_PFX.test(pfx)) {
    el.innerHTML = '<div class="al al-e">Not a valid BCBS prefix format. Use letters A-Z and digits 2-9 (no 0 or 1).</div>'; return;
  }
  el.innerHTML = '<div class="al al-i">Looking up prefix <strong>' + pfx + '</strong>...</div>';
  document.getElementById('vm').innerHTML = '';

  fetch(API + '/lookup?prefix=' + pfx)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.error) { el.innerHTML = '<div class="al al-e">✗ ' + data.error + '</div>'; return; }
      var t = data.transactions;
      var h = '<div class="rc">';
      h += '<div class="fl row" style="gap:12px;margin-bottom:14px">';
      h += '<div class="pb"><div class="l">Prefix</div><div class="v">' + data.prefix + '</div></div>';
      h += '<div style="font-size:20px;color:var(--s)">→</div>';
      h += '<div><div style="font-size:19px;font-weight:800;color:var(--pd)">' + data.plan_name + '</div>';
      h += '<div style="font-size:13px;color:var(--s);margin-top:2px">Home State: <strong>' + data.state + '</strong>';
      h += ' • ' + data.prefix_count + ' prefixes';
      h += ' • <a href="' + data.website_url + '" target="_blank">Website ↗</a></div></div></div>';
      h += '<div class="fl row" style="gap:5px;margin-bottom:12px">' + txBadges(t) + '</div>';
      h += avTableFromAPI(data);
      h += '<div class="al al-i mt">All PA and Referral submissions for this member must be directed to <strong>' + data.plan_name + '</strong> (' + data.state + ').</div>';
      h += '<div style="margin-top:10px;text-align:right"><button class="btn" style="background:var(--s);font-size:12px;padding:6px 12px" onclick="openFeedback(\'' + data.prefix + '\',\'' + data.plan_name.replace(/'/g, "\\'") + '\')">⚑ Flag incorrect data</button></div>';
      h += '</div>';
      el.innerHTML = h;
    })
    .catch(function () { el.innerHTML = '<div class="al al-e">Network error. Please try again.</div>'; });
}

function avTableFromAPI(data) {
  var t = data.transactions;
  var pids = data.availity_payer_ids || '';
  if (!pids && !t.eligibility_270 && !t.pa_inpatient_278 && !t.pa_outpatient_278 && !t.referral_278 && !t.attachments_275) {
    return '<div class="al al-w" style="margin-top:8px">Not supported via Availity REST API. Submit via <a href="' + data.website_url + '" target="_blank">payer portal</a>.</div>';
  }
  var h = '<table class="avtbl"><tr><th>Availity ID</th><th>270 Elig</th><th>278 Inpatient</th><th>278 Outpatient</th><th>278 Referral</th><th>275 Attach</th></tr>';
  var pidList = pids ? pids.split(',') : ['—'];
  pidList.forEach(function (pid) {
    h += '<tr><td class="mono" style="font-size:14px">' + pid.trim() + '</td>';
    h += '<td>' + bd(t.eligibility_270) + '</td>';
    h += '<td>' + bd(t.pa_inpatient_278) + '</td>';
    h += '<td>' + bd(t.pa_outpatient_278) + '</td>';
    h += '<td>' + bd(t.referral_278) + '</td>';
    h += '<td>' + (t.attachments_275 ? '<span class="at">Available</span>' : '<span class="no">Not Available</span>') + '</td></tr>';
  });
  h += '</table>';
  return h;
}

// ── Plan Directory ─────────────────────────────────────────────────────────

function fd() {
  var s = document.getElementById('ds').value.toLowerCase().trim();
  var st = document.getElementById('df').value;
  var dr = document.getElementById('dr');
  var dd = document.getElementById('dd');

  // Transaction filters
  var f270  = document.getElementById('f270').checked;
  var f278i = document.getElementById('f278i').checked;
  var f278o = document.getElementById('f278o').checked;
  var fRef  = document.getElementById('fRef').checked;
  var f275  = document.getElementById('f275').checked;

  dd.textContent = 'Loading...';
  dr.innerHTML = '<div class="al al-i">Fetching plans...</div>';

  var params = [];
  if (st) params.push('state=' + encodeURIComponent(st));
  if (s)  params.push('search=' + encodeURIComponent(s));
  var qs = params.length ? '?' + params.join('&') : '';

  fetch(API + '/plans' + qs)
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var plans = data.plans || [];

      // Client-side transaction filter
      if (f270)  plans = plans.filter(function(p){ return p.has_270; });
      if (f278i) plans = plans.filter(function(p){ return p.has_pa_in; });
      if (f278o) plans = plans.filter(function(p){ return p.has_pa_out; });
      if (fRef)  plans = plans.filter(function(p){ return p.has_ref; });
      if (f275)  plans = plans.filter(function(p){ return p.has_275; });

      dd.textContent = plans.length + ' plan' + (plans.length !== 1 ? 's' : '');
      var h = '';
      plans.forEach(function (p, i) {
        var id = 'ac' + i;
        var t = { has_270: p.has_270, has_pa_in: p.has_pa_in, has_pa_out: p.has_pa_out, has_ref: p.has_ref, has_275: p.has_275 };
        h += '<div class="pr">';
        h += '<div class="acc-toggle fl row" style="justify-content:space-between" onclick="ta(\'' + id + '\')">';
        h += '<div><div style="font-size:15px;font-weight:700">' + p.plan_name + '</div>';
        h += '<div style="font-size:13px;color:var(--s);margin-top:2px">' + p.state + ' • ' + p.prefix_count + ' prefixes</div></div>';
        h += '<div class="fl row" style="gap:4px">' + txBadges(t) + '</div></div>';
        h += '<div class="acc-body" id="' + id + '">';
        var pids = p.availity_payer_ids || '';
        if (!pids && !p.has_270 && !p.has_pa_in && !p.has_pa_out) {
          h += '<div class="al al-w" style="margin-top:8px">Not supported via Availity REST API. <a href="' + p.website_url + '" target="_blank">Payer portal ↗</a></div>';
        } else {
          h += '<table class="avtbl"><tr><th>Availity ID(s)</th><th>270</th><th>278 IP</th><th>278 OP</th><th>Ref</th><th>275</th></tr>';
          h += '<tr><td class="mono" style="font-size:13px">' + (pids || '—') + '</td>';
          h += '<td>' + bds(p.has_270) + '</td><td>' + bds(p.has_pa_in) + '</td><td>' + bds(p.has_pa_out) + '</td>';
          h += '<td>' + bds(p.has_ref) + '</td><td>' + (p.has_275 ? '<span class="at">✓</span>' : bds(false)) + '</td></tr></table>';
        }
        h += '</div></div>';
      });
      dr.innerHTML = h || '<div class="al al-w">No plans match the selected filters.</div>';
    })
    .catch(function () {
      dr.innerHTML = '<div class="al al-e">Network error loading plans.</div>';
      dd.textContent = '';
    });
}

function ta(id) { document.getElementById(id).classList.toggle('open'); }

// ── Prefix Search — triggers only on full 3 chars ─────────────────────────

function sp() {
  var input = document.getElementById('pi');
  input.value = input.value.toUpperCase().replace(/[^A-Z2-9]/g, '');
  var v = input.value;
  var el = document.getElementById('px'), st = document.getElementById('pst');

  if (v.length < 3) {
    el.innerHTML = '';
    st.textContent = v.length > 0 ? 'Enter ' + (3 - v.length) + ' more character' + (3 - v.length > 1 ? 's' : '') : '';
    return;
  }

  st.textContent = 'Searching...';

  fetch(API + '/prefix-search?q=' + encodeURIComponent(v))
    .then(function (r) { return r.json(); })
    .then(function (data) {
      var results = data.prefixes || [];
      st.textContent = results.length + ' prefix' + (results.length !== 1 ? 'es' : '') + ' found' + (results.length === 200 ? ' (showing first 200)' : '');
      if (!results.length) { el.innerHTML = '<div class="al al-w">No prefixes found starting with <strong>' + v + '</strong>.</div>'; return; }
      var h = '<table class="ptbl"><tr><th>Prefix</th><th>BCBS Plan</th><th>State</th><th>Availity ID</th><th>270</th><th>278 IP</th><th>278 OP</th><th>Ref</th><th>275</th></tr>';
      results.forEach(function (x) {
        h += '<tr><td class="mono">' + x.alpha_prefix + '</td><td>' + x.plan_name + '</td><td>' + x.state + '</td>';
        h += '<td class="mono" style="font-size:12px">' + (x.availity_payer_ids || '—') + '</td>';
        h += '<td>' + bds(x.has_270) + '</td><td>' + bds(x.has_pa_in) + '</td><td>' + bds(x.has_pa_out) + '</td>';
        h += '<td>' + bds(x.has_ref) + '</td><td>' + (x.has_275 ? '<span class="at">✓</span>' : bds(false)) + '</td></tr>';
      });
      h += '</table>';
      el.innerHTML = h;
    })
    .catch(function () { st.textContent = 'Network error.'; el.innerHTML = ''; });
}

// ── Feedback modal ─────────────────────────────────────────────────────────

function openFeedback(prefix, planName) {
  document.getElementById('fbPrefix').value = prefix;
  document.getElementById('fbPlan').value = planName;
  document.getElementById('fbCorrect').value = '';
  document.getElementById('fbDesc').value = '';
  document.getElementById('fbResult').innerHTML = '';
  var btn = document.getElementById('fbSubmitBtn');
  btn.disabled = false;
  btn.textContent = 'Send Feedback';
  document.getElementById('feedbackModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeFeedback() {
  document.getElementById('feedbackModal').classList.remove('open');
  document.body.style.overflow = '';
}

function submitFeedback() {
  var prefix = document.getElementById('fbPrefix').value;
  var plan   = document.getElementById('fbPlan').value;
  var correct = document.getElementById('fbCorrect').value.trim();
  var desc    = document.getElementById('fbDesc').value.trim();
  var btn     = document.getElementById('fbSubmitBtn');
  var result  = document.getElementById('fbResult');

  if (!desc && !correct) {
    result.innerHTML = '<span style="color:var(--et);font-size:13px">Please describe the issue or provide the correct plan name.</span>';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Sending...';
  result.innerHTML = '';

  fetch(API + '/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ alpha_prefix: prefix, reported_plan: plan, correct_plan: correct, issue_description: desc })
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.success) {
        result.innerHTML = '<span style="color:var(--ok);font-size:13px;font-weight:700">✓ Feedback sent. Thank you!</span>';
        btn.textContent = 'Sent';
        setTimeout(closeFeedback, 2000);
      } else {
        result.innerHTML = '<span style="color:var(--et);font-size:13px">Submission failed. Please try again.</span>';
        btn.disabled = false;
        btn.textContent = 'Send Feedback';
      }
    })
    .catch(function () {
      result.innerHTML = '<span style="color:var(--et);font-size:13px">Network error. Please try again.</span>';
      btn.disabled = false;
      btn.textContent = 'Send Feedback';
    });
}

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') { closeFeedback(); closePfx(); }
});
function closePfx() {
  var m = document.getElementById('pfxModal');
  if (m) { m.classList.remove('open'); document.body.style.overflow = ''; }
}

// ── State dropdown ─────────────────────────────────────────────────────────
(function () {
  var states = ["AL","AR","AZ","CA","CO","CT","DC/MD/VA","DE","FL","GA","HI","IA","ID","IL","IN","INTL","KS","KY","LA","MA","ME","MI","MN","MO","MS","MT","MULTI","NC","ND","NE","NH","NJ","NM","NV","NY","OH","OK","OR","PA","PR","RI","SC","SD","TN","TX","UT","VA","VT","WA","WI","WV","WY"];
  var sel = document.getElementById('df');
  states.forEach(function (s) {
    var o = document.createElement('option');
    o.value = s; o.textContent = s;
    sel.appendChild(o);
  });
})();
