/* =========================================================
   The Ledger — admin dashboard.
   All data lives on the server; this file only renders it and
   posts changes back. Nothing is cached in localStorage, so the
   same book shows up on every device you sign in from.
   ========================================================= */

const SERVICES = ['Spotify', 'Snapchat', 'Custom'];

let state = {
  friends: [],
  search: '',
  filter: 'all'
};

/* ---------------- api helper ---------------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : {},
    ...options
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (res.status === 401) {
    showScreen('login');
    throw new Error(data.error || 'Not signed in.');
  }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status}).`);
  return data;
}

/* ---------------- lookups ---------------- */
function findFriend(id) { return state.friends.find(f => f.id === id); }
function findSub(friendId, subId) {
  const f = findFriend(friendId);
  return f ? f.subscriptions.find(s => s.id === subId) : null;
}

/** Replace one friend in state with the server's copy after a write. */
function mergeFriend(friend) {
  const i = state.friends.findIndex(f => f.id === friend.id);
  if (i >= 0) state.friends[i] = friend;
  else state.friends.push(friend);
}

/* ---------------- screens & auth ---------------- */
function showScreen(which) {
  for (const [id, name] of [['screenLoading', 'loading'], ['screenLogin', 'login'], ['screenApp', 'app']]) {
    document.getElementById(id).classList.toggle('hidden', which !== name);
  }
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('loginSubmit');
  const errEl = document.getElementById('loginError');
  errEl.textContent = '';
  btn.disabled = true;
  try {
    await api('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify({
        email: document.getElementById('loginEmail').value,
        password: document.getElementById('loginPassword').value
      })
    });
    document.getElementById('loginForm').reset();
    await enterApp();
  } catch (err) {
    errEl.textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

document.getElementById('btnLogout').addEventListener('click', async () => {
  try { await api('/api/admin/logout', { method: 'POST' }); } catch { /* log out locally anyway */ }
  state.friends = [];
  showScreen('login');
});

async function enterApp() {
  const { friends } = await api('/api/admin/friends');
  state.friends = friends;
  showScreen('app');
  renderAll();
}

/* ---------------- rendering ---------------- */
function renderAll() {
  renderSummary();
  renderFriendList();
}

function renderSummary() {
  const mk = currentMonthKey();
  let expected = 0, collected = 0, overdueCount = 0;
  state.friends.forEach(f => f.subscriptions.forEach(s => {
    expected += Number(s.price) || 0;
    if (isPaidThisMonth(s)) collected += Number(s.price) || 0;
    else if (isOverdue(s)) overdueCount++;
  }));
  const outstanding = expected - collected;
  document.getElementById('summaryGrid').innerHTML = `
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
    .filter(f => !q || f.name.toLowerCase().includes(q) || (f.email || '').toLowerCase().includes(q))
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
      : `<div class="sub-row"><span class="mono dim-note">No subscriptions match the current filter.</span></div>`;
    const owed = f.subscriptions.reduce((t, s) => t + (isPaidThisMonth(s) ? 0 : Number(s.price) || 0), 0);
    const meta = [
      `${f.subscriptions.length} subscription${f.subscriptions.length === 1 ? '' : 's'}`,
      owed > 0 ? `${fmtMoney(owed)} due` : 'all settled',
      f.note ? escapeHtml(f.note) : null
    ].filter(Boolean).join(' · ');
    return `
      <div class="friend-card" data-friend="${f.id}">
        <div class="friend-top">
          <div class="friend-ident">
            <div class="friend-name">${escapeHtml(f.name)}</div>
            <div class="friend-meta">${meta}</div>
          </div>
          <div class="friend-top-actions">
            <button class="btn btn-ghost btn-sm" data-action="copy-link" data-friend="${f.id}" title="Copy this friend's private dues link">Link</button>
            <button class="btn btn-ghost btn-sm" data-action="add-sub" data-friend="${f.id}">+ Sub</button>
            <button class="icon-btn" data-action="edit-friend" data-friend="${f.id}" title="Edit / remove friend">⋯</button>
          </div>
        </div>
        ${subsHtml}
      </div>
    `;
  }).join('');
}

/** Every friend has a private dues link; this is the shortcut to send it. */
function linkFor(friend) {
  return `${location.origin}/f/${friend.token}`;
}

function inviteText(friend) {
  return `Hey ${friend.name}! You can check what you owe me any time here: ${linkFor(friend)}`;
}

function renderSubRow(friend, sub) {
  const paid = isPaidThisMonth(sub);
  const overdue = isOverdue(sub);
  const label = subLabel(sub);
  const stampText = paid ? 'Paid' : (overdue ? 'Overdue' : 'Due');
  const stampClass = paid ? 'stamp-paid' : 'stamp-unpaid' + (overdue ? ' stamp-overdue' : '');
  return `
    <div class="sub-row" data-sub="${sub.id}">
      <div class="sub-left">
        <span class="service-chip ${chipClass(sub.service)}">${escapeHtml(label)}</span>
        <div>
          <div class="sub-price mono">${fmtMoney(sub.price)}<span class="per-mo">/mo</span></div>
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

/* ---------------- event delegation on friend list ---------------- */
document.getElementById('friendList').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, friend: friendId, sub: subId } = btn.dataset;

  if (action === 'copy-link') copyLink(friendId);
  if (action === 'add-sub') openAddSubModal(friendId);
  if (action === 'edit-friend') openEditFriendModal(friendId);
  if (action === 'toggle-paid') togglePaid(friendId, subId, btn);
  if (action === 'share-sub') openShareModal(friendId, subId);
  if (action === 'edit-sub') openEditSubModal(friendId, subId);
});

async function copyLink(friendId) {
  const f = findFriend(friendId);
  if (!f) return;
  toast(await copyText(inviteText(f))
    ? `Link for ${f.name} copied — send it to them`
    : linkFor(f));
}

async function togglePaid(friendId, subId, btn) {
  const sub = findSub(friendId, subId);
  if (!sub) return;
  const wasPaid = isPaidThisMonth(sub);
  if (btn) btn.disabled = true;
  try {
    const { friend } = await api(`/api/admin/friends/${friendId}/subscriptions/${subId}/toggle`, { method: 'POST' });
    mergeFriend(friend);
    renderAll();
    toast(wasPaid ? 'Marked unpaid for this month' : 'Marked paid for this month');
  } catch (err) {
    toast(err.message);
    if (btn) btn.disabled = false;
  }
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
  root.innerHTML = `<div class="modal-backdrop" id="modalBackdrop"><div class="modal" role="dialog" aria-modal="true">${html}</div></div>`;
  document.getElementById('modalBackdrop').addEventListener('click', (e) => {
    if (e.target.id === 'modalBackdrop') closeModal();
  });
  const firstInput = root.querySelector('input, button');
  if (firstInput) firstInput.focus();
}
function closeModal() {
  document.getElementById('modalRoot').innerHTML = '';
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/** Shows an error inside the open modal instead of blowing the form away. */
function modalError(msg) {
  const el = document.querySelector('.modal .error-msg');
  if (el) el.textContent = msg;
  else toast(msg);
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
        <label for="newFriendEmail">Email (optional)</label>
        <input type="email" id="newFriendEmail" placeholder="so they can check their own dues">
      </div>
      <div class="field">
        <label for="newFriendNote">Note (optional)</label>
        <input type="text" id="newFriendNote" placeholder="e.g. college roommate">
      </div>
      <div class="error-msg"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="cancelAddFriend">Cancel</button>
        <button type="submit" class="btn btn-primary">Add friend</button>
      </div>
    </form>
  `);
  document.getElementById('cancelAddFriend').addEventListener('click', closeModal);
  document.getElementById('formAddFriend').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('newFriendName').value.trim();
    if (!name) return;
    try {
      const { friend } = await api('/api/admin/friends', {
        method: 'POST',
        body: JSON.stringify({
          name,
          email: document.getElementById('newFriendEmail').value.trim(),
          note: document.getElementById('newFriendNote').value.trim()
        })
      });
      mergeFriend(friend);
      closeModal();
      renderAll();
      toast(`${name} added to the ledger`);
    } catch (err) {
      modalError(err.message);
    }
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
        <label for="editFriendEmail">Email (optional)</label>
        <input type="email" id="editFriendEmail" value="${escapeHtml(f.email || '')}" placeholder="just for your records">
      </div>
      <div class="field">
        <label>Their private dues link</label>
        <div class="link-box mono" id="linkBox">${escapeHtml(linkFor(f))}</div>
        <p class="field-hint">Anyone with this link can see ${escapeHtml(f.name)}'s dues — and nothing else. Send them a new one if it ends up somewhere it shouldn't.</p>
      </div>
      <div class="field">
        <label for="editFriendNote">Note</label>
        <input type="text" id="editFriendNote" value="${escapeHtml(f.note || '')}">
      </div>
      <div class="error-msg"></div>
      <div class="modal-actions">
        <button type="button" class="btn btn-danger" id="deleteFriendBtn">Remove friend</button>
        <button type="submit" class="btn btn-primary">Save</button>
      </div>
    </form>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="copyInviteBtn">Copy link</button>
      <button type="button" class="btn btn-ghost" id="relinkBtn">New link</button>
    </div>
  `);

  document.getElementById('formEditFriend').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const { friend } = await api(`/api/admin/friends/${friendId}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: document.getElementById('editFriendName').value.trim(),
          email: document.getElementById('editFriendEmail').value.trim(),
          note: document.getElementById('editFriendNote').value.trim()
        })
      });
      mergeFriend(friend);
      closeModal();
      renderAll();
      toast('Friend updated');
    } catch (err) {
      modalError(err.message);
    }
  });

  document.getElementById('deleteFriendBtn').addEventListener('click', async () => {
    if (!confirm(`Remove ${f.name} and all their subscriptions? This can't be undone.`)) return;
    try {
      await api(`/api/admin/friends/${friendId}`, { method: 'DELETE' });
      state.friends = state.friends.filter(x => x.id !== friendId);
      closeModal();
      renderAll();
      toast('Friend removed');
    } catch (err) {
      modalError(err.message);
    }
  });

  document.getElementById('copyInviteBtn').addEventListener('click', async () => {
    toast(await copyText(inviteText(f)) ? 'Link copied — send it to them' : linkFor(f));
  });

  document.getElementById('relinkBtn').addEventListener('click', async () => {
    if (!confirm(`Give ${f.name} a brand new link?\n\nTheir current link stops working straight away, so you'll need to send them the new one.`)) return;
    try {
      const { friend } = await api(`/api/admin/friends/${friendId}/relink`, { method: 'POST' });
      mergeFriend(friend);
      document.getElementById('linkBox').textContent = linkFor(friend);
      renderAll();
      toast('New link created — send it to them');
    } catch (err) {
      modalError(err.message);
    }
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
    onSubmit: async (data) => {
      const { friend } = await api(`/api/admin/friends/${friendId}/subscriptions`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      mergeFriend(friend);
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
    onSubmit: async (data) => {
      const { friend } = await api(`/api/admin/friends/${friendId}/subscriptions/${subId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      mergeFriend(friend);
      closeModal();
      renderAll();
      toast('Subscription updated');
    },
    onDelete: async () => {
      if (!confirm('Remove this subscription?')) return;
      await api(`/api/admin/friends/${friendId}/subscriptions/${subId}`, { method: 'DELETE' });
      const friend = findFriend(friendId);
      friend.subscriptions = friend.subscriptions.filter(x => x.id !== subId);
      closeModal();
      renderAll();
      toast('Subscription removed');
    }
  });
}

function renderSubForm({ title, service, customLabel, price, dueDay, showDelete, showHistory, onSubmit, onDelete }) {
  const historyHtml = showHistory ? buildHistoryHtml(showHistory) : '';
  openModal(`
    <h2>${escapeHtml(title)}</h2>
    <form id="formSub">
      <label class="group-label">Service</label>
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
          <input type="number" id="subPrice" step="0.01" min="0" placeholder="0.00" value="${price !== '' && price !== null && price !== undefined ? price : ''}" required>
        </div>
        <div class="field">
          <label for="subDueDay">Due day (1–28)</label>
          <input type="number" id="subDueDay" min="1" max="28" placeholder="e.g. 5" value="${dueDay || ''}">
        </div>
      </div>
      ${historyHtml}
      <div class="error-msg"></div>
      <div class="modal-actions">
        ${showDelete ? '<button type="button" class="btn btn-danger" id="deleteSubBtn">Remove</button>' : '<button type="button" class="btn btn-ghost" id="cancelSubBtn">Cancel</button>'}
        <button type="submit" class="btn btn-primary" id="saveSubBtn">Save</button>
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
  if (deleteBtn) deleteBtn.addEventListener('click', async () => {
    try { await onDelete(); } catch (err) { modalError(err.message); }
  });

  document.getElementById('formSub').addEventListener('submit', async (e) => {
    e.preventDefault();
    const saveBtn = document.getElementById('saveSubBtn');
    const dueRaw = document.getElementById('subDueDay').value;
    saveBtn.disabled = true;
    try {
      await onSubmit({
        service: selectedService,
        customLabel: selectedService === 'Custom' ? document.getElementById('customLabelInput').value.trim() : '',
        price: parseFloat(document.getElementById('subPrice').value) || 0,
        dueDay: dueRaw ? parseInt(dueRaw, 10) : null
      });
    } catch (err) {
      modalError(err.message);
      saveBtn.disabled = false;
    }
  });
}

function buildHistoryHtml(sub) {
  const months = Object.keys(sub.payments || {}).sort().reverse().slice(0, 6);
  if (months.length === 0) return '';
  const rows = months.map(mk => {
    const p = sub.payments[mk];
    return `<div class="hist-row ${p.paid ? 'was-paid' : ''}"><span>${monthLabel(mk)}</span><span>${p.paid ? 'Paid' : 'Unpaid'}</span></div>`;
  }).join('');
  return `<div class="payment-history"><label class="group-label">Recent history</label>${rows}</div>`;
}

/* ---- Share reminder ---- */
function openShareModal(friendId, subId) {
  const f = findFriend(friendId);
  const s = findSub(friendId, subId);
  if (!f || !s) return;
  const label = subLabel(s);
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
        toast("Share isn't supported here — copied instead");
      } catch {
        toast('Copy the text above to share it');
      }
    }
  });
}

/* ---- Backup / restore ---- */
document.getElementById('btnBackup').addEventListener('click', () => {
  openModal(`
    <h2>Backup &amp; restore</h2>
    <p class="modal-note">Your ledger lives on the server. Export a copy to keep off-site, or restore one you saved earlier. A backup contains everyone's private links, so keep the file to yourself.</p>
    <div class="error-msg"></div>
    <div class="modal-actions">
      <button type="button" class="btn btn-ghost" id="exportBtn">Export backup</button>
      <button type="button" class="btn btn-primary" id="importBtn">Import backup</button>
    </div>
    <input type="file" id="importFile" accept="application/json" hidden>
  `);

  document.getElementById('exportBtn').addEventListener('click', async () => {
    try {
      const data = await api('/api/admin/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ledger-backup-${currentMonthKey()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('Backup downloaded');
    } catch (err) {
      modalError(err.message);
    }
  });

  document.getElementById('importBtn').addEventListener('click', () => {
    document.getElementById('importFile').click();
  });

  document.getElementById('importFile').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(reader.result);
        // Accept both the server export ({friends:[...]}) and a bare array
        // from the old localStorage-only version of this app.
        const friends = Array.isArray(parsed) ? parsed : parsed.friends;
        if (!Array.isArray(friends)) throw new Error('That file is not a Ledger backup.');
        if (!confirm('This will replace all current data with the imported backup. Continue?')) return;
        await api('/api/admin/import', { method: 'POST', body: JSON.stringify({ friends }) });
        await enterApp();
        closeModal();
        toast('Backup restored');
      } catch (err) {
        modalError(err.message || 'That file could not be read as a backup.');
      }
    };
    reader.readAsText(file);
  });
});

/* ---------------- boot ---------------- */
(async function boot() {
  try {
    const me = await api('/api/admin/me');
    if (me.loggedIn) await enterApp();
    else showScreen('login');
  } catch {
    showScreen('login');
  }
})();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
