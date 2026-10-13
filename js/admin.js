/* ============================================================
   PIXELTube — admin.js
   Admin panel: reports queue, suspensions, global moderation.
   Only visible to usernames in ADMIN_USERNAMES / ADMIN_UIDS.
   ============================================================ */
import { esc, fmt, timeAgo, avatarHTML, thumbHTML, initial } from './helpers.js';

/* ============================================================
   ADMIN CHECK — mirrors the one in main.js so this module can
   also verify on its own.
   ============================================================ */
const ADMIN_USERNAMES = ['admin14', 'DASHORTSGOD', 'aaraiz.adnan2020'];
const ADMIN_UIDS      = ['dSs1Y55uKrcCeaXYLOqI2yco4HL2'];

export function isAdminUser(user) {
  if (!user) return false;
  return ADMIN_USERNAMES.includes(user.username)
      || ADMIN_UIDS.includes(user.uid);
}

/* ============================================================
   HELPERS
   ============================================================ */
function gatherReports(ctx) {
  const reports = Object.values(ctx.state.reports || {});
  return reports.sort((a, b) => (b.ts || 0) - (a.ts || 0));
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
    if (u && u.mod && u.mod.suspended) {
      out.push({ uid, mod: u.mod });
    }
  }
  return out.sort((a, b) => (b.mod.suspendedAt || 0) - (a.mod.suspendedAt || 0));
}
function channelForUid(ctx, uid) {
  /* users/<uid> where uid is "pl_xxx"; channel id is "pl_xxx" */
  const cid = uid.startsWith('pl_') ? uid : ('pl_' + uid);
  return ctx.state.channels[cid] || null;
}
function reportsForVideo(ctx, vid) {
  return gatherReports(ctx).filter(r => r.videoId === vid);
}

/* ============================================================
   MAIN ENTRY — dispatches by sub-route
     #/admin                → Reports queue (default)
     #/admin/reports        → Reports queue
     #/admin/suspended      → Suspended channels
     #/admin/videos         → Global video list
     #/admin/users          → All users (channels)
   ============================================================ */
export function viewAdmin(ctx, sub) {
  const { PIXLECT, emptyState, isAdmin } = ctx;

  if (!PIXLECT.user) {
    return emptyState('🔒', 'Sign in required',
      'You must be signed in to access the admin panel.', '');
  }
  if (!isAdmin()) {
    return emptyState('🚫', 'Admins only',
      'You don\'t have permission to view this page.',
      `<a class="btn-ghost" href="#/">Go to Feed</a>`);
  }

  switch (sub) {
    case 'suspended': return viewAdminSuspended(ctx);
    case 'videos':    return viewAdminVideos(ctx);
    case 'users':     return viewAdminUsers(ctx);
    default:          return viewAdminReports(ctx);
  }
}

/* ============================================================
   ADMIN SHELL — sidebar + content area
   ============================================================ */
function adminWrap(ctx, active, contentHTML) {
  const { state } = ctx;
  const pending = pendingReports(ctx).length;
  const suspended = suspendedUsers(ctx).length;

  const nav = [
    { id: 'reports',   label: 'Reports',   href: '#/admin',           count: pending },
    { id: 'suspended', label: 'Suspended', href: '#/admin/suspended', count: suspended },
    { id: 'videos',    label: 'All videos',href: '#/admin/videos' },
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

/* ============================================================
   REPORTS QUEUE
   ============================================================ */
function viewAdminReports(ctx) {
  const pending = pendingReports(ctx);
  const resolved = resolvedReports(ctx);

  const pendingRows = pending.length ? pending.map(r => adminReportRow(ctx, r)).join('')
    : `<div class="admin-empty">No pending reports. 🎉</div>`;

  const resolvedRows = resolved.length ? resolved.map(r => `
    <div class="admin-row admin-row-dim">
      <div class="admin-info">
        <div class="admin-title">
          ${r.videoId ? `Video ${esc(r.videoId)}` : '(removed)'}
        </div>
        <div class="admin-meta">
          ${esc(r.category)} · resolved ${esc(timeAgo(r.resolvedAt))}
          by <b>${esc(r.resolvedBy || 'admin')}</b> · action: <b>${esc(r.action || 'resolved')}</b>
        </div>
      </div>
    </div>
  `).join('') : `<div class="admin-empty">No resolved reports yet.</div>`;

  const content = `
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
  `;

  return adminWrap(ctx, 'reports', content);
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

/* ============================================================
   SUSPENDED CHANNELS
   ============================================================ */
function viewAdminSuspended(ctx) {
  const list = suspendedUsers(ctx);

  const rows = list.length ? list.map(({ uid, mod }) => {
    const ch = channelForUid(ctx, uid);
    return `
      <div class="admin-row">
        <div class="admin-info">
          <div class="admin-title">
            ${ch ? esc(ch.name) : '(channel deleted)'}
          </div>
          <div class="admin-meta">
            <b>${esc(mod.reason || 'Suspended')}</b>
          </div>
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

  const content = `
    <div class="admin-head">
      <h1>Suspended channels</h1>
      <p>${list.length} channel${list.length === 1 ? '' : 's'} currently suspended</p>
    </div>
    <section class="admin-section">${rows}</section>
  `;

  return adminWrap(ctx, 'suspended', content);
}

/* ============================================================
   ALL VIDEOS
   ============================================================ */
function viewAdminVideos(ctx) {
  const all = ctx.videosSorted();
  const rows = all.length ? all.map(v => {
    const c = ctx.chanOf(v.id);
    const isFlagged = v.moderation && v.moderation.flagged;
    return `
      <div class="admin-row">
        <div class="admin-thumb">${thumbHTML(v)}</div>
        <div class="admin-info">
          <div class="admin-title">${esc(v.title)}</div>
          <div class="admin-meta">
            <b>${esc(c.name)}</b> · ${v.kind === 'mini' ? 'Mini' : 'Long'}
            · ${esc(timeAgo(v.createdAt))}
            ${isFlagged ? ' · <span style="color:var(--warn)">flagged by moderation</span>' : ''}
          </div>
          <div class="admin-meta">
            ${fmt(v.views)} views · ${fmt(v.likes)} likes · ${fmt(v.dislikes)} dislikes
          </div>
        </div>
        <div class="admin-actions">
          <a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank">View</a>
          <button class="btn-secondary" data-action="admin-delete-standalone" data-vid="${esc(v.id)}" type="button" style="color:var(--accent)">Delete</button>
        </div>
      </div>`;
  }).join('') : `<div class="admin-empty">No videos on the platform yet.</div>`;

  const content = `
    <div class="admin-head">
      <h1>All videos</h1>
      <p>${all.length} video${all.length === 1 ? '' : 's'} across every channel</p>
    </div>
    <section class="admin-section">${rows}</section>
  `;

  return adminWrap(ctx, 'videos', content);
}

/* ============================================================
   ALL CHANNELS
   ============================================================ */
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
          <div class="admin-title">${esc(c.name)} ${suspended ? '<span style="color:var(--warn);font-size:11px;font-weight:800;letter-spacing:.4px">SUSPENDED</span>' : ''}</div>
          <div class="admin-meta">
            ${esc(c.handle || '')} · ${fmt(ctx.subsOf(c.id))} subscribers
            · ${videoCount} video${videoCount === 1 ? '' : 's'}
          </div>
          <div class="admin-meta">
            Owner UID: <code style="font-size:11px">${esc(c.ownerUid || 'unknown')}</code>
          </div>
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

  const content = `
    <div class="admin-head">
      <h1>All channels</h1>
      <p>${channels.length} channel${channels.length === 1 ? '' : 's'}</p>
    </div>
    <section class="admin-section">${rows}</section>
  `;

  return adminWrap(ctx, 'users', content);
}