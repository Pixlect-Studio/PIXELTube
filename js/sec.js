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
   CHANNEL-ONLY SUSPENSION
   A channel suspension must never write to the owner's account record.
   Expiry is checked at read/action time so it stops applying automatically.
   ============================================================ */
export function isChannelSuspended(ctx, cid, now = Date.now()) {
  const mod = ctx.state.channels?.[cid]?.moderation;
  if (!mod?.suspended) return false;
  return !Number.isFinite(Number(mod.expiresAt)) || Number(mod.expiresAt) > now;
}

export function getChannelSuspensionInfo(ctx, cid) {
  const mod = ctx.state.channels?.[cid]?.moderation;
  if (!mod?.suspended) return null;
  if (Number.isFinite(Number(mod.expiresAt)) && Number(mod.expiresAt) <= Date.now()) return null;
  return mod;
}

// Kept for older callers, but intentionally never treats a user account as suspended.
export function isUserSuspended(_ctx, _uid) {
  return false;
}

export function getSuspensionInfo(ctx, uid) {
  const cid = String(uid || '').startsWith('pl_') ? uid : ('pl_' + uid);
  return getChannelSuspensionInfo(ctx, cid);
}

export function canCurrentUserUpload(ctx) {
  const { PIXLECT, state, isAdmin } = ctx;
  if (!PIXLECT.user) return { reason: 'not-signed-in' };
  if (isAdmin()) return null;
  const cid = state.activeChannelId || ('pl_' + PIXLECT.user.uid);
  const info = getChannelSuspensionInfo(ctx, cid);
  if (info && ctx.state.channels?.[cid]?.ownerUid === PIXLECT.user.uid) {
    return { reason: 'suspended', info, channelId: cid };
  }
  return null;
}

export async function suspendChannel(ctx, cid, reason, durationDays = 7) {
  const { db, ref, set, PIXLECT, toast, isAdmin } = ctx;
  if (!isAdmin()) { toast('Admin only'); return false; }
  const ch = ctx.state.channels[cid];
  if (!ch) { toast('Channel not found'); return false; }
  if (!ch.ownerUid) { toast('Channel has no owner'); return false; }

  const days = Number(durationDays);
  if (!Number.isFinite(days) || days < 1 || days > 3650) {
    toast('Duration must be between 1 and 3650 days'); return false;
  }
  const now = Date.now();
  const moderation = {
    suspended: true,
    reason: String(reason || 'Violation of community guidelines').trim().slice(0, 500),
    suspendedAt: now,
    expiresAt: now + days * 24 * 60 * 60 * 1000,
    durationDays: days,
    suspendedBy: PIXLECT.user.username,
    strikes: Number(ch.moderation?.strikes || 0) + 1
  };
  if (!moderation.reason) { toast('A suspension reason is required'); return false; }

  try {
    if (ctx.state.mode === 'local' && ctx.localDB) {
      ctx.localDB.channels[cid] = { ...(ctx.localDB.channels[cid] || ch), moderation };
      ctx.persistLocal();
      ctx.applyData(ctx.localDB);
    } else {
      if (!db) throw new Error('Firebase is not connected');
      await set(ref(db, `pixeltube/channels/${cid}/moderation`), moderation);
    }
    // Keep the in-memory copy consistent even before the realtime listener responds.
    ctx.state.channels[cid] = { ...ch, moderation };
    try { await writeModerationAudit(ctx, 'channel-suspended', 'channel', cid, moderation.reason, `Expires: ${new Date(moderation.expiresAt).toISOString()}`); } catch (auditError) { console.error('[sec] suspension audit failed', auditError); }
    toast(`Channel suspended for ${days} day${days === 1 ? '' : 's'}`);
    return true;
  } catch (e) {
    console.error('[sec] channel suspension failed', e);
    toast('Could not suspend channel: ' + (e?.message || 'database error'));
    return false;
  }
}

export async function unsuspendChannel(ctx, cid) {
  const { db, ref, remove, toast, isAdmin } = ctx;
  if (!isAdmin()) { toast('Admin only'); return false; }
  const ch = ctx.state.channels[cid];
  if (!ch) { toast('Channel not found'); return false; }
  try {
    if (ctx.state.mode === 'local' && ctx.localDB) {
      const localChannel = ctx.localDB.channels[cid] || ch;
      delete localChannel.moderation;
      ctx.localDB.channels[cid] = localChannel;
      ctx.persistLocal();
      ctx.applyData(ctx.localDB);
    } else {
      if (!db) throw new Error('Firebase is not connected');
      await remove(ref(db, `pixeltube/channels/${cid}/moderation`));
    }
    const updated = { ...(ctx.state.channels[cid] || ch) };
    delete updated.moderation;
    ctx.state.channels[cid] = updated;
    try { await writeModerationAudit(ctx, 'channel-reinstated', 'channel', cid); } catch (auditError) { console.error('[sec] reinstatement audit failed', auditError); }
    toast('Channel reinstated');
    return true;
  } catch (e) {
    console.error('[sec] channel reinstatement failed', e);
    toast('Could not reinstate channel: ' + (e?.message || 'database error'));
    return false;
  }
}

/* ============================================================
   V2.1 MODERATION HELPERS
   Client-side audit is useful for accountability, but is not tamper-proof.
   ============================================================ */
export async function writeModerationAudit(ctx, action, targetType, targetId, reason = '', details = '') {
  if (!ctx.isAdmin()) throw new Error('Admin only');
  const entry = {
    action: String(action).slice(0, 80), targetType: String(targetType).slice(0, 40),
    targetId: String(targetId).slice(0, 180), reason: String(reason || '').slice(0, 500),
    details: String(details || '').slice(0, 500), admin: ctx.PIXLECT.user?.username || 'admin', ts: Date.now()
  };
  if (ctx.state.mode === 'local' && ctx.localDB) {
    ctx.localDB.audit = ctx.localDB.audit || {};
    const id = 'a_' + entry.ts.toString(36) + Math.random().toString(36).slice(2, 7);
    ctx.localDB.audit[id] = entry; ctx.persistLocal(); ctx.applyData(ctx.localDB);
    return true;
  }
  if (!ctx.db) throw new Error('Firebase is not connected');
  const auditRef = ctx.push(ctx.ref(ctx.db, 'pixeltube/moderationAudit'));
  await ctx.set(auditRef, entry);
  return true;
}

export async function setPublishingMode(ctx, cid, mode, reason = '') {
  if (!ctx.isAdmin()) { ctx.toast('Admin only'); return false; }
  const ch = ctx.state.channels?.[cid];
  if (!ch) { ctx.toast('Channel not found'); return false; }
  const next = String(mode).toUpperCase() === 'REVIEW' ? 'REVIEW' : 'FREE';
  const updated = { ...ch, publishingMode: next, publishingModeUpdatedAt: Date.now(), publishingModeUpdatedBy: ctx.PIXLECT.user?.username || 'admin', publishingModeReason: String(reason || '').slice(0, 500) };
  try {
    if (ctx.state.mode === 'local' && ctx.localDB) { ctx.localDB.channels[cid] = updated; ctx.persistLocal(); ctx.applyData(ctx.localDB); }
    else { if (!ctx.db) throw new Error('Firebase is not connected'); await ctx.update(ctx.ref(ctx.db, `pixeltube/channels/${cid}`), { publishingMode: next, publishingModeUpdatedAt: updated.publishingModeUpdatedAt, publishingModeUpdatedBy: updated.publishingModeUpdatedBy, publishingModeReason: updated.publishingModeReason }); }
    ctx.state.channels[cid] = updated;
    try { await writeModerationAudit(ctx, 'publishing-mode-changed', 'channel', cid, reason, `Mode: ${next}`); }
    catch (auditError) { console.error('[sec] audit write failed after mode change', auditError); ctx.toast(`Mode changed to ${next}, but the audit entry could not be saved`); return true; }
    ctx.toast(`Publishing mode set to ${next}`); return true;
  } catch (e) { console.error('[sec] publishing mode failed', e); ctx.toast('Could not change publishing mode: ' + (e?.message || 'database error')); return false; }
}

export async function reviewVideo(ctx, vid, decision, reason = '') {
  if (!ctx.isAdmin()) { ctx.toast('Admin only'); return false; }
  const video = ctx.state.videos?.[vid];
  if (!video) { ctx.toast('Video not found'); return false; }
  const d = String(decision).toLowerCase();
  if (!['approve', 'ignore', 'disapprove'].includes(d)) { ctx.toast('Invalid review decision'); return false; }
  if (d === 'disapprove' && !String(reason).trim()) { ctx.toast('A reason is required to disapprove'); return false; }
  const status = d === 'approve' ? 'approved' : d === 'ignore' ? 'ignored' : 'disapproved';
  const patch = { reviewStatus: status, reviewDecision: d, reviewReason: String(reason || '').trim().slice(0, 500), reviewAt: Date.now(), reviewBy: ctx.PIXLECT.user?.username || 'admin' };
  try {
    if (ctx.state.mode === 'local' && ctx.localDB) { ctx.localDB.videos[vid] = { ...video, ...patch }; ctx.persistLocal(); ctx.applyData(ctx.localDB); }
    else { if (!ctx.db) throw new Error('Firebase is not connected'); await ctx.update(ctx.ref(ctx.db, `pixeltube/videos/${vid}`), patch); }
    ctx.state.videos[vid] = { ...video, ...patch };
    // Send the channel owner an in-app moderation inbox update for every review decision.
    let creatorNotified = true;
    try {
      const channel = ctx.state.channels?.[video.channelId];
      if (channel) {
        const now = Date.now();
        const tid = 'review_' + now.toString(36) + Math.random().toString(36).slice(2, 6);
        const messageText = d === 'approve'
          ? `Your video “${String(video.title || vid).slice(0, 120)}” was approved and is eligible to appear publicly.`
          : d === 'ignore'
            ? `Your video “${String(video.title || vid).slice(0, 120)}” remains private while its review is paused.`
            : `Your video “${String(video.title || vid).slice(0, 120)}” was declined. Reason: ${String(reason).trim().slice(0, 500)}`;
        const thread = { id: tid, type: 'video-review', subject: `Video review: ${status}`, reason: messageText, videoId: vid, closed: false, createdAt: now, updatedAt: now, createdBy: ctx.PIXLECT.user?.username || 'admin', messages: { ['m_' + now.toString(36)]: { senderUid: ctx.PIXLECT.user?.uid || '', senderName: ctx.PIXLECT.user?.username || 'PIXELTube Admin', senderRole: 'admin', text: messageText, ts: now } } };
        const inbox = { ...(channel.moderationInbox || {}), [tid]: thread };
        if (ctx.state.mode === 'local' && ctx.localDB) { ctx.localDB.channels[channel.id] = { ...channel, moderationInbox: inbox }; ctx.persistLocal(); ctx.applyData(ctx.localDB); }
        else { await ctx.update(ctx.ref(ctx.db, `pixeltube/channels/${channel.id}`), { moderationInbox: inbox }); }
        ctx.state.channels[channel.id] = { ...channel, moderationInbox: inbox };
      }
    } catch (notifyError) { creatorNotified = false; console.error('[sec] creator review notification failed', notifyError); }
    let auditSaved = true;
    try { await writeModerationAudit(ctx, `video-${d}`, 'video', vid, reason, `Review status: ${status}`); }
    catch (auditError) { auditSaved = false; console.error('[sec] audit write failed after review decision', auditError); }
    ctx.toast((d === 'approve' ? 'Video approved' : d === 'ignore' ? 'Review item ignored; video remains private' : 'Video disapproved') + (creatorNotified ? '' : ' (creator inbox notification failed)') + (auditSaved ? '' : ' (audit log failed)'));
    return true;
  } catch (e) { console.error('[sec] review decision failed', e); ctx.toast('Could not save review decision: ' + (e?.message || 'database error')); return false; }
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
  return gatherReports(ctx).filter(r => !['resolved', 'dismissed'].includes(String(r.status || 'pending').toLowerCase()));
}
function resolvedReports(ctx) {
  return gatherReports(ctx).filter(r => ['resolved', 'dismissed'].includes(String(r.status || '').toLowerCase())).slice(0, 30);
}
function suspendedUsers(ctx) {
  return Object.entries(ctx.state.channels || {})
    .filter(([cid, ch]) => isChannelSuspended(ctx, cid))
    .map(([cid, ch]) => ({ cid, ch, mod: ch.moderation }))
    .sort((a, b) => (b.mod.suspendedAt || 0) - (a.mod.suspendedAt || 0));
}
function channelForUid(ctx, uid) {
  const cid = uid.startsWith('pl_') ? uid : ('pl_' + uid);
  return ctx.state.channels[cid] || null;
}
function reportsForVideo(ctx, vid) {
  return gatherReports(ctx).filter(r => r.videoId === vid);
}

export function viewAdmin(ctx, sub, detail = '') {
  const { PIXLECT, emptyState, isAdmin } = ctx;

  if (!PIXLECT.user) {
    return emptyState('🔒', 'Sign in required', 'You must be signed in to access the admin panel.', '');
  }
  if (!isAdmin()) {
    return emptyState('🚫', 'Admins only', 'You don\'t have permission to view this page.',
      `<a class="btn-ghost" href="#/">Go to Feed</a>`);
  }

  switch (sub) {
    case 'dashboard': return viewAdminDashboard(ctx);
    case 'channel': return viewAdminChannel(ctx, detail);
    case 'video': return viewAdminVideo(ctx, detail);
    case 'qvids': return viewAdminQvids(ctx);
    case 'suspended': return viewAdminSuspended(ctx);
    case 'videos':    return viewAdminVideos(ctx);
    case 'users':     return viewAdminUsers(ctx);
    case 'search':    return viewAdminSearch(ctx);
    case 'review':    return viewAdminReview(ctx);
    case 'appeals':   return viewAdminAppeals(ctx);
    case 'audit':     return viewAdminAudit(ctx);
    default:          return viewAdminReports(ctx);
  }
}

function adminWrap(ctx, active, contentHTML) {
  const pending = pendingReports(ctx).length;
  const suspended = suspendedUsers(ctx).length;
  const reviewCount = Object.values(ctx.state.videos || {}).filter(v => ['pending', 'ignored'].includes(String(v.reviewStatus || '').toLowerCase())).length;
  const appealCount = Object.values(ctx.state.channels || {}).reduce((n, c) => n + Object.values(c?.moderationInbox || {}).filter(t => ['appeal','user-appeal'].includes(String(t.type || '').toLowerCase()) && !t.closed).length, 0);

  const nav = [
    { id: 'dashboard', label: 'Dashboard', href: '#/admin/dashboard' },
    { id: 'reports',   label: 'Reports',      href: '#/admin',           count: pending },
    { id: 'suspended', label: 'Suspended',    href: '#/admin/suspended', count: suspended },
    { id: 'videos',    label: 'All videos',   href: '#/admin/videos' },
    { id: 'search',    label: 'Find channel / video', href: '#/admin/search' },
    { id: 'review',    label: 'Review queue', href: '#/admin/review', count: reviewCount },
    { id: 'qvids',     label: 'QVids', href: '#/admin/qvids', count: reviewCount },
    { id: 'appeals',   label: 'Appeals', href: '#/admin/appeals', count: appealCount },
    { id: 'audit',     label: 'Audit log', href: '#/admin/audit' }
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

function viewAdminDashboard(ctx) {
  const videos = Object.values(ctx.state.videos || {});
  const channels = Object.values(ctx.state.channels || {});
  const reports = gatherReports(ctx);
  const pending = pendingReports(ctx).length;
  const queue = videos.filter(v => ['pending','ignored'].includes(String(v.reviewStatus || '').toLowerCase())).length;
  const flagged = videos.filter(v => (v.moderationTags || []).length || v.moderation?.flagged).length;
  const suspended = channels.filter(c => c && isChannelSuspended(ctx, c.id)).length;
  const verified = channels.filter(c => c && c.verified).length;
  const recent = Object.values(ctx.state.audit || {}).sort((a,b)=>(b.ts||0)-(a.ts||0)).slice(0,8);
  const stat = (label, value, href, hint='') => `<a class="admin-stat-card" href="${href}"><span>${esc(label)}</span><strong>${Number(value).toLocaleString()}</strong><small>${esc(hint)}</small></a>`;
  const activity = recent.length ? recent.map(a=>`<div class="admin-row"><div class="admin-info"><div class="admin-title">${esc(a.action || 'Admin action')}</div><div class="admin-meta">${esc(a.admin || 'admin')} · ${esc(a.targetType || '')} ${esc(a.targetId || '')} · ${esc(a.ts ? new Date(a.ts).toLocaleString() : '')}</div></div></div>`).join('') : '<div class="admin-empty">No recent moderation actions recorded.</div>';
  return adminWrap(ctx, 'dashboard', `<div class="admin-head"><h1>Admin Dashboard</h1><p>PIXELTube moderation overview</p></div><section class="admin-stats-grid">${stat('Channels',channels.length,'#/admin/search')}${stat('Videos',videos.length,'#/admin/videos')}${stat('Open reports',pending,'#/admin')}${stat('Videos awaiting review',queue,'#/admin/qvids')}${stat('Flagged videos',flagged,'#/admin/search')}${stat('Suspended channels',suspended,'#/admin/suspended')}${stat('Verified channels',verified,'#/admin/search')}${stat('Total reports',reports.length,'#/admin')}</section><section class="admin-section"><div class="admin-section-heading"><h2>Recent admin activity</h2><a href="#/admin/audit">Full audit log →</a></div>${activity}</section>`);
}

function viewAdminQvids(ctx) {
  const queue = Object.values(ctx.state.videos || {}).filter(v => ['pending','ignored'].includes(String(v.reviewStatus || '').toLowerCase())).sort((a,b)=>(a.reviewSubmittedAt||a.createdAt||0)-(b.reviewSubmittedAt||b.createdAt||0));
  const rows = queue.length ? queue.map(v=>{const c=ctx.chanOf(v.id)||{};return `<div class="admin-row"><div class="admin-thumb">${thumbHTML(v)}</div><div class="admin-info"><div class="admin-title">${esc(v.title||'Untitled video')}</div><div class="admin-meta">${esc(c.name||'Unknown channel')} · ${esc(c.handle||'')} · ${esc(v.id)}</div><div class="admin-meta">${esc(String(v.reviewStatus||'pending').toUpperCase())} · submitted ${esc(timeAgo(v.reviewSubmittedAt||v.createdAt))}</div>${(v.moderationTags||[]).length?`<div class="admin-meta">Flags: ${v.moderationTags.map(t=>`<span class="admin-tag">${esc(t)}</span>`).join(' ')}</div>`:''}</div><div class="admin-actions"><a class="btn-secondary" href="#/admin/video/${esc(v.id)}">Inspect</a><a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank" rel="noopener">Preview</a><button class="btn-secondary" data-action="admin-review-approve" data-vid="${esc(v.id)}">Approve</button><button class="btn-secondary" data-action="admin-review-ignore" data-vid="${esc(v.id)}">Ignore</button><button class="btn-secondary" data-action="admin-review-disapprove" data-vid="${esc(v.id)}">Disapprove</button></div></div>`}).join('') : '<div class="admin-empty">No videos are waiting for review. To enable QVids, find a channel and open its Channel Admin Panel.</div>';
  return adminWrap(ctx,'qvids',`<div class="admin-head"><h1>QVids Approval Queue</h1><p>Only videos submitted by channels in REVIEW mode appear here. Enable or disable QVids inside the selected channel's Admin Panel.</p><a class="btn-primary" href="#/admin/search">Find a channel →</a></div><section class="admin-section"><h2>Approval inbox <span class="admin-count">${queue.length}</span></h2>${rows}</section>`);
}

function viewAdminChannel(ctx, cid) {
  const ch = ctx.state.channels?.[cid];
  if (!ch) return adminWrap(ctx,'search',`<div class="admin-head"><h1>Channel not found</h1><p>Search again and select the correct channel.</p><a class="btn-secondary" href="#/admin/search">Find channel</a></div>`);
  const videos = Object.values(ctx.state.videos||{}).filter(v=>v.channelId===cid).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
  const threads = Object.values(ch.moderationInbox||{}).sort((a,b)=>(b.updatedAt||b.createdAt||0)-(a.updatedAt||a.createdAt||0));
  const tags = videos.map(v=>(v.moderationTags||[]).length).reduce((a,b)=>a+b,0);
  const threadRows = threads.map(t=>`<div class="admin-row"><div class="admin-info"><div class="admin-title">${esc(t.subject||t.type||'Moderation message')} ${t.closed?'<span class="admin-search-kind">CLOSED</span>':'<span class="admin-search-kind">OPEN</span>'}</div><div class="admin-meta">${esc(t.reason||'')} · ${Object.values(t.messages||{}).length} messages</div>${Object.values(t.messages||{}).sort((a,b)=>(a.ts||0)-(b.ts||0)).map(m=>`<div class="admin-message"><b>${esc(m.senderName||'User')}</b> <small>${esc(m.ts?new Date(m.ts).toLocaleString():'')}</small><p>${esc(m.text||'')}</p></div>`).join('')}${!t.closed?`<div class="admin-reply"><textarea data-admin-thread-reply data-cid="${esc(cid)}" data-tid="${esc(t.id)}" maxlength="1000" placeholder="Reply to channel owner…"></textarea><button class="btn-primary" data-action="admin-thread-reply" data-cid="${esc(cid)}" data-tid="${esc(t.id)}">Send reply</button></div>`:''}</div><div class="admin-actions">${t.closed?`<button class="btn-secondary" data-action="admin-thread-reopen" data-cid="${esc(cid)}" data-tid="${esc(t.id)}">Reopen conversation</button>`:`<button class="btn-secondary" data-action="admin-thread-close" data-cid="${esc(cid)}" data-tid="${esc(t.id)}">Close conversation</button>`}</div></div>`).join('') || '<div class="admin-empty">No moderation conversations yet.</div>';
  const videoRows = videos.map(v=>`<div class="admin-row"><div class="admin-thumb">${thumbHTML(v)}</div><div class="admin-info"><div class="admin-title">${esc(v.title||'Untitled video')}</div><div class="admin-meta">${esc(v.id)} · ${esc(String(v.reviewStatus||'public').toUpperCase())} · ${v.moderation?.hidden||v.moderation?.restricted?'HIDDEN / RESTRICTED':'NORMAL VISIBILITY'}</div><div class="admin-meta">${(v.moderationTags||[]).map(t=>`<span class="admin-tag">${esc(t)}</span>`).join(' ')}</div></div><div class="admin-actions"><a class="btn-secondary" href="#/admin/video/${esc(v.id)}">Inspect / reports</a><a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank" rel="noopener">Open video</a><button class="btn-secondary" data-action="admin-flag-video" data-vid="${esc(v.id)}">Flag</button><button class="btn-secondary" data-action="admin-rename-video" data-vid="${esc(v.id)}">Rename</button><button class="btn-secondary" data-action="admin-warn-video" data-vid="${esc(v.id)}" data-cid="${esc(cid)}">Warn creator</button><button class="btn-secondary" data-action="admin-video-toggle-restrict" data-vid="${esc(v.id)}">${v.moderation?.hidden||v.moderation?.restricted?'Restore video':'Hide / restrict'}</button><button class="btn-secondary" data-action="admin-delete-standalone" data-vid="${esc(v.id)}" style="color:var(--accent)">Delete</button></div></div>`).join('') || '<div class="admin-empty">This channel has no videos.</div>';
  const verified = !!ch.verified;
  const suspended = isChannelSuspended(ctx,cid);
  const qvidsOn = String(ch.publishingMode||'FREE').toUpperCase()==='REVIEW';
  const channelReports = gatherReports(ctx).filter(r => videos.some(v => v.id === r.videoId));
  return adminWrap(ctx,'search',`<div class="admin-head"><a href="#/admin/search">← Find another channel</a><h1>Channel Admin Panel: ${esc(ch.name||'Untitled channel')} ${verified?'<span class="admin-verified">✓ VERIFIED</span>':''}</h1><p>${esc(ch.handle||'')} · Channel ID: <code>${esc(cid)}</code> · Owner ${esc(ch.ownerUsername||ch.ownerUid||'unknown')}</p></div>
  <section class="admin-section"><h2>QVids publishing control</h2><p class="admin-meta">Status: <b>${qvidsOn?'QVids ON — new uploads require approval':'QVids OFF — normal publishing'}</b></p><p>${qvidsOn?'New uploads from this channel should enter the approval queue. Existing public videos are not changed by this switch.':'Enable QVids to put this channel into REVIEW mode for new uploads.'}</p><div class="admin-control-grid"><button class="btn-primary" data-action="admin-qvids-toggle" data-cid="${esc(cid)}">${qvidsOn?'Turn QVids OFF':'Enable QVids for this channel'}</button><a class="btn-secondary" href="#/admin/qvids">Open QVids approval queue (${Object.values(ctx.state.videos||{}).filter(v=>v.channelId===cid && ['pending','ignored'].includes(String(v.reviewStatus||'').toLowerCase())).length})</a></div></section>
  <section class="admin-section"><h2>Channel administration</h2><div class="admin-control-grid"><button class="btn-secondary" data-action="admin-channel-warn" data-cid="${esc(cid)}">Send warning</button><button class="btn-secondary" data-action="admin-channel-email" data-cid="${esc(cid)}">Send admin inbox message</button><button class="btn-secondary" data-action="admin-verify-channel" data-cid="${esc(cid)}">${verified?'Revoke verification':'Verify channel'}</button><button class="btn-secondary" data-action="${suspended?'admin-unsuspend':'admin-suspend'}" data-cid="${esc(cid)}">${suspended?'Reinstate channel':'Suspend channel'}</button><button class="btn-secondary" data-action="admin-channel-delete" data-cid="${esc(cid)}" style="color:var(--accent)">Delete channel…</button></div><p class="admin-meta">Publishing mode: <b>${esc(String(ch.publishingMode||'FREE').toUpperCase())}</b> · ${videos.length} videos · ${tags} video flags · ${channelReports.length} reports on its videos</p><div class="admin-actions"><a class="btn-secondary" href="#/admin/search">Search channels</a><a class="btn-secondary" href="#/admin">Open reports center</a><a class="btn-secondary" href="#/admin/appeals">Open appeals</a><a class="btn-secondary" href="#/admin/audit">Open audit log</a></div></section><section class="admin-section"><h2>Admin inbox / conversations</h2>${threadRows}</section><section class="admin-section"><h2>Videos in this channel (${videos.length})</h2>${videoRows}</section>`);
}

function viewAdminVideo(ctx, vid) {
  const v = ctx.state.videos?.[vid];
  if (!v) return adminWrap(ctx, 'videos', `<div class="admin-head"><h1>Video not found</h1><p>This video may have been deleted or is not in the loaded dataset.</p><a class="btn-secondary" href="#/admin/videos">All videos</a></div>`);
  const c = ctx.chanOf(vid) || {};
  const reports = reportsForVideo(ctx, vid);
  const tags = Array.isArray(v.moderationTags) ? v.moderationTags : [];
  const hidden = !!(v.moderation?.hidden || v.moderation?.restricted);
  const reportRows = reports.map(r => `<div class="admin-row"><div class="admin-info"><div class="admin-title">${esc(r.category || 'other')} · ${esc(String(r.status || 'pending').toUpperCase())}</div><div class="admin-meta">${esc(r.reporterUsername || 'user')} · ${esc(r.ts ? new Date(r.ts).toLocaleString() : 'date unknown')}</div><div class="admin-note">${esc(r.note || 'No additional details.')}</div><a class="btn-secondary" href="#/admin">Open report center</a></div></div>`).join('') || '<div class="admin-empty">No reports are linked to this video.</div>';
  return adminWrap(ctx, 'videos', `<div class="admin-head"><a href="#/admin/search">← Search</a><h1>${esc(v.title || 'Untitled video')}</h1><p>Video ID: <code>${esc(v.id)}</code> · Channel: ${esc(c.name || 'Unknown channel')} · ${esc(c.handle || '')}</p></div>
    <section class="admin-section"><h2>Video inspection</h2><div class="admin-control-grid"><a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank" rel="noopener">Open video</a><a class="btn-secondary" href="#/admin/channel/${esc(c.id || '')}">Open channel editor</a><button class="btn-secondary" data-action="admin-flag-video" data-vid="${esc(v.id)}">Edit flags</button><button class="btn-secondary" data-action="admin-rename-video" data-vid="${esc(v.id)}">Rename video</button><button class="btn-secondary" data-action="admin-warn-video" data-vid="${esc(v.id)}" data-cid="${esc(c.id || '')}">Warn creator</button><button class="btn-secondary" data-action="admin-video-toggle-restrict" data-vid="${esc(v.id)}">${hidden ? 'Restore public visibility' : 'Hide / restrict video'}</button><button class="btn-secondary" data-action="admin-delete-standalone" data-vid="${esc(v.id)}" style="color:var(--accent)">Delete video…</button></div>
    <div class="admin-meta">Creator UID: <code>${esc(c.ownerUid || v.createdBy || 'unknown')}</code></div><div class="admin-meta">Uploaded: ${esc(v.createdAt ? new Date(v.createdAt).toLocaleString() : 'unknown')} · Kind: ${esc(v.kind || 'long')} · Views: ${fmt(v.views)} · Likes: ${fmt(v.likes)} · Dislikes: ${fmt(v.dislikes)}</div><div class="admin-meta">Review status: <b>${esc(String(v.reviewStatus || 'public').toUpperCase())}</b> · Visibility: <b>${hidden ? 'HIDDEN / RESTRICTED' : 'NORMAL'}</b></div><div class="admin-note">${esc(v.desc || v.description || 'No description supplied.')}</div><div class="admin-meta">Flags: ${tags.length ? tags.map(t=>`<span class="admin-tag">${esc(t)}</span>`).join(' ') : 'No custom flags'}</div>
    ${['pending','ignored'].includes(String(v.reviewStatus||'').toLowerCase()) ? `<div class="admin-actions"><button class="btn-secondary" data-action="admin-review-approve" data-vid="${esc(v.id)}">Approve</button><button class="btn-secondary" data-action="admin-review-ignore" data-vid="${esc(v.id)}">Ignore</button><button class="btn-secondary" data-action="admin-review-disapprove" data-vid="${esc(v.id)}">Decline</button></div>` : ''}</section>
    <section class="admin-section"><h2>Reports for this video (${reports.length})</h2>${reportRows}</section>`);
}

function viewAdminReview(ctx) {
  const queue = Object.values(ctx.state.videos || {})
    .filter(v => ['pending', 'ignored'].includes(String(v.reviewStatus || '').toLowerCase()))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const rows = queue.length ? queue.map(v => {
    const c = ctx.chanOf(v.id) || {};
    return `<div class="admin-row">
      <div class="admin-thumb">${thumbHTML(v)}</div>
      <div class="admin-info">
        <div class="admin-title">${esc(v.title || '(untitled video)')}</div>
        <div class="admin-meta">${esc(c.name || 'Unknown channel')} · ${esc(v.id)} · uploaded ${esc(timeAgo(v.createdAt))}</div>
        <div class="admin-meta">Status: <b>${esc(String(v.reviewStatus || 'pending').toUpperCase())}</b>${v.reviewReason ? ` · ${esc(v.reviewReason)}` : ''}</div>
      </div>
      <div class="admin-actions">
        <a class="btn-secondary" href="#/admin/video/${esc(v.id)}">Inspect</a>
        <a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank" rel="noopener">Preview</a>
        <button class="btn-secondary" data-action="admin-review-approve" data-vid="${esc(v.id)}" type="button">Approve</button>
        <button class="btn-secondary" data-action="admin-review-ignore" data-vid="${esc(v.id)}" type="button">Ignore</button>
        <button class="btn-secondary" data-action="admin-review-disapprove" data-vid="${esc(v.id)}" type="button" style="color:var(--accent)">Disapprove</button>
      </div>
    </div>`;
  }).join('') : `<div class="admin-empty">No videos are waiting for review.</div>`;
  return adminWrap(ctx, 'review', `<div class="admin-head"><h1>Video review queue</h1><p>${queue.length} pending or ignored video${queue.length === 1 ? '' : 's'}. Ignored items remain private and can be reviewed again.</p></div><section class="admin-section">${rows}</section>`);
}

function viewAdminAppeals(ctx) {
  const appeals = Object.values(ctx.state.channels || {}).flatMap(channel => Object.values(channel?.moderationInbox || {})
    .filter(thread => ['appeal','user-appeal'].includes(String(thread.type || '').toLowerCase()))
    .map(thread => ({ channel, thread })))
    .sort((a,b)=>(b.thread.updatedAt||b.thread.createdAt||0)-(a.thread.updatedAt||a.thread.createdAt||0));
  const rows = appeals.map(({channel,thread}) => `<article class="admin-row"><div class="admin-info"><div class="admin-title">${esc(thread.subject || 'Moderation appeal')} ${thread.closed?'<span class="admin-search-kind">CLOSED</span>':'<span class="admin-search-kind">OPEN</span>'}</div><div class="admin-meta">Channel: <b>${esc(channel.name || channel.handle || channel.id)}</b> · ${esc(channel.handle || '')} · ${esc(thread.createdAt ? new Date(thread.createdAt).toLocaleString() : '')}</div><div class="admin-note">${esc(thread.reason || '')}</div>${Object.values(thread.messages || {}).sort((a,b)=>(a.ts||0)-(b.ts||0)).map(m=>`<div class="admin-message"><b>${esc(m.senderName || 'User')}</b> <small>${esc(m.ts ? new Date(m.ts).toLocaleString() : '')}</small><p>${esc(m.text || '')}</p></div>`).join('')}${!thread.closed?`<div class="admin-reply"><textarea data-admin-thread-reply data-cid="${esc(channel.id)}" data-tid="${esc(thread.id)}" maxlength="1000" placeholder="Reply to appeal…"></textarea><button class="btn-primary" data-action="admin-thread-reply" data-cid="${esc(channel.id)}" data-tid="${esc(thread.id)}">Reply to appeal</button></div>`:''}</div><div class="admin-actions"><a class="btn-secondary" href="#/admin/channel/${esc(channel.id)}">Channel editor</a><button class="btn-secondary" data-action="admin-thread-close" data-cid="${esc(channel.id)}" data-tid="${esc(thread.id)}" ${thread.closed?'disabled':''}>Close appeal</button></div></article>`).join('');
  return adminWrap(ctx, 'appeals', `<div class="admin-head"><h1>Appeals</h1><p>Creator appeals and moderation disputes from the in-app inbox.</p></div><section class="admin-section">${rows || '<div class="admin-empty">No appeals have been submitted.</div>'}</section>`);
}

function viewAdminAudit(ctx) {
  const entries = Object.values(ctx.state.audit || {}).sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 200);
  const rows = entries.length ? entries.map(a => `<div class="admin-row"><div class="admin-info"><div class="admin-title">${esc(a.action || 'Moderation action')}</div><div class="admin-meta">${esc(a.admin || 'admin')} · ${esc(a.targetType || 'target')} ${esc(a.targetId || '')} · ${esc(a.ts ? new Date(a.ts).toLocaleString() : 'time unavailable')}</div>${a.reason ? `<div class="admin-note">${esc(a.reason)}</div>` : ''}${a.details ? `<div class="admin-meta">${esc(a.details)}</div>` : ''}</div></div>`).join('') : `<div class="admin-empty">No audit events are available in this client dataset.</div>`;
  return adminWrap(ctx, 'audit', `<div class="admin-head"><h1>Moderation audit log</h1><p>Latest ${entries.length} events visible in the loaded dataset.</p></div><section class="admin-section">${rows}</section>`);
}

function viewAdminReports(ctx) {
  const all = gatherReports(ctx);
  const pending = all.filter(r => !['resolved', 'dismissed'].includes(String(r.status || 'pending').toLowerCase()));
  const resolved = all.filter(r => ['resolved', 'dismissed'].includes(String(r.status || '').toLowerCase())).slice(0, 100);
  const channels = Object.values(ctx.state.channels || {}).filter(Boolean).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
  const reasonOptions = [...new Set(all.map(r => String(r.category || 'other')))].sort();
  const creatorOptions = channels.map(c => `<option value="${esc(c.id)}">${esc(c.name || c.handle || c.id)}</option>`).join('');
  const rows = [...pending, ...resolved].map(r => adminReportRow(ctx, r)).join('');
  return adminWrap(ctx, 'reports', `
    <div class="admin-head"><h1>Reports Center</h1><p>${pending.length} open · ${resolved.length} recently resolved or dismissed · ${all.length} total loaded</p></div>
    <section class="admin-section">
      <div class="admin-report-filters">
        <label>Search reports<input type="search" data-report-filter-search placeholder="Reporter, video title, ID, creator…"></label>
        <label>Status<select data-report-filter-status><option value="">All statuses</option><option value="pending">Pending</option><option value="under-review">Under review</option><option value="resolved">Resolved</option><option value="dismissed">Dismissed</option></select></label>
        <label>Reason<select data-report-filter-category><option value="">All reasons</option>${reasonOptions.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></label>
        <label>Creator<select data-report-filter-creator><option value="">All creators</option>${creatorOptions}</select></label>
        <label>From date<input type="date" data-report-filter-from></label>
        <label>To date<input type="date" data-report-filter-to></label>
        <button class="btn-secondary" type="button" data-report-filter-clear>Clear filters</button>
      </div>
      <p class="admin-search-status" data-report-filter-count aria-live="polite">${all.length} report rows shown</p>
    </section>
    <section class="admin-section"><h2>All reports <span class="admin-count">${all.length}</span></h2>
      <div data-admin-reports-list>${rows || '<div class="admin-empty">No reports have been submitted.</div>'}</div>
      <div class="admin-empty" data-report-filter-empty hidden>No reports match these filters.</div>
    </section>`);
}

function adminReportRow(ctx, r) {
  const v = ctx.state.videos?.[r.videoId];
  const c = v ? ctx.chanOf(v.id) : null;
  const reportsOnVideo = v ? reportsForVideo(ctx, v.id).length : 0;
  const status = String(r.status || 'pending').toLowerCase();
  const reportSearch = [r.reporterUsername, r.reporterUid, r.category, r.note, v?.title, v?.id, c?.name, c?.handle, c?.ownerUid].join(' ');
  const date = Number(r.ts || 0);
  const dateKey = date ? new Date(date).toISOString().slice(0,10) : '';
  const details = `<details class="admin-report-details"><summary>Full report details · ${esc(r.id || 'report')}</summary><div class="admin-report-detail-body"><div class="admin-meta">Report ID: <code>${esc(r.id || 'unknown')}</code></div><div class="admin-meta">Reporter: <b>${esc(r.reporterUsername || 'unknown')}</b> · UID: <code>${esc(r.reporterUid || 'unknown')}</code></div><div class="admin-meta">Submitted: ${esc(date ? new Date(date).toLocaleString() : 'Unknown date')}</div><div class="admin-meta">Reason: <b>${esc(r.category || 'other')}</b></div><div class="admin-note">${esc(r.note || 'No additional details supplied.')}</div><div class="admin-meta">Video: ${esc(v?.title || '(video deleted)')} · ID: <code>${esc(r.videoId || 'unknown')}</code></div><div class="admin-meta">Creator: <b>${esc(c?.name || 'Unknown creator')}</b> · ${esc(c?.handle || '')} · owner UID: <code>${esc(c?.ownerUid || 'unknown')}</code></div>${r.moderationNote ? `<div class="admin-meta">Moderation note: ${esc(r.moderationNote)}</div>` : ''}</div></div></details>`;
  return `<article class="admin-row admin-report-item" data-admin-report-item data-report-id="${esc(r.id || '')}" data-report-status="${esc(status)}" data-report-category="${esc(r.category || 'other')}" data-report-creator="${esc(c?.id || '')}" data-report-date="${esc(dateKey)}" data-report-search="${esc(reportSearch)}">
    <div class="admin-thumb">${v ? thumbHTML(v) : '<div class="placeholder">🚫</div>'}</div>
    <div class="admin-info"><div class="admin-title">${esc(v?.title || '(video deleted)')} <span class="admin-search-kind">${esc(status.toUpperCase())}</span></div>
      <div class="admin-meta">Reported by <b>${esc(r.reporterUsername || 'user')}</b> · ${esc(date ? timeAgo(date) : 'date unknown')} · Reason: <b>${esc(r.category || 'other')}</b>${reportsOnVideo > 1 ? ` · <span style="color:var(--warn)">${reportsOnVideo} reports on this video</span>` : ''}</div>
      ${c ? `<div class="admin-meta">Creator: <b>${esc(c.name || 'Unknown channel')}</b> (${esc(c.handle || '')})</div>` : ''}
      ${r.note ? `<div class="admin-note">${esc(r.note)}</div>` : ''}${details}
    </div>
    <div class="admin-actions">${v ? `<a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank" rel="noopener">Open video</a>` : ''}${c ? `<a class="btn-secondary" href="#/channel/${esc(c.id)}" target="_blank" rel="noopener">View creator</a><a class="btn-secondary" href="#/admin/channel/${esc(c.id)}">Manage channel</a>` : ''}
      ${!['resolved','dismissed'].includes(status) ? `${status !== 'under-review' ? `<button class="btn-secondary" data-action="admin-report-under-review" data-rid="${esc(r.id)}" type="button">Mark under review</button>` : ''}<button class="btn-secondary" data-action="admin-resolve" data-rid="${esc(r.id)}" type="button">Resolve</button><button class="btn-secondary" data-action="admin-dismiss" data-rid="${esc(r.id)}" type="button">Dismiss</button>` : ''}
      ${v ? `<button class="btn-secondary" data-action="admin-delete" data-rid="${esc(r.id)}" data-vid="${esc(v.id)}" type="button" style="color:var(--accent)">Delete video</button>` : ''}
      ${c && !isChannelSuspended(ctx,c.id) ? `<button class="btn-secondary" data-action="admin-suspend" data-cid="${esc(c.id)}" data-rid="${esc(r.id)}" type="button" style="color:var(--warn)">Suspend channel</button>` : ''}
    </div>
  </article>`;
}

function viewAdminSuspended(ctx) {
  const list = suspendedUsers(ctx);

  const rows = list.length ? list.map(({ cid, ch, mod }) => {
    return `
      <div class="admin-row">
        <div class="admin-info">
          <div class="admin-title">${ch ? esc(ch.name) : '(channel deleted)'}</div>
          <div class="admin-meta"><b>${esc(mod.reason || 'Suspended')}</b></div>
          <div class="admin-meta">
            Suspended ${esc(timeAgo(mod.suspendedAt))}
            by <b>${esc(mod.suspendedBy || 'admin')}</b> · expires ${esc(new Date(mod.expiresAt).toLocaleString())}
          </div>
        </div>
        <div class="admin-actions">
          ${ch ? `<a class="btn-secondary" href="#/channel/${esc(ch.id)}" target="_blank">View channel</a>` : ''}
          ${ch ? `<button class="btn-secondary" data-action="admin-unsuspend" data-cid="${esc(cid)}" type="button">Reinstate</button>` : ''}
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
  const all = Object.values(ctx.state.videos || {}).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const rows = all.length ? all.map(v => {
    const c = ctx.chanOf(v.id);
    return `
      <div class="admin-row">
        <label class="admin-select-box"><input type="checkbox" data-admin-video-select value="${esc(v.id)}" aria-label="Select ${esc(v.title)}"></label>
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
          <a class="btn-secondary" href="#/admin/video/${esc(v.id)}">Inspect</a><a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank" rel="noopener">View</a>
          <button class="btn-secondary" data-action="admin-flag-video" data-vid="${esc(v.id)}" type="button">Flag</button>
          <button class="btn-secondary" data-action="admin-rename-video" data-vid="${esc(v.id)}" type="button">Rename</button>
          <button class="btn-secondary" data-action="admin-warn-video" data-vid="${esc(v.id)}" data-cid="${esc(v.channelId)}" type="button">Warn creator</button>
          <button class="btn-secondary" data-action="admin-delete-standalone" data-vid="${esc(v.id)}" type="button" style="color:var(--accent)">Delete</button>
        </div>
      </div>`;
  }).join('') : `<div class="admin-empty">No videos on the platform yet.</div>`;

  return adminWrap(ctx, 'videos', `
    <div class="admin-head">
      <h1>All videos</h1>
      <p>${all.length} video${all.length === 1 ? '' : 's'} across every channel</p>
    </div>
    <section class="admin-section"><div class="admin-bulk-toolbar"><label><input type="checkbox" data-admin-select-all> Select all</label><button class="btn-secondary" data-action="admin-bulk-flag">Flag selected</button><button class="btn-secondary" data-action="admin-bulk-hide">Hide selected</button><button class="btn-secondary" data-action="admin-bulk-restore">Restore selected</button><button class="btn-secondary" data-action="admin-bulk-approve">Approve selected</button><button class="btn-secondary" data-action="admin-bulk-ignore">Ignore selected</button><button class="btn-secondary" data-action="admin-bulk-disapprove">Decline selected</button><button class="btn-secondary" data-action="admin-bulk-delete" style="color:var(--accent)">Delete selected</button></div>${rows}</section>
  `);
}


/* ============================================================
   GLOBAL SEARCH — search loaded channels and videos together
   ============================================================ */
function viewAdminSearch(ctx) {
  const channels = Object.values(ctx.state.channels || {})
    .filter(c => c && c.id)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const videos = Object.values(ctx.state.videos || {})
    .filter(v => v && v.id)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const channelRows = channels.map(c => {
    const count = videos.filter(v => v.channelId === c.id).length;
    const haystack = [c.name, c.handle, c.id, c.ownerUid, c.username, c.description].join(' ');
    return `
      <div class="admin-row admin-search-result" data-admin-search-item data-search-kind="channel" data-search-status="${String(c.moderation?.suspended?'suspended':'active')}" data-search-flagged="false" data-search-text="${esc(haystack)}">
        ${avatarHTML(c, 'lg')}
        <div class="admin-info">
          <div class="admin-title">${esc(c.name || 'Untitled channel')} <span class="admin-search-kind">CHANNEL</span></div>
          <div class="admin-meta">${esc(c.handle || '')} · ${count} video${count === 1 ? '' : 's'} · ID: <code>${esc(c.id)}</code></div>
          <div class="admin-meta">Owner UID: <code>${esc(c.ownerUid || 'unknown')}</code></div>
        </div>
        <div class="admin-actions"><a class="btn-primary" href="#/admin/channel/${esc(c.id)}">Open Channel Admin Panel</a></div>
      </div>`;
  }).join('');

  const videoRows = videos.map(v => {
    const c = ctx.chanOf(v.id) || {};
    const haystack = [v.title, v.id, v.description, v.kind, c.name, c.handle, c.id, c.ownerUid].join(' ');
    return `
      <div class="admin-row admin-search-result" data-admin-search-item data-search-kind="video" data-search-status="${String(v.reviewStatus||'public').toLowerCase()==='approved'?'public':esc(String(v.reviewStatus||'public').toLowerCase())}" data-search-flagged="${((v.moderationTags||[]).length || v.moderation?.flagged)?'true':'false'}" data-search-text="${esc(haystack)}">
        <div class="admin-thumb">${thumbHTML(v)}</div>
        <div class="admin-info">
          <div class="admin-title">${esc(v.title || 'Untitled video')} <span class="admin-search-kind">VIDEO</span></div>
          <div class="admin-meta">Channel: <b>${esc(c.name || 'Unknown channel')}</b> · ${v.kind === 'mini' ? 'Mini' : 'Long'} · ID: <code>${esc(v.id)}</code></div>
          <div class="admin-meta">${fmt(v.views)} views · ${esc(timeAgo(v.createdAt))}</div>
        </div>
        <div class="admin-actions">
          <a class="btn-secondary" href="#/admin/video/${esc(v.id)}">Inspect</a><a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank" rel="noopener">View video</a>
          <button class="btn-secondary" data-action="admin-delete-standalone" data-vid="${esc(v.id)}" type="button" style="color:var(--accent)">Delete</button>
        </div>
      </div>`;
  }).join('');

  const total = channels.length + videos.length;
  return adminWrap(ctx, 'search', `
    <div class="admin-head">
      <div><h1>Search channels &amp; videos</h1><p>Search channel names, @handles, video titles, IDs, and owner UIDs.</p></div>
      <p>${channels.length} channels · ${videos.length} videos</p>
    </div>
    <section class="admin-section admin-search-panel">
      <label class="admin-search-label" for="adminGlobalSearch">Search PIXELTube</label>
      <div class="admin-search-filters"><label>Type <select data-admin-search-kind><option value="">Channels + videos</option><option value="channel">Channels only</option><option value="video">Videos only</option></select></label><label>Status <select data-admin-search-status><option value="">Any status</option><option value="active">Active channel</option><option value="suspended">Suspended channel</option><option value="public">Public / approved video</option><option value="pending">Pending review</option><option value="ignored">Ignored review</option><option value="disapproved">Disapproved</option></select></label><label>Flags <select data-admin-search-flagged><option value="">Any flags</option><option value="true">Flagged only</option><option value="false">Not flagged</option></select></label></div>
      <div class="admin-search-box"><span aria-hidden="true">⌕</span><input id="adminGlobalSearch" type="search" data-admin-search-input placeholder="Try a channel name, video title, @handle, or ID…" autocomplete="off" aria-controls="adminGlobalSearchResults"><button type="button" class="btn-secondary" data-admin-search-clear>Clear</button></div>
      <p class="admin-search-status" data-admin-search-count aria-live="polite">Type a channel name, @handle, channel ID, video title, or video ID to search. Results stay hidden until you search.</p>
      <div id="adminGlobalSearchResults" class="admin-search-results">
        ${channelRows.replaceAll('data-admin-search-item', 'data-admin-search-item hidden')}
        ${videoRows.replaceAll('data-admin-search-item', 'data-admin-search-item hidden')}
        <div class="admin-empty" data-admin-search-empty hidden>No channels or videos match that search.</div>
        ${total === 0 ? '<div class="admin-empty">No channels or videos are available yet.</div>' : ''}
      </div>
    </section>`);
}

function viewAdminUsers(ctx) {
  return adminWrap(ctx, 'search', `<div class="admin-head"><h1>Channel Admin</h1><p>Channel directories are not shown by default. Search for the exact channel, then open its private admin panel.</p><a class="btn-primary" href="#/admin/search">Search channels →</a></div>`);
}


// Search-first admin panel interactions. Keep all channel/video rows hidden until a query is entered.
document.addEventListener('input', event => {
  const input = event.target.closest('[data-admin-search-input]');
  if (!input) return;
  const query = String(input.value || '').trim().toLocaleLowerCase();
  const panel = input.closest('.admin-search-panel');
  if (!panel) return;
  const kind = panel.querySelector('[data-admin-search-kind]')?.value || '';
  const status = panel.querySelector('[data-admin-search-status]')?.value || '';
  const flagged = panel.querySelector('[data-admin-search-flagged]')?.value || '';
  const rows = [...panel.querySelectorAll('[data-admin-search-item]')];
  let shown = 0;
  for (const row of rows) {
    const haystack = String(row.dataset.searchText || '').toLocaleLowerCase();
    const matches = !!query && haystack.includes(query) && (!kind || row.dataset.searchKind === kind) && (!status || row.dataset.searchStatus === status) && (!flagged || row.dataset.searchFlagged === flagged);
    row.hidden = !matches;
    if (matches) shown++;
  }
  const count = panel.querySelector('[data-admin-search-count]');
  if (count) count.textContent = query ? `${shown} result${shown === 1 ? '' : 's'} for “${input.value.trim()}”` : 'Type a channel name, @handle, channel ID, video title, or video ID to search.';
  const empty = panel.querySelector('[data-admin-search-empty]');
  if (empty) empty.hidden = !query || shown !== 0;
});
document.addEventListener('change', event => {
  if (!event.target.matches('[data-admin-search-kind], [data-admin-search-status], [data-admin-search-flagged]')) return;
  const panel = event.target.closest('.admin-search-panel');
  const input = panel?.querySelector('[data-admin-search-input]');
  if (input) input.dispatchEvent(new Event('input', { bubbles: true }));
});
document.addEventListener('click', event => {
  const clear = event.target.closest('[data-admin-search-clear]');
  if (!clear) return;
  const panel = clear.closest('.admin-search-panel');
  const input = panel?.querySelector('[data-admin-search-input]');
  if (!input) return;
  input.value = '';
  panel.querySelectorAll('[data-admin-search-kind], [data-admin-search-status], [data-admin-search-flagged]').forEach(select => { select.value = ''; });
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
});

// Live filters for the reports list. Filters operate on the rendered dataset and
// do not rerender the page, so expanded report details and filter values remain intact.
document.addEventListener('input', event => {
  if (event.target.matches('[data-report-filter-search], [data-report-filter-from], [data-report-filter-to]')) {
    filterAdminReports(event.target.closest('.admin-main'));
  }
});
document.addEventListener('change', event => {
  if (event.target.matches('[data-report-filter-category], [data-report-filter-status], [data-report-filter-creator], [data-report-filter-from], [data-report-filter-to]')) {
    filterAdminReports(event.target.closest('.admin-main'));
  }
});
document.addEventListener('click', event => {
  const clear = event.target.closest('[data-report-filter-clear]');
  if (!clear) return;
  const root = clear.closest('.admin-main');
  if (!root) return;
  root.querySelectorAll('[data-report-filter-search], [data-report-filter-from], [data-report-filter-to], [data-report-filter-category], [data-report-filter-status], [data-report-filter-creator]').forEach(el => { el.value = ''; });
  filterAdminReports(root);
});
function filterAdminReports(root) {
  if (!root) return;
  const q = String(root.querySelector('[data-report-filter-search]')?.value || '').trim().toLowerCase();
  const category = String(root.querySelector('[data-report-filter-category]')?.value || '');
  const status = String(root.querySelector('[data-report-filter-status]')?.value || '');
  const creator = String(root.querySelector('[data-report-filter-creator]')?.value || '');
  const from = String(root.querySelector('[data-report-filter-from]')?.value || '');
  const to = String(root.querySelector('[data-report-filter-to]')?.value || '');
  const rows = [...root.querySelectorAll('[data-admin-report-item]')];
  let shown = 0;
  for (const row of rows) {
    const searchText = String(row.dataset.reportSearch || '').toLowerCase();
    const date = String(row.dataset.reportDate || '');
    const matches = (!q || searchText.includes(q))
      && (!category || row.dataset.reportCategory === category)
      && (!status || row.dataset.reportStatus === status)
      && (!creator || row.dataset.reportCreator === creator)
      && (!from || (date && date >= from))
      && (!to || (date && date <= to));
    row.hidden = !matches;
    if (matches) shown++;
  }
  const count = root.querySelector('[data-report-filter-count]');
  if (count) count.textContent = `${shown} report row${shown === 1 ? '' : 's'} shown`;
  const empty = root.querySelector('[data-report-filter-empty]');
  if (empty) empty.hidden = shown !== 0;
}

/* User-facing moderation inbox. Messages are scoped to channels owned by the signed-in user. */
export function viewModerationInbox(ctx) {
  const user = ctx.PIXLECT.user;
  if (!user) return ctx.emptyState('🔒','Sign in required','Sign in to view admin messages.','');
  const owned = Object.values(ctx.state.channels||{}).filter(c=>c && c.ownerUid===user.uid);
  const threads = owned.flatMap(c=>Object.values(c.moderationInbox||{}).filter(t=>Object.values(t.messages||{}).some(m=>m && m.senderRole==='admin') || t.createdByRole==='admin').map(t=>({channel:c,thread:t}))).sort((a,b)=>(b.thread.updatedAt||b.thread.createdAt||0)-(a.thread.updatedAt||a.thread.createdAt||0));
  const rows = threads.map(({channel,thread})=>`<article class="admin-row"><div class="admin-info"><div class="admin-title">${esc(thread.subject||'Message from PIXELTube Admin')} ${thread.closed?'<span class="admin-search-kind">CLOSED</span>':'<span class="admin-search-kind">OPEN</span>'}</div><div class="admin-meta">From PIXELTube Admin · Channel: ${esc(channel.name||channel.handle||channel.id)} · ${esc(thread.createdAt?new Date(thread.createdAt).toLocaleString():'')}</div><div class="admin-note">${esc(thread.reason||'')}</div>${Object.values(thread.messages||{}).sort((a,b)=>(a.ts||0)-(b.ts||0)).map(m=>`<div class="admin-message"><b>${esc(m.senderRole==='admin' ? (m.senderName||'PIXELTube Admin') : (m.senderName||'You'))}</b> <small>${esc(m.ts?new Date(m.ts).toLocaleString():'')}</small><p>${esc(m.text||'')}</p></div>`).join('')}${thread.closed?'<p class="admin-meta">This conversation is closed. Only an administrator can reopen it.</p>':`<div class="admin-reply"><textarea data-inbox-reply data-cid="${esc(channel.id)}" data-tid="${esc(thread.id)}" maxlength="1000" placeholder="Reply to PIXELTube Admin…"></textarea><button class="btn-primary" data-action="inbox-reply" data-cid="${esc(channel.id)}" data-tid="${esc(thread.id)}">Reply to admin</button></div>`}</div></article>`).join('');
  return `<div class="page-head"><h1>Messages from Admin</h1><p>Messages and warnings sent by PIXELTube Admin to your channel. You can reply to open conversations; you cannot create admin conversations or access moderation tools here.</p></div><section class="admin-section"><h2>Messages from Admin</h2>${rows||'<div class="admin-empty">No messages from PIXELTube Admin yet.</div>'}</section>`;
}
