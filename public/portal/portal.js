/* =========================================================
   The Ledger — friend portal.
   One script for all three portal pages; it picks its
   behaviour from whichever elements are present.
   ========================================================= */

async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

function currentMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}
function fmtMoney(n) {
  const num = Number(n) || 0;
  return '$' + num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg) {
  const root = document.getElementById('toastRoot');
  if (!root) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.innerHTML = '';
  root.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}
function isPaidThisMonth(sub) {
  const mk = currentMonthKey();
  return !!(sub.payments && sub.payments[mk] && sub.payments[mk].paid);
}
function isOverdue(sub) {
  if (isPaidThisMonth(sub)) return false;
  if (!sub.dueDay) return false;
  return new Date().getDate() > Number(sub.dueDay);
}
function chipClass(service) {
  if (service === 'Spotify') return 'chip-spotify';
  if (service === 'Snapchat') return 'chip-snapchat';
  return 'chip-custom';
}

/* ---------------- login & registration ---------------- */
function wireAuthForm(formId, endpoint) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submitBtn');
    const errEl = document.getElementById('formError');
    errEl.textContent = '';
    btn.disabled = true;
    try {
      await api(endpoint, {
        method: 'POST',
        body: JSON.stringify({
          email: document.getElementById('email').value.trim(),
          password: document.getElementById('password').value
        })
      });
      location.href = '/portal/dues.html';
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
    }
  });
}

wireAuthForm('portalLoginForm', '/api/portal/login');
wireAuthForm('portalRegisterForm', '/api/portal/register');

/* ---------------- dues page ---------------- */
async function loadDues() {
  const list = document.getElementById('duesList');
  if (!list) return;

  let friend;
  try {
    ({ friend } = await api('/api/portal/dues'));
  } catch {
    location.href = '/portal/login.html';
    return;
  }

  const mk = currentMonthKey();
  document.getElementById('duesName').textContent = friend.name;
  document.getElementById('duesMonth').textContent = monthLabel(mk);
  document.title = `The Ledger — ${friend.name}`;

  const subs = friend.subscriptions || [];
  const total = subs.reduce((t, s) => t + (Number(s.price) || 0), 0);
  const owed = subs.reduce((t, s) => t + (isPaidThisMonth(s) ? 0 : Number(s.price) || 0), 0);

  document.getElementById('duesSummary').innerHTML = `
    <div class="summary-card gold">
      <div class="label">Monthly total</div>
      <div class="value mono">${fmtMoney(total)}</div>
    </div>
    <div class="summary-card paid">
      <div class="label">Settled</div>
      <div class="value mono">${fmtMoney(total - owed)}</div>
    </div>
    <div class="summary-card ${owed > 0 ? 'unpaid' : 'paid'}">
      <div class="label">You owe</div>
      <div class="value mono">${fmtMoney(owed)}</div>
    </div>
  `;

  if (subs.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <h3>Nothing tracked yet</h3>
      <p>No subscriptions have been added to your name.</p>
    </div>`;
    return;
  }

  list.innerHTML = `<div class="friend-card">${subs.map(renderDueRow).join('')}</div>`;
}

function renderDueRow(sub) {
  const paid = isPaidThisMonth(sub);
  const overdue = isOverdue(sub);
  const label = sub.service === 'Custom' ? (sub.customLabel || 'Custom') : sub.service;
  const stampText = paid ? 'Paid' : (overdue ? 'Overdue' : 'Due');
  const stampClass = paid ? 'stamp-paid' : 'stamp-unpaid' + (overdue ? ' stamp-overdue' : '');
  return `
    <div class="sub-row">
      <div class="sub-left">
        <span class="service-chip ${chipClass(sub.service)}">${escapeHtml(label)}</span>
        <div>
          <div class="sub-price mono">${fmtMoney(sub.price)}<span class="per-mo">/mo</span></div>
          ${sub.dueDay ? `<div class="sub-due">Due day ${sub.dueDay}</div>` : ''}
        </div>
      </div>
      <div class="sub-actions">
        <span class="stamp ${stampClass}">${stampText}</span>
      </div>
    </div>
  `;
}

const logoutBtn = document.getElementById('btnLogout');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try { await api('/api/portal/logout', { method: 'POST' }); } catch { /* leave anyway */ }
    location.href = '/portal/login.html';
  });
}

loadDues();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
