/* =========================================================
   Helpers shared by the admin dashboard and the friend portal.
   Loaded before either page's own script.
   ========================================================= */

/* Change these two lines to track a different currency. */
const CURRENCY = 'SAR';
const CURRENCY_LOCALE = 'en-SA';

const moneyFormatter = new Intl.NumberFormat(CURRENCY_LOCALE, {
  style: 'currency',
  currency: CURRENCY,
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

function fmtMoney(n) {
  return moneyFormatter.format(Number(n) || 0);
}

function currentMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
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

function subLabel(sub) {
  return sub.service === 'Custom' ? (sub.customLabel || 'Custom') : sub.service;
}

function ordinalSuffix(n) {
  n = Number(n);
  if (n % 10 === 1 && n % 100 !== 11) return 'st';
  if (n % 10 === 2 && n % 100 !== 12) return 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return 'rd';
  return 'th';
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

/** Clipboard needs a secure context; fall back to a temporary textarea. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
