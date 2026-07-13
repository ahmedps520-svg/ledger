/* =========================================================
   The Ledger — subscription tracker for friends you cover
   All data lives in this browser's localStorage. No server,
   no accounts other than the one admin login below.
   ========================================================= */

const ADMIN_EMAIL = 'ahmedps520@gmail.com';
// SHA-256 of "ahmedps520@gmail.com:spotify123@" — the raw password
// is never stored in this file, only its hash is compared.
const ADMIN_HASH = 'e07d5472a54b802a5f2aea2b39a63c170c269cd77dab6a135a27fb605201d1ef';

const SESSION_KEY = 'ledger_session';
const DATA_KEY = 'ledger_friends_v1';

const SERVICES = ['Spotify', 'Snapchat', 'Custom'];

/* ---------------- utils ---------------- */
function uid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
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
function todayDay() { return new Date().getDate(); }

function toast(msg) {
  const root = document.getElementById('toastRoot');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  root.innerHTML = '';
  root.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

/* ---------------- data layer ---------------- */
function loadFriends() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}
function saveFriends(friends) {
  localStorage.setItem(DATA_KEY, JSON.stringify(friends));
}

let state = {
  friends: loadFriends(),
  search: '',
  filter: 'all'
};

function findFriend(id) { return state.friends.find(f => f.id === id); }
function findSub(friendId, subId) {
  const f = findFriend(friendId);
  return f ? f.subscriptions.find(s => s.id === subId) : null;
}

function isPaidThisMonth(sub) {
  const mk = currentMonthKey();
  return !!(sub.payments && sub.payments[mk] && sub.payments[mk].paid);
}
function isOverdue(sub) {
  if (isPaidThisMonth(sub)) return false;
  if (!sub.dueDay) return false;
  return todayDay() > Number(sub.dueDay);
}

/* ---------------- auth ---------------- */
async function tryLogin(email, password) {
  const h = await sha256(`${email.trim().toLowerCase()}:${password}`);
  return h === ADMIN_HASH;
}
function isLoggedIn() { return sessionStorage.getItem(SESSION_KEY) === '1'; }
function setLoggedIn(v) {
  if (v) sessionStorage.setItem(SESSION_KEY, '1');
  else sessionStorage.removeItem(SESSION_KEY);
}

function showScreen(loggedIn) {
  document.getElementById('screenLogin').classList.toggle('hidden', loggedIn);
  document.getElementById('screenApp').classList.toggle('hidden', !loggedIn);
  if (loggedIn) renderAll();
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  const ok = await tryLogin(email, password);
  if (ok) {
    setLoggedIn(true);
    document.getElementById('loginForm').reset();
    showScreen(true);
  } else {
    errEl.textContent = 'Incorrect email or password.';
  }
});

document.getElementById('btnLogout').addEventListener('click', () => {
  setLoggedIn(false);
  showScreen(false);
});

/* ---------------- rendering ---------------- */
function renderAll() {
  renderSummary();
  renderFriendList();
}

function renderSummary() {
  const mk = currentMonthKey();
  let expected = 0, collected = 0, unpaidCount = 0, overdueCount = 0, totalSubs = 0;
  state.friends.forEach(f => f.subscriptions.forEach(s => {
    totalSubs++;
    expected += Number(s.price) || 0;
    if (isPaidThisMonth(s)) collected += Number(s.price) || 0;
    else { unpaidCount++; if (isOverdue(s)) overdueCount++; }
  }));
  const outstanding = expected - collected;
  const grid = document.getElementById('summaryGrid');
  grid.innerHTML = `
    <div class="summary-card gold">
      <div class="label">${monthLabel(mk)}</div>
      <div class="value mono">${fmtMoney(expected)}</div>
    </div>
    <div class="summary-card paid">
      <div class="label">Collected</div>
      <div class="value mono">${fmtMoney(collected)}</div>
    </div>
    <div class="summary-card unpaid">
      <div class="label">Outstanding</div>
      <div class="value mono">${fmtMoney(outstanding)}</div>
    </div>
    <div class="summary-card">
      <div class="label">${overdueCount > 0 ? 'Overdue' : 'Friends tracked'}</div>
      <div class="value mono">${overdueCount > 0 ? overdueCount : state.friends.length}</div>
    </div>
  `;
}

function chipClass(service) {
  if (service === 'Spotify') return 'chip-spotify';
  if (service === 'Snapchat') return 'chip-snapchat';
  return 'chip-custom';
}

function subMatchesFilter(sub) {
  const f = state.filter;
  if (f === 'all') return true;
  if (f === 'paid') return isPaidThisMonth(sub);
  if (f === 'unpaid') return !isPaidThisMonth(sub);
  return sub.service === f;
}

function renderFriendList() {
  const list = document.getElementById('friendList');
  const q = state.search.trim().toLowerCase();
  const friends = state.friends
    .filter(f => !q || f.name.toLowerCase().includes(q))
    .filter(f => f.subscriptions.some(subMatchesFilter) || f.subscriptions.length === 0);

  if (state.friends.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <h3>No one in the ledger yet</h3>
      <p>Tap the + button to add the first friend and set up what you're covering for them.</p>
    </div>`;
    return;
  }
  if (friends.length === 0) {
    list.innerHTML = `<div class="empty-state"><h3>No matches</h3><p>Try a different search or filter.</p></div>`;
    return;
  }

  list.innerHTML = friends.map(f => {
    const visibleSubs = f.subscriptions.filter(subMatchesFilter);
    const subsHtml = visibleSubs.length
      ? visibleSubs.map(s => renderSubRow(f, s)).join('')
      : `<div class="sub-row"><span class="mono" style="color:var(--muted); font-size:13px;">No subscriptions match the current filter.</span></div>`;
    return `
      <div class="friend-card" data-friend="${f.id}">
        <div class="friend-top">
          <div>
            <div class="friend-name">${escapeHtml(f.name)}</div>
            <div class="friend-meta">${f.subscriptions.length} subscription${f.subscriptions.length === 1 ? '' : 's'}${f.note ? ' · ' + escapeHtml(f.note) : ''}</div>
          </div>
          <div class="friend-top-actions">
            <button class="btn btn-ghost btn-sm" data-action="add-sub" data-friend="${f.id}">+ Sub</button>
            <button class="icon-btn" data-action="edit-friend" data-friend="${f.id}" title="Edit / remove friend">⋯</button>
          </div>
        </div>
        ${subsHtml}
      </div>
    `;
  }).join('');
}

function renderSubRow(friend, sub) {
  const paid = isPaidThisMonth(sub);
  const overdue = isOverdue(sub);
  const label = sub.service === 'Custom' ? (sub.customLabel || 'Custom') : sub.service;
  const stampText = paid ? 'Paid' : (overdue ? 'Overdue' : 'Due');
  const stampClass = paid ? 'stamp-paid' : 'stamp-unpaid' + (overdue ? ' stamp-overdue' : '');
  return `
    <div class="sub-row" data-sub="${sub.id}">
      <div class="sub-left">
        <span class="service-chip ${chipClass(sub.service)}">${escapeHtml(label)}</span>
        <div>
          <div class="sub-price mono">${fmtMoney(sub.price)}<span style="color:var(--muted); font-weight:400; font-size:12px;">/mo</span></div>
          ${sub.dueDay ? `<div class="sub-due">Due day ${sub.dueDay}</div>` : ''}
        </div>
      </div>
      <div class="sub-actions">
        <span class="stamp ${stampClass}">${stampText}</span>
        <button class="icon-btn" data-action="toggle-paid" data-friend="${friend.id}" data-sub="${sub.id}" title="Mark ${paid ? 'unpaid' : 'paid'}">${paid ? '↺' : '✓'}</button>
        <button class="icon-btn" data-action="share-sub" data-friend="${friend.id}" data-sub="${sub.id}" title="Share reminder">↗</button>
        <button class="icon-btn" data-action="edit-sub" data-friend="${friend.id}" data-sub="${sub.id}" title="Edit subscription">✎</button>
      </div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- event delegation on friend list ---------------- */
document.getElementById('friendList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const action = btn.dataset.action;
  const friendId = btn.dataset.friend;
  const subId = btn.dataset.sub;

  if (action === 'add-sub') openAddSubModal(friendId);
  if (action === 'edit-friend') openEditFriendModal(friendId);
  if (action === 'toggle-paid') togglePaid(friendId, subId);
  if (action === 'share-sub') openShareModal(friendId, subId);
  if (action === 'edit-sub') openEditSubModal(friendId, subId);
});

function togglePaid(friendId, subId) {
  const sub = findSub(friendId, subId);
  if (!sub) return;
  const mk = currentMonthKey();
  sub.payments = sub.payments || {};
  const wasPaid = !!(sub.payments[mk] && sub.payments[mk].paid);
  sub.payments[mk] = { paid: !wasPaid, at: new Date().toISOString() };
  saveFriends(state.friends);
  renderAll();
  toast(wasPaid ? 'Marked unpaid for this month' : 'Marked paid for this month');
}

/* ---------------- search / filter ---------------- */
document.getElementById('searchInput').addEventListener('input', (e) => {
  state.search = e.target.value;
  renderFriendList();
});
document.getElementById('filterSelect').addEventListener('change', (e) => {
  state.filter = e.target.value;
  renderFriendList();
});

/* ---------------- modal system ---------------- */
function openModal(html) {
  const root = document.getElementById('modalRoot');
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal">${html}</div></div>`;
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}

/* ---- Add friend ---- */
document.getElementById('fabAdd').addEventListener('click', openAddFriendModal);

function openAddFriendModal() {
  openModal(`
    <h2>Add a friend</h2>
    <form id="formAddFriend">
      <div class="field">
        <label for="newFriendName">Name</label>
        <input type="text" id="newFriendName" placeholder="e.g. Sarah" required>
      </div>
      <div class="field">
        <label for="newFriendNote">Note (optional)</label>
        <input type="text" id="newFriendNote" placeholder="e.g. college roommate">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelAddFriend">Cancel</button>
        <button type="submit" class="btn btn-primary">Add friend</button>
      </div>
    </form>
  `);
  document.getElementById('cancelAddFriend').addEventListener('click', closeModal);
  document.getElementById('formAddFriend').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = document.getElementById('newFriendName').value.trim();
    const note = document.getElementById('newFriendNote').value.trim();
    if (!name) return;
    state.friends.push({ id: uid(), name, note, subscriptions: [] });
    saveFriends(state.friends);
    closeModal();
    renderAll();
    toast(`${name} added to the ledger`);
  });
}

/* ---- Edit / remove friend ---- */
function openEditFriendModal(friendId) {
  const f = findFriend(friendId);
  if (!f) return;
  openModal(`
    <h2>Edit friend</h2>
    <form id="formEditFriend">
      <div class="field">
        <label for="editFriendName">Name</label>
        <input type="text" id="editFriendName" value="${escapeHtml(f.name)}" required>
      </div>
      <div class="field">
        <label for="editFriendNote">Note</label>
        <input type="text" id="editFriendNote" value="${escapeHtml(f.note || '')}">
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" id="deleteFriendBtn">Remove friend</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);
  document.getElementById('formEditFriend').addEventListener('submit', (e) => {
    e.preventDefault();
    f.name = document.getElementById('editFriendName').value.trim() || f.name;
    f.note = document.getElementById('editFriendNote').value.trim();
    saveFriends(state.friends);
    closeModal();
    renderAll();
  });
  document.getElementById('deleteFriendBtn').addEventListener('click', () => {
    if (!confirm(`Remove ${f.name} and all their subscriptions? This can't be undone.`)) return;
    state.friends = state.friends.filter(x => x.id !== friendId);
    saveFriends(state.friends);
    closeModal();
    renderAll();
    toast('Friend removed');
  });
}

/* ---- Add subscription ---- */
function openAddSubModal(friendId) {
  const f = findFriend(friendId);
  if (!f) return;
  renderSubForm({
    title: `Add subscription for ${f.name}`,
    service: 'Spotify',
    customLabel: '',
    price: '',
    dueDay: '',
    onSubmit: (data) => {
      f.subscriptions.push({ id: uid(), payments: {}, ...data });
      saveFriends(state.friends);
      closeModal();
      renderAll();
      toast('Subscription added');
    }
  });
}

/* ---- Edit subscription ---- */
function openEditSubModal(friendId, subId) {
  const f = findFriend(friendId);
  const s = findSub(friendId, subId);
  if (!f || !s) return;
  renderSubForm({
    title: `Edit subscription — ${f.name}`,
    service: s.service,
    customLabel: s.customLabel || '',
    price: s.price,
    dueDay: s.dueDay || '',
    showDelete: true,
    showHistory: s,
    onSubmit: (data) => {
      Object.assign(s, data);
      saveFriends(state.friends);
      closeModal();
      renderAll();
      toast('Subscription updated');
    },
    onDelete: () => {
      if (!confirm('Remove this subscription?')) return;
      f.subscriptions = f.subscriptions.filter(x => x.id !== subId);
      saveFriends(state.friends);
      closeModal();
      renderAll();
      toast('Subscription removed');
    }
  });
}

function renderSubForm({ title, service, customLabel, price, dueDay, showDelete, showHistory, onSubmit, onDelete }) {
  const historyHtml = showHistory ? buildHistoryHtml(showHistory) : '';
  openModal(`
    <h2>${title}</h2>
    <form id="formSub">
      <label style="display:block; font-size:12.5px; color:var(--muted); margin-bottom:8px; text-transform:uppercase; letter-spacing:.02em;">Service</label>
      <div class="chip-select" id="serviceChips">
        ${SERVICES.map(s => `<div class="chip-option ${s === service ? 'active' : ''}" data-service="${s}">${s}</div>`).join('')}
      </div>
      <div class="field" id="customLabelField" style="${service === 'Custom' ? '' : 'display:none;'}">
        <label for="customLabelInput">Custom label</label>
        <input type="text" id="customLabelInput" placeholder="e.g. YouTube Premium" value="${escapeHtml(customLabel)}">
      </div>
      <div class="modal-row">
        <div class="field">
          <label for="subPrice">Price / month</label>
          <input type="number" id="subPrice" step="0.01" min="0" placeholder="0.00" value="${price !== '' ? price : ''}" required>
        </div>
        <div class="field">
          <label for="subDueDay">Due day (1–28)</label>
          <input type="number" id="subDueDay" min="1" max="28" placeholder="e.g. 5" value="${dueDay}">
        </div>
      </div>
      ${historyHtml}
      <div class="modal-actions">
        ${showDelete ? '<button type="button" class="btn btn-danger" id="deleteSubBtn">Remove</button>' : '<button type="button" class="btn btn-ghost" id="cancelSubBtn">Cancel</button>'}
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
  `);

  let selectedService = service;
  document.querySelectorAll('#serviceChips .chip-option').forEach(chip => {
    chip.addEventListener('click', () => {
      selectedService = chip.dataset.service;
      document.querySelectorAll('#serviceChips .chip-option').forEach(c => c.classList.toggle('active', c === chip));
      document.getElementById('customLabelField').style.display = selectedService === 'Custom' ? '' : 'none';
    });
  });

  const cancelBtn = document.getElementById('cancelSubBtn');
  if (cancelBtn) cancelBtn.addEventListener('click', closeModal);
  const deleteBtn = document.getElementById('deleteSubBtn');
  if (deleteBtn) deleteBtn.addEventListener('click', onDelete);

  document.getElementById('formSub').addEventListener('submit', (e) => {
    e.preventDefault();
    const data = {
      service: selectedService,
      customLabel: selectedService === 'Custom' ? document.getElementById('customLabelInput').value.trim() : '',
      price: parseFloat(document.getElementById('subPrice').value) || 0,
      dueDay: document.getElementById('subDueDay').value ? parseInt(document.getElementById('subDueDay').value, 10) : null
    };
    onSubmit(data);
  });
}

function buildHistoryHtml(sub) {
  const months = Object.keys(sub.payments || {}).sort().reverse().slice(0, 6);
  if (months.length === 0) return '';
  const rows = months.map(mk => {
    const p = sub.payments[mk];
    return `<div class="hist-row ${p.paid ? 'was-paid' : ''}"><span>${monthLabel(mk)}</span><span>${p.paid ? 'Paid' : 'Unpaid'}</span></div>`;
  }).join('');
  return `<div class="payment-history"><label style="display:block; font-size:12.5px; color:var(--muted); margin-bottom:2px; text-transform:uppercase;">Recent history</label>${rows}</div>`;
}

/* ---- Share reminder ---- */
function openShareModal(friendId, subId) {
  const f = findFriend(friendId);
  const s = findSub(friendId, subId);
  if (!f || !s) return;
  const label = s.service === 'Custom' ? (s.customLabel || 'subscription') : s.service;
  const mk = currentMonthKey();
  const paid = isPaidThisMonth(s);
  const dueText = s.dueDay ? ` (due the ${s.dueDay}${ordinalSuffix(s.dueDay)})` : '';
  const text = paid
    ? `Hey ${f.name}! Just confirming your ${label} for ${monthLabel(mk)} is marked paid on my end. Thanks!`
    : `Hey ${f.name}! Friendly reminder that your ${label}${dueText} for ${monthLabel(mk)} is ${fmtMoney(s.price)}, cash whenever works for you. Thanks!`;

  openModal(`
    <h2>Share reminder</h2>
    <div class="share-preview" id="sharePreviewText">${escapeHtml(text)}</div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="copyShareBtn">Copy text</button>
      <button type="button" class="btn btn-primary" id="sendShareBtn">Share…</button>
    </div>
  `);
  document.getElementById('copyShareBtn').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Could not copy — select the text manually');
    }
  });
  document.getElementById('sendShareBtn').addEventListener('click', async () => {
    if (navigator.share) {
      try { await navigator.share({ text }); closeModal(); }
      catch { /* user cancelled */ }
    } else {
      try {
        await navigator.clipboard.writeText(text);
        toast('Share isn\'t supported here — copied instead');
      } catch {
        toast('Copy the text above to share it');
      }
    }
  });
}
function ordinalSuffix(n) {
  n = Number(n);
  if (n % 10 === 1 && n % 100 !== 11) return 'st';
  if (n % 10 === 2 && n % 100 !== 12) return 'nd';
  if (n % 10 === 3 && n % 100 !== 13) return 'rd';
  return 'th';
}

/* ---- Backup / restore ---- */
document.getElementById('btnBackup').addEventListener('click', () => {
  openModal(`
    <h2>Backup &amp; restore</h2>
    <p style="color:var(--muted); font-size:13.5px; margin-bottom:18px;">Everything is stored only in this browser. Export a copy so you don't lose it, or restore from a previous export.</p>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="exportBtn">Export backup</button>
      <button type="button" class="btn btn-primary" id="importBtn">Import backup</button>
    </div>
    <input type="file" id="importFile" accept="application/json" style="display:none;">
  `);
  document.getElementById('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state.friends, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ledger-backup-${currentMonthKey()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded');
  });
  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });
  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('bad format');
        if (!confirm('This will replace all current data with the imported backup. Continue?')) return;
        state.friends = data;
        saveFriends(state.friends);
        closeModal();
        renderAll();
        toast('Backup restored');
      } catch {
        toast('That file could not be read as a backup');
      }
    };
    reader.readAsText(file);
  });
});

/* ---------------- boot ---------------- */
showScreen(isLoggedIn());

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
