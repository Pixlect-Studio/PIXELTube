/* ============================================================
   PIXELTube — security.js
   Moderation primitives:
     - Suspension state read/write
     - Report submission + report modal
     - Community Guidelines acceptance gate
   The admin *panel* itself lives in admin.js.
   ============================================================ */
import { esc, timeAgo } from './helpers.js';

/* ============================================================
   SUSPENSION STATE
   Stored at pixeltube/users/pl_<uid>/mod
     { suspended, reason, suspendedAt, suspendedBy, strikes }
   ============================================================ */

export function isUserSuspended(ctx, uid) {
  const u = ctx.state.users?.[uid];
  return !!(u && u.mod && u.mod.suspended);
}

export function getSuspensionInfo(ctx, uid) {
  const u = ctx.state.users?.[uid];
  return (u && u.mod) || null;
}

/* Returns null if the signed-in user can upload, or a reason object. */
export function canCurrentUserUpload(ctx) {
  const { PIXLECT, state, isAdmin } = ctx;
  if (!PIXLECT.user) return { reason: 'not-signed-in' };
  if (isAdmin()) return null;

  /* The state.users key uses pl_<uid> */
  const key = 'pl_' + PIXLECT.user.uid;
  const u = state.users[key] || state.users[PIXLECT.user.uid];
  if (u && u.mod && u.mod.suspended) {
    return { reason: 'suspended', info: u.mod };
  }
  return null;
}

/* ============================================================
   SUSPEND / UNSUSPEND
   Called from admin.js action handlers.
   ============================================================ */
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
    console.error('[security] suspend failed', e);
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
    console.error('[security] unsuspend failed', e);
    toast('Could not reinstate channel');
    return false;
  }
}

/* ============================================================
   REPORT SUBMISSION
   Writes to pixeltube/reports/<reportId>
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
    console.error('[security] report failed', e);
    toast('Could not submit report');
    return false;
  }
}

/* ============================================================
   REPORT MODAL
   Called from the "report-video" data-action handler in main.js.
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
   COMMUNITY GUIDELINES GATE
   Shown once per browser before the user's first upload.
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
          <p>
            By clicking <b>I agree</b>, you confirm that everything you upload complies with
            these rules and with our
            <a href="#/terms" style="color:var(--accent)">Terms &amp; Conditions</a>.
            You can read the full
            <a href="#/guidelines" style="color:var(--accent)">Community Guidelines</a>
            any time from the footer.
          </p>
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

/* Wraps a function so it runs only after the guidelines are accepted. */
export function requireGuidelines(fn) {
  return function (...args) {
    if (hasAcceptedGuidelines()) return fn(...args);
    promptGuidelines(() => fn(...args));
  };
}