/* ============================================================
   PIXELTube — sec.js
   Merged security + admin module.
     - Suspension state read/write
     - Report submission + report modal
     - Community Guidelines acceptance gate
     - Admin panel: reports, suspended channels, videos, users
   ============================================================ */
import { esc, fmt, timeAgo, avatarHTML, thumbHTML, initial } from './helpers.js';

/* ============================================================
   ADMINS
   ============================================================ */
const ADMIN_USERNAMES = ['admin14', 'DASHORTSGOD', 'aaraiz.adnan2020'];
const ADMIN_UIDS      = ['dSs1Y55uKrcCeaXYLOqI2yco4HL2'];

export function isAdminUser(user) {
  if (!user) return false;
  return ADMIN_USERNAMES.includes(user.username)
      || ADMIN_UIDS.includes(user.uid);
}

/* ============================================================
   SUSPENSION
   ============================================================ */

export function isUserSuspended(ctx, uid) {
  const u = ctx.state.users?.[uid];
  return !!(u && u.mod && u.mod.suspended);
}

export function getSuspensionInfo(ctx, uid) {
  const u = ctx.state.users?.[uid];
  return (u && u.mod) || null;
}

export function canCurrentUserUpload(ctx) {
  const { PIXLECT, state, isAdmin } = ctx;
  if (!PIXLECT.user) return { reason: 'not-signed-in' };
  if (isAdmin()) return null;

  const key = 'pl_' + PIXLECT.user.uid;
  const u = state.users[key] || state.users[PIXLECT.user.uid];
  if (u && u.mod && u.mod.suspended) {
    return { reason: 'suspended', info: u.mod };
  }
  return null;
}

export async function suspendChannel(ctx, cid, reason) {
  const { db, ref, set, PIXLECT, toast, isAdmin } = ctx;
  if (!isAdmin()) { toast('Admin only'); return false; }
  const ch = ctx.state.channels[cid];
  if (!ch) { toast('Channel not found'); return false; }
  if (!ch.ownerUid) { toast('Channel has no owner'); return false; }

  try {
    await set(ref(db, `pixeltube/users/pl_${ch.ownerUid}/mod`), {
      suspended: true,
      reason: reason || 'Violation of community guidelines',
      suspendedAt: Date.now(),
      suspendedBy: PIXLECT.user.username,
      strikes: 1
    });
    toast('Channel suspended');
    return true;
  } catch (e) {
    console.error('[sec] suspend failed', e);
    toast('Could not suspend channel');
    return false;
  }
}

export async function unsuspendChannel(ctx, cid) {
  const { db, ref, remove, toast, isAdmin } = ctx;
  if (!isAdmin()) { toast('Admin only'); return false; }
  const ch = ctx.state.channels[cid];
  if (!ch || !ch.ownerUid) { toast('Channel not found'); return false; }
  try {
    await remove(ref(db, `pixeltube/users/pl_${ch.ownerUid}/mod`));
    toast('Channel reinstated');
    return true;
  } catch (e) {
    console.error('[sec] unsuspend failed', e);
    toast('Could not reinstate channel');
    return false;
  }
}

/* ============================================================
   REPORT SUBMISSION
   ============================================================ */
export async function reportVideo(ctx, vid, category, note) {
  const { db, ref, set, PIXLECT, toast } = ctx;
  if (!PIXLECT.user) { toast('Sign in to report'); return false; }

  const v = ctx.state.videos[vid];
  if (v && v.createdBy === PIXLECT.user.uid) {
    toast('You can\'t report your own video');
    return false;
  }

  const reportId = 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const report = {
    id: reportId,
    videoId: vid,
    reporterUid: PIXLECT.user.uid,
    reporterUsername: PIXLECT.user.username,
    category: category || 'other',
    note: (note || '').slice(0, 500),
    ts: Date.now(),
    status: 'pending'
  };

  try {
    await set(ref(db, `pixeltube/reports/${reportId}`), report);
    toast('Report submitted. Thanks for helping keep PIXELTube safe.');
    return true;
  } catch (e) {
    console.error('[sec] report failed', e);
    toast('Could not submit report');
    return false;
  }
}

/* ============================================================
   REPORT MODAL
   ============================================================ */
export function promptReportVideo(ctx, vid) {
  const { openModal, closeModal, PIXLECT, pixlectSignIn, reportVideo, toast } = ctx;

  if (!PIXLECT.user) { pixlectSignIn(); return; }

  const v = ctx.state.videos[vid];
  if (v && v.createdBy === PIXLECT.user.uid) {
    toast('You can\'t report your own video');
    return;
  }

  openModal(`
    <button class="close" type="button" onclick="document.getElementById('modalRoot').innerHTML=''">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </button>
    <h2>Report this video</h2>
    <p class="lede">Let us know what's wrong. Reports are reviewed by our moderators.</p>

    <div class="field">
      <label for="repCat">What's wrong?</label>
      <select id="repCat">
        <option value="violence">Violence or threats</option>
        <option value="hate">Hate speech or harassment</option>
        <option value="sexual">Sexual or adult content</option>
        <option value="child">Content involving minors</option>
        <option value="spam">Spam or scam</option>
        <option value="copyright">Copyright violation</option>
        <option value="other">Something else</option>
      </select>
    </div>

    <div class="field">
      <label for="repNote">Anything else? (optional)</label>
      <textarea id="repNote" maxlength="500" placeholder="Add details if you want…" style="min-height:80px"></textarea>
    </div>

    <div class="form-actions">
      <button type="button" class="btn-secondary" onclick="document.getElementById('modalRoot').innerHTML=''">Cancel</button>
      <button type="button" class="btn-primary" id="repSubmit">Submit report</button>
    </div>
  `);

  document.getElementById('repSubmit').onclick = async () => {
    const cat = document.getElementById('repCat').value;
    const note = document.getElementById('repNote').value.trim();
    const ok = await reportVideo(ctx, vid, cat, note);
    if (ok) closeModal();
  };
}

/* ============================================================
   GUIDELINES GATE
   ============================================================ */
const GUIDELINES_KEY = 'pixeltube_guidelines_accepted_v1';

export function hasAcceptedGuidelines() {
  try { return localStorage.getItem(GUIDELINES_KEY) === '1'; } catch (_) { return false; }
}

function acceptGuidelines() {
  try { localStorage.setItem(GUIDELINES_KEY, '1'); } catch (_) {}
}

export function promptGuidelines(onAccept) {
  const root = document.getElementById('modalRoot');
  if (!root) return;

  root.innerHTML = `
    <div class="modal-backdrop" data-modal-backdrop>
      <div class="modal-wrap"><div class="modal" style="max-width:520px">
        <h2>Community Guidelines</h2>
        <p class="lede">Before you upload to PIXELTube, please read and agree to these rules.</p>

        <div style="font-size:13.5px;line-height:1.65;color:var(--muted);max-height:340px;overflow-y:auto;padding-right:8px">
          <p style="margin-bottom:12px"><b style="color:var(--text)">Do not upload:</b></p>
          <ul style="margin:0 0 14px 20px">
            <li>Sexual or nude content of any kind</li>
            <li>Content that sexualises or endangers minors</li>
            <li>Graphic violence, gore, or cruelty to animals or people</li>
            <li>Hate speech, slurs, or content that attacks a person or group</li>
            <li>Harassment, threats, or targeted bullying</li>
            <li>Content promoting self-harm or eating disorders</li>
            <li>Content you don't own or have permission to share</li>
            <li>Spam, scams, malware, or misleading links</li>
          </ul>
          <p style="margin-bottom:12px"><b style="color:var(--text)">Consequences:</b></p>
          <ul style="margin:0 0 14px 20px">
            <li>Videos that break these rules will be removed</li>
            <li>Repeat violations may result in your channel being suspended</li>
            <li>Serious violations may be reported to authorities</li>
          </ul>
          <p>By clicking <b>I agree</b>, you confirm that everything you upload complies with these rules and with our <a href="#/terms" style="color:var(--accent)">Terms &amp; Conditions</a>.</p>
        </div>

        <div class="form-actions">
          <button type="button" class="btn-secondary" id="guideCancel">Cancel</button>
          <button type="button" class="btn-primary" id="guideAgree">I agree</button>
        </div>
      </div></div>
    </div>
  `;

  document.getElementById('guideCancel').onclick = () => { root.innerHTML = ''; };
  document.getElementById('guideAgree').onclick = () => {
    acceptGuidelines();
    root.innerHTML = '';
    if (typeof onAccept === 'function') onAccept();
  };
}

export function requireGuidelines(fn) {
  return function (...args) {
    if (hasAcceptedGuidelines()) return fn(...args);
    promptGuidelines(() => fn(...args));
  };
}

/* ============================================================
   ADMIN PANEL
   ============================================================ */
function gatherReports(ctx) {
  return Object.values(ctx.state.reports || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
function pendingReports(ctx) {
  return gatherReports(ctx).filter(r => r.status !== 'resolved');
}
function resolvedReports(ctx) {
  return gatherReports(ctx).filter(r => r.status === 'resolved').slice(0, 30);
}
function suspendedUsers(ctx) {
  const out = [];
  for (const [uid, u] of Object.entries(ctx.state.users || {})) {
    if (u && u.mod && u.mod.suspended) out.push({ uid, mod: u.mod });
  }
  return out.sort((a, b) => (b.mod.suspendedAt || 0) - (a.mod.suspendedAt || 0));
}
function channelForUid(ctx, uid) {
  const cid = uid.startsWith('pl_') ? uid : ('pl_' + uid);
  return ctx.state.channels[cid] || null;
}
function reportsForVideo(ctx, vid) {
  return gatherReports(ctx).filter(r => r.videoId === vid);
}

export function viewAdmin(ctx, sub) {
  const { PIXLECT, emptyState, isAdmin } = ctx;

  if (!PIXLECT.user) {
    return emptyState('🔒', 'Sign in required', 'You must be signed in to access the admin panel.', '');
  }
  if (!isAdmin()) {
    return emptyState('🚫', 'Admins only', 'You don\'t have permission to view this page.',
      `<a class="btn-ghost" href="#/">Go to Feed</a>`);
  }

  switch (sub) {
    case 'suspended': return viewAdminSuspended(ctx);
    case 'videos':    return viewAdminVideos(ctx);
    case 'users':     return viewAdminUsers(ctx);
    default:          return viewAdminReports(ctx);
  }
}

function adminWrap(ctx, active, contentHTML) {
  const pending = pendingReports(ctx).length;
  const suspended = suspendedUsers(ctx).length;

  const nav = [
    { id: 'reports',   label: 'Reports',      href: '#/admin',           count: pending },
    { id: 'suspended', label: 'Suspended',    href: '#/admin/suspended', count: suspended },
    { id: 'videos',    label: 'All videos',   href: '#/admin/videos' },
    { id: 'users',     label: 'All channels', href: '#/admin/users' }
  ];

  return `
    <div class="admin-shell">
      <aside class="admin-sidebar">
        <div class="admin-badge">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M12 1l3 6 6 1-4.5 4.5L18 19l-6-3-6 3 1.5-6.5L3 8l6-1z"/>
          </svg>
          ADMIN PANEL
        </div>

        <nav class="admin-nav">
          ${nav.map(it => `
            <a class="admin-nav-item ${active === it.id ? 'active' : ''}" href="${it.href}">
              <span>${it.label}</span>
              ${it.count ? `<span class="admin-nav-count">${it.count}</span>` : ''}
            </a>
          `).join('')}
        </nav>

        <a class="admin-back" href="#/">← Back to PIXELTube</a>
      </aside>

      <main class="admin-main">
        ${contentHTML}
      </main>
    </div>
  `;
}

function viewAdminReports(ctx) {
  const pending = pendingReports(ctx);
  const resolved = resolvedReports(ctx);

  const pendingRows = pending.length
    ? pending.map(r => adminReportRow(ctx, r)).join('')
    : `<div class="admin-empty">No pending reports. 🎉</div>`;

  const resolvedRows = resolved.length
    ? resolved.map(r => `
        <div class="admin-row admin-row-dim">
          <div class="admin-info">
            <div class="admin-title">${r.videoId ? `Video ${esc(r.videoId)}` : '(removed)'}</div>
            <div class="admin-meta">
              ${esc(r.category)} · resolved ${esc(timeAgo(r.resolvedAt))}
              by <b>${esc(r.resolvedBy || 'admin')}</b> · action: <b>${esc(r.action || 'resolved')}</b>
            </div>
          </div>
        </div>
      `).join('')
    : `<div class="admin-empty">No resolved reports yet.</div>`;

  return adminWrap(ctx, 'reports', `
    <div class="admin-head">
      <h1>Reports</h1>
      <p>${pending.length} pending · ${resolved.length} recent resolved</p>
    </div>
    <section class="admin-section">
      <h2>Pending <span class="admin-count">${pending.length}</span></h2>
      ${pendingRows}
    </section>
    <section class="admin-section">
      <h2>Recently resolved</h2>
      ${resolvedRows}
    </section>
  `);
}

function adminReportRow(ctx, r) {
  const v = ctx.state.videos[r.videoId];
  const c = v ? ctx.chanOf(v.id) : null;
  const reportsOnVideo = v ? reportsForVideo(ctx, v.id).length : 0;
  const isRepeat = reportsOnVideo > 1;

  return `
    <div class="admin-row" data-report-id="${esc(r.id)}">
      <div class="admin-thumb">
        ${v ? thumbHTML(v) : '<div class="placeholder">🚫</div>'}
      </div>
      <div class="admin-info">
        <div class="admin-title">${v ? esc(v.title) : '(video deleted)'}</div>
        <div class="admin-meta">
          Reported by <b>${esc(r.reporterUsername || 'user')}</b>
          · ${esc(timeAgo(r.ts))}
          · Reason: <b>${esc(r.category)}</b>
          ${isRepeat ? ` · <span style="color:var(--warn)">${reportsOnVideo} reports on this video</span>` : ''}
        </div>
        ${r.note ? `<div class="admin-note">"${esc(r.note)}"</div>` : ''}
        ${c ? `<div class="admin-meta">Channel: <b>${esc(c.name)}</b> (${esc(c.handle || '')})</div>` : ''}
        ${v ? `<div class="admin-meta">${fmt(v.views)} views · ${fmt(v.likes)} likes · ${fmt(v.dislikes)} dislikes</div>` : ''}
      </div>
      <div class="admin-actions">
        ${v ? `<a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank">View</a>` : ''}
        ${v ? `<button class="btn-secondary" data-action="admin-dismiss" data-rid="${esc(r.id)}" type="button">Dismiss</button>` : ''}
        ${v ? `<button class="btn-secondary" data-action="admin-delete" data-rid="${esc(r.id)}" data-vid="${esc(v.id)}" type="button" style="color:var(--accent)">Delete video</button>` : ''}
        ${c ? `<button class="btn-secondary" data-action="admin-suspend" data-cid="${esc(c.id)}" data-rid="${esc(r.id)}" type="button" style="color:var(--warn)">Suspend channel</button>` : ''}
      </div>
    </div>
  `;
}

function viewAdminSuspended(ctx) {
  const list = suspendedUsers(ctx);

  const rows = list.length ? list.map(({ uid, mod }) => {
    const ch = channelForUid(ctx, uid);
    return `
      <div class="admin-row">
        <div class="admin-info">
          <div class="admin-title">${ch ? esc(ch.name) : '(channel deleted)'}</div>
          <div class="admin-meta"><b>${esc(mod.reason || 'Suspended')}</b></div>
          <div class="admin-meta">
            Suspended ${esc(timeAgo(mod.suspendedAt))}
            by <b>${esc(mod.suspendedBy || 'admin')}</b>
          </div>
        </div>
        <div class="admin-actions">
          ${ch ? `<a class="btn-secondary" href="#/channel/${esc(ch.id)}" target="_blank">View channel</a>` : ''}
          ${ch ? `<button class="btn-secondary" data-action="admin-unsuspend" data-cid="${esc(ch.id)}" type="button">Reinstate</button>` : ''}
        </div>
      </div>`;
  }).join('') : `<div class="admin-empty">No suspended channels.</div>`;

  return adminWrap(ctx, 'suspended', `
    <div class="admin-head">
      <h1>Suspended channels</h1>
      <p>${list.length} channel${list.length === 1 ? '' : 's'} currently suspended</p>
    </div>
    <section class="admin-section">${rows}</section>
  `);
}

function viewAdminVideos(ctx) {
  const all = ctx.videosSorted();
  const rows = all.length ? all.map(v => {
    const c = ctx.chanOf(v.id);
    return `
      <div class="admin-row">
        <div class="admin-thumb">${thumbHTML(v)}</div>
        <div class="admin-info">
          <div class="admin-title">${esc(v.title)}</div>
          <div class="admin-meta">
            <b>${esc(c.name)}</b> · ${v.kind === 'mini' ? 'Mini' : 'Long'}
            · ${esc(timeAgo(v.createdAt))}
          </div>
          <div class="admin-meta">${fmt(v.views)} views · ${fmt(v.likes)} likes · ${fmt(v.dislikes)} dislikes</div>
        </div>
        <div class="admin-actions">
          <a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank">View</a>
          <button class="btn-secondary" data-action="admin-delete-standalone" data-vid="${esc(v.id)}" type="button" style="color:var(--accent)">Delete</button>
        </div>
      </div>`;
  }).join('') : `<div class="admin-empty">No videos on the platform yet.</div>`;

  return adminWrap(ctx, 'videos', `
    <div class="admin-head">
      <h1>All videos</h1>
      <p>${all.length} video${all.length === 1 ? '' : 's'} across every channel</p>
    </div>
    <section class="admin-section">${rows}</section>
  `);
}

function viewAdminUsers(ctx) {
  const channels = Object.values(ctx.state.channels || {})
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const rows = channels.length ? channels.map(c => {
    const suspended = suspendedUsers(ctx).some(s => channelForUid(ctx, s.uid)?.id === c.id);
    const videoCount = Object.values(ctx.state.videos || {}).filter(v => v.channelId === c.id).length;
    return `
      <div class="admin-row">
        ${avatarHTML(c, 'lg')}
        <div class="admin-info">
          <div class="admin-title">
            ${esc(c.name)}
            ${suspended ? '<span style="color:var(--warn);font-size:11px;font-weight:800;letter-spacing:.4px">SUSPENDED</span>' : ''}
          </div>
          <div class="admin-meta">
            ${esc(c.handle || '')} · ${fmt(ctx.subsOf(c.id))} subscribers
            · ${videoCount} video${videoCount === 1 ? '' : 's'}
          </div>
          <div class="admin-meta">Owner UID: <code style="font-size:11px">${esc(c.ownerUid || 'unknown')}</code></div>
        </div>
        <div class="admin-actions">
          <a class="btn-secondary" href="#/channel/${esc(c.id)}" target="_blank">View</a>
          ${!suspended && c.ownerUid
            ? `<button class="btn-secondary" data-action="admin-suspend" data-cid="${esc(c.id)}" type="button" style="color:var(--warn)">Suspend</button>`
            : suspended
              ? `<button class="btn-secondary" data-action="admin-unsuspend" data-cid="${esc(c.id)}" type="button">Reinstate</button>`
              : ''}
        </div>
      </div>`;
  }).join('') : `<div class="admin-empty">No channels on the platform yet.</div>`;

  return adminWrap(ctx, 'users', `
    <div class="admin-head">
      <h1>All channels</h1>
      <p>${channels.length} channel${channels.length === 1 ? '' : 's'}</p>
    </div>
    <section class="admin-section">${rows}</section>
  `);
}
