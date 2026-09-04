/* =========================================================
   The dues page a friend reaches through their private link.
   The token sits in the URL (/f/<token>); there is nothing to
   sign in to, and nobody's data but their own is ever sent here.
   ========================================================= */

function showScreen(which) {
  for (const [id, name] of [['screenLoading', 'loading'], ['screenError', 'error'], ['screenDues', 'dues']]) {
    document.getElementById(id).classList.toggle('hidden', which !== name);
  }
}

function tokenFromUrl() {
  const m = location.pathname.match(/^\/f\/([a-f0-9]+)\/?$/);
  return m ? m[1] : null;
}

function fail(message) {
  if (message) document.getElementById('errorText').textContent = message;
  showScreen('error');
}

async function loadDues() {
  const token = tokenFromUrl();
  if (!token) return fail('This link is incomplete. Ask for a fresh one.');

  let friend;
  try {
    const res = await fetch(`/api/portal/dues/${token}`, { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return fail(data.error);
    friend = data.friend;
  } catch {
    return fail('Could not reach the ledger. Check your connection and try again.');
  }

  const mk = currentMonthKey();
  document.getElementById('duesName').textContent = friend.name;
  document.getElementById('duesMonth').textContent = monthLabel(mk);
  document.title = `${friend.name} — The Ledger`;

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

  document.getElementById('duesList').innerHTML = subs.length
    ? `<div class="friend-card">${subs.map(renderDueRow).join('')}</div>`
    : `<div class="empty-state">
         <h3>Nothing tracked yet</h3>
         <p>No subscriptions have been added to your name.</p>
       </div>`;

  showScreen('dues');
}

function renderDueRow(sub) {
  const paid = isPaidThisMonth(sub);
  const overdue = isOverdue(sub);
  const stampText = paid ? 'Paid' : (overdue ? 'Overdue' : 'Due');
  const stampClass = paid ? 'stamp-paid' : 'stamp-unpaid' + (overdue ? ' stamp-overdue' : '');
  return `
    <div class="sub-row">
      <div class="sub-left">
        <span class="service-chip ${chipClass(sub.service)}">${escapeHtml(subLabel(sub))}</span>
        <div>
          <div class="sub-price mono">${fmtMoney(sub.price)}<span class="per-mo">/mo</span></div>
          ${sub.dueDay ? `<div class="sub-due">Due the ${sub.dueDay}${ordinalSuffix(sub.dueDay)}</div>` : ''}
        </div>
      </div>
      <div class="sub-actions">
        <span class="stamp ${stampClass}">${stampText}</span>
      </div>
    </div>
  `;
}

loadDues();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
