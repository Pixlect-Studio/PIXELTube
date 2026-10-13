import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, remove, update, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  $, $$, esc, fmt, fmtBytes, timeAgo, initial,
  avatarHTML, thumbHTML, captureThumbnailFromFile, resizeImageFile,
  parseDuration, getSearchHistory, pushSearchHistory, clearSearchHistory,
  hasSearchHistory
} from './helpers.js';

import * as storage from './storage.js';

import {
  viewFeed, viewSubs, viewLiked, viewPlaylists, viewPlaylist,
  wireSearchInput, wireClearHistory
} from './feed.js';

import {
  viewMiniViewer, viewMinis, setupMinis, resetMinisPagination
} from './video_mini.js';

import {
  viewWatch, setupCommentForm
} from './video_large.js';

import {
  viewChannel, promptCreateChannel, promptEditChannel
} from './channel.js';

import {
  viewAdminQueue, promptReportVideo,
  adminDismissReport, adminDeleteFromReport,
  adminSuspendFromReport, adminDeleteStandalone, unsuspendChannel,
  canCurrentUserUpload, requireGuidelines, hasAcceptedGuidelines,
  promptGuidelines, isUserSuspended
} from './security.js';
import {
  viewPrivacy, viewTerms, viewGuidelines
} from './legal.js';

/* ============================================================
   FIREBASE — PRIMARY + BACKUP
   ============================================================ */
const FIREBASE_PRIMARY = {
  apiKey: "AIzaSyBLc2W7w4F0XSnsNlHbmlaSyM982Ha2bhM",
  authDomain: "the-amazing-digital-fanbase.firebaseapp.com",
  databaseURL: "https://the-amazing-digital-fanbase-default-rtdb.firebaseio.com",
  projectId: "the-amazing-digital-fanbase",
  storageBucket: "the-amazing-digital-fanbase.storage.app",
  messagingSenderId: "899632202736",
  appId: "1:899632202736:web:3b6de3d2e312bd6d6b5335"
};

const FIREBASE_BACKUP = {
  apiKey: "AIzaSyDrhgWrgdhGb4z3w91bOXDb-LWlLYDEw7A",
  authDomain: "mass-control.firebaseapp.com",
  databaseURL: "https://mass-control-default-rtdb.firebaseio.com",
  projectId: "mass-control",
  storageBucket: "mass-control.firebasestorage.app",
  messagingSenderId: "946293545012",
  appId: "1:946293545012:web:2da37c440910d239dc5261"
};

/* ============================================================
   SUPABASE — primary + backup
   ============================================================ */
const SUPABASE_PRIMARY = {
  url: 'https://finuvmxyymhfvmscmgac.supabase.co',
  key: 'sb_publishable_UAbpVV0jSe2h6aPkbYEgtw_kWzaT7qt'
};
const SUPABASE_BACKUP = {
  url: 'https://xyxpppfvxlmhhhzgxhoz.supabase.co',
  key: 'sb_publishable_k8tOw0gS2vAmGygtu8nMMw_FhUXSd_I'
};

const MAX_LONG_BYTES   = 50 * 1024 * 1024;
const MAX_MINI_BYTES   = 8  * 1024 * 1024;
const MAX_LONG_SECONDS = 8 * 60;
const MAX_MINI_SECONDS = 60;
const MAX_EXTRA_CHANNELS = 5;

let supaPrimary = null;
let supaBackup  = null;
try {
  supaPrimary = createClient(SUPABASE_PRIMARY.url, SUPABASE_PRIMARY.key, { auth: { persistSession: false } });
} catch (e) { console.warn('[main.js] Supabase primary failed:', e); }
try {
  supaBackup = createClient(SUPABASE_BACKUP.url, SUPABASE_BACKUP.key, { auth: { persistSession: false } });
} catch (e) { console.warn('[main.js] Supabase backup failed:', e); }

/* ============================================================
   PIXLECT AUTH
   ============================================================ */
const PIXLECT = {
  AUTH_URL: 'http://www.account.pixlect-studios.com/?app=PixelTube&mode=popup',
  ORIGIN:   'http://www.account.pixlect-studios.com',
  APP:      'PixelTube',
  user:     null
};

try {
  const raw = localStorage.getItem('pixeltube_pixlect');
  if (raw) PIXLECT.user = JSON.parse(raw);
} catch (_) {}

/* ============================================================
   ADMINS
   ============================================================ */
const ADMIN_USERNAMES = ['admin14', 'DASHORTSGOD', 'aaraiz.adnan2020'];
const ADMIN_UIDS      = ['dSs1Y55uKrcCeaXYLOqI2yco4HL2'];
function isAdmin() {
  if (!PIXLECT.user) return false;
  return ADMIN_USERNAMES.includes(PIXLECT.user.username)
      || ADMIN_UIDS.includes(PIXLECT.user.uid);
}

function getLocalUid() {
  let u = localStorage.getItem('pixeltube_uid');
  if (!u) {
    u = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem('pixeltube_uid', u);
  }
  return u;
}

function pixlectSignIn() {
  const w = 520, h = 640;
  const left = (screen.width - w) / 2;
  const top  = (screen.height - h) / 2;
  window.open(PIXLECT.AUTH_URL, 'pixlect-auth',
    `width=${w},height=${h},left=${left},top=${top},popup=yes,resizable=yes,scrollbars=yes`);
}

function pixlectSignOut() {
  PIXLECT.user = null;
  localStorage.removeItem('pixeltube_pixlect');
  state.uid = getLocalUid();
  state.activeChannelId = null;
  state.myChannelIds = [];
  reloadUserScopedData();
  renderTopbar();
  renderSidebar();
  render(true);
  toast('Signed out');
}

function handlePixlectMessage(d) {
  if (!d || typeof d !== 'object') return false;
  let user = null;
  if (d.type === 'PIXLECT_AUTH' && d.app === PIXLECT.APP && d.status === 'success' && d.user) user = d.user;
  else if (d.source === 'pixlect' && d.user) user = d.user;
  else if (d.username && (d.uid || d.id)) user = { username: d.username, uid: d.uid || d.id, icon: d.icon };
  else if (d.payload && d.payload.user) user = d.payload.user;
  if (!user) return false;

  const clean = {
    username: String(user.username || user.name || 'user'),
    uid:      String(user.uid || user.id || ''),
    icon:     user.icon || { bg: '#38bdf8', emoji: '👤' }
  };
  if (!clean.uid) return false;

  PIXLECT.user = clean;
  localStorage.setItem('pixeltube_pixlect', JSON.stringify(clean));
  state.uid = 'pl_' + clean.uid;

  reloadUserScopedData();
  ensurePrimaryChannel().then(() => {
    renderTopbar();
    renderSidebar();
    render(true);
  });
  toast('Signed in as ' + clean.username + (isAdmin() ? ' (admin)' : ''));
  return true;
}

window.addEventListener('message', (ev) => {
  const ok =
    ev.origin === 'http://www.account.pixlect-studios.com' ||
    ev.origin === 'https://www.account.pixlect-studios.com' ||
    ev.origin === 'http://account.pixlect-studios.com' ||
    ev.origin === 'https://account.pixlect-studios.com';
  if (!ok) return;
  handlePixlectMessage(ev.data);
});

/* ============================================================
   STATE
   ============================================================ */
const state = {
  uid: PIXLECT.user ? ('pl_' + PIXLECT.user.uid) : getLocalUid(),
  mode: 'connecting',
  videos: {}, channels: {}, playlists: {}, subs: {}, likes: {}, dislikes: {},
  users: {}, reports: {},
  search: '', route: ['home'],
  viewedThisSession: new Set(),
  myChannelIds: [],
  activeChannelId: null
};

let db = null;
let dbBackup = null;
let localDB = null;
let lastData = null;
let commentsUnsub = null;

/* ============================================================
   DERIVED HELPERS
   ============================================================ */
const subsOf = cid => {
  const ch = state.channels[cid];
  if (!ch) return 0;
  const n = Number(ch.subs);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};
const likesOf    = vid => (state.videos[vid]?.likes) || 0;
const dislikesOf = vid => (state.videos[vid]?.dislikes) || 0;
const viewsOf    = vid => (state.videos[vid]?.views) || 0;
const isSubbed   = cid => !!state.subs[cid];
const isLiked    = vid => !!state.likes[vid];
const isDisliked = vid => !!state.dislikes[vid];
const chanOf     = vid => state.channels[state.videos[vid]?.channelId] || { name: 'Unknown', color: '#555' };

function videosSorted() {
  return Object.values(state.videos).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}
const minisSorted = () => videosSorted().filter(v => v.kind === 'mini');
const longsSorted = () => videosSorted().filter(v => v.kind !== 'mini');

/* ============================================================
   UI UTIL
   ============================================================ */
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

function setLoaderStatus(msg) {
  const s = document.getElementById('loaderStatus');
  if (s) s.textContent = msg;
}
function hideLoader() {
  const l = document.getElementById('loader');
  if (l) l.classList.add('hide');
}

function openModal(html) {
  const root = $('#modalRoot');
  if (!root) return;
  root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal-wrap"><div class="modal">${html}</div></div></div>`;
}
function closeModal() {
  const root = $('#modalRoot');
  if (root) root.innerHTML = '';
}
document.addEventListener('click', (e) => {
  if (e.target.matches('[data-modal-backdrop]')) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeModal();
});

/* ============================================================
   STORAGE ALERT
   ============================================================ */
function showStorageAlert(message) {
  if (document.getElementById('storageAlert')) return;
  if (sessionStorage.getItem('pixeltube_alert_dismissed') === '1') return;
  const bar = document.createElement('div');
  bar.id = 'storageAlert';
  bar.innerHTML = `
    <span style="font-size:16px">⚠️</span>
    <span style="flex:1">${esc(message)}</span>
    <button id="storageAlertClose" type="button" style="background:rgba(0,0,0,.15);color:#0a0e1a;padding:4px 12px;border-radius:99px;font-weight:800;font-size:12px">Dismiss</button>
  `;
  document.body.appendChild(bar);
  document.getElementById('storageAlertClose').onclick = () => {
    sessionStorage.setItem('pixeltube_alert_dismissed', '1');
    bar.remove();
  };
}

/* ============================================================
   CHANNEL HELPERS
   ============================================================ */
const primaryChannelId = () => PIXLECT.user ? ('pl_' + PIXLECT.user.uid) : null;

function myChannels() {
  return state.myChannelIds.map(id => state.channels[id]).filter(Boolean);
}
function myChannel() {
  if (state.activeChannelId && state.channels[state.activeChannelId]) {
    return state.channels[state.activeChannelId];
  }
  const p = primaryChannelId();
  return p && state.channels[p] ? state.channels[p] : null;
}
const myChannelId = () => myChannel()?.id || null;
const hasChannel = () => myChannels().length > 0;

function extraChannelCount() {
  const p = primaryChannelId();
  return state.myChannelIds.filter(id => id !== p).length;
}
function canCreateExtra() {
  return extraChannelCount() < MAX_EXTRA_CHANNELS;
}

async function ensurePrimaryChannel() {
  if (!PIXLECT.user) return;
  const p = primaryChannelId();
  if (!state.channels[p]) {
    await saveChannel(p, {
      name: PIXLECT.user.username,
      handle: '@' + PIXLECT.user.username,
      color: PIXLECT.user.icon?.bg || '#38bdf8',
      avatar: '',
      banner: ''
    });
  }
  await addChannelToIndex(p);
  if (!state.activeChannelId) await setActiveChannel(p);
}

async function addChannelToIndex(cid) {
  if (!PIXLECT.user) return;
  if (state.mode === 'firebase' && db) {
    try { await set(ref(db, `pixeltube/users/${state.uid}/channels/${cid}`), true); }
    catch (e) { console.warn('[main.js] addChannelToIndex failed', e); }
  } else if (state.mode === 'local' && localDB) {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    u.channels = u.channels || {};
    u.channels[cid] = true;
    persistLocal();
    applyData(localDB);
  }
}

async function setActiveChannel(cid) {
  state.activeChannelId = cid;
  if (state.mode === 'firebase' && db) {
    try { await set(ref(db, `pixeltube/users/${state.uid}/activeChannel`), cid); }
    catch (e) { console.warn('[main.js] setActiveChannel failed', e); }
  } else if (state.mode === 'local' && localDB) {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    u.activeChannel = cid;
    persistLocal();
  }
}

async function saveChannel(cid, data) {
  const existing = state.channels[cid] || {};
  const ch = {
    id: cid,
    name: data.name || existing.name || PIXLECT.user.username,
    handle: data.handle || existing.handle || ('@' + PIXLECT.user.username),
    color: data.color || existing.color || (PIXLECT.user.icon?.bg || '#38bdf8'),
    avatar: data.avatar !== undefined ? data.avatar : (existing.avatar || ''),
    banner: data.banner !== undefined ? data.banner : (existing.banner || ''),
    subs: Number.isFinite(Number(existing.subs)) ? Number(existing.subs) : 0,
    ownerUid: PIXLECT.user.uid,
    ownerUsername: PIXLECT.user.username,
    createdAt: existing.createdAt || Date.now()
  };
  if (state.mode === 'firebase' && db) {
    try { await set(ref(db, `pixeltube/channels/${cid}`), ch); }
    catch (e) { toast('Could not save channel: ' + (e?.message || e)); throw e; }
  } else if (state.mode === 'local' && localDB) {
    localDB.channels[cid] = ch;
    persistLocal();
    applyData(localDB);
  }
}

async function createExtraChannel(data) {
  if (!PIXLECT.user) { toast('Sign in to create channels'); pixlectSignIn(); return null; }
  if (!canCreateExtra()) {
    toast(`You've reached the limit of ${MAX_EXTRA_CHANNELS} extra channels.`);
    return null;
  }
  const cid = 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  await saveChannel(cid, data);
  await addChannelToIndex(cid);
  await setActiveChannel(cid);
  renderTopbar();
  renderSidebar();
  render(true);
  toast('Channel created 🎉');
  return cid;
}

async function deleteChannel(cid) {
  if (!PIXLECT.user) return false;
  if (cid === primaryChannelId()) { toast('Your primary channel can\'t be deleted.'); return false; }
  const videos = Object.values(state.videos).filter(v => v.channelId === cid);
  if (videos.length) {
    toast(`This channel has ${videos.length} video${videos.length === 1 ? '' : 's'}. Delete or move them first.`);
    return false;
  }
  if (state.mode === 'firebase' && db) {
    try {
      await remove(ref(db, `pixeltube/channels/${cid}`));
      await remove(ref(db, `pixeltube/users/${state.uid}/channels/${cid}`));
      if (state.activeChannelId === cid) {
        const p = primaryChannelId();
        if (p && state.channels[p]) await setActiveChannel(p);
      }
    } catch (e) { toast('Could not delete channel'); return false; }
  } else if (state.mode === 'local' && localDB) {
    delete localDB.channels[cid];
    if (localDB.users[state.uid]?.channels) delete localDB.users[state.uid].channels[cid];
    if (state.activeChannelId === cid) state.activeChannelId = primaryChannelId();
    persistLocal();
    applyData(localDB);
  }
  toast('Channel deleted');
  return true;
}

/* ============================================================
   DATA LAYER
   ============================================================ */
async function boot() {
  setLoaderStatus('Connecting to Firebase…');
  try {
    const app = initializeApp(FIREBASE_PRIMARY, 'primary');
    db = getDatabase(app);
    try {
      const app2 = initializeApp(FIREBASE_BACKUP, 'backup');
      dbBackup = getDatabase(app2);
    } catch (e) { console.warn('[main.js] Backup Firebase init failed:', e); }

    state.mode = 'firebase';

    await new Promise((resolve) => {
      let done = false;
      const rootRef = ref(db, 'pixeltube');
      onValue(rootRef,
        s => {
          applyData(s.val() || {});
          if (!done) { done = true; setLoaderStatus('Loaded.'); setTimeout(hideLoader, 250); resolve(); }
        },
        err => {
          console.warn('[main.js] stream error:', err);
          if (!done) { done = true; setLoaderStatus('Using offline mode…'); setTimeout(() => { bootLocal(); hideLoader(); }, 400); resolve(); }
        }
      );
      setTimeout(() => {
        if (!done) { done = true; setLoaderStatus('Slow connection — loading anyway…'); hideLoader(); resolve(); }
      }, 6000);
    });

    setStatus();
    if (PIXLECT.user) {
      await migrateUserChannels();
      await ensurePrimaryChannel();
    }
  } catch (e) {
    console.warn('[main.js] Firebase unavailable → local mode.', e);
    setLoaderStatus('Offline mode.');
    bootLocal();
    setTimeout(hideLoader, 400);
  }
}

function bootLocal() {
  state.mode = 'local';
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem('pixeltube_db') || 'null'); } catch (_) {}
  if (!raw) raw = { channels: {}, videos: {}, videoSrc: {}, users: {}, comments: {}, playlists: {}, reports: {} };
  localDB = raw;
  applyData(localDB);
  setStatus();
  hideLoader();
  if (PIXLECT.user) ensurePrimaryChannel();
}

function persistLocal() {
  try { localStorage.setItem('pixeltube_db', JSON.stringify(localDB)); } catch (_) {}
}

function applyData(d) {
  lastData = d;
  state.videos    = d.videos    || {};
  state.channels  = d.channels  || {};
  state.playlists = d.playlists || {};
  state.users     = d.users     || {};
  state.reports   = d.reports   || {};

  const u = (d.users && d.users[state.uid]) || {};
  state.subs     = u.subs     || {};
  state.likes    = u.likes    || {};
  state.dislikes = u.dislikes || {};

  const idx = u.channels || {};
  const ids = Object.keys(idx);
  const p = primaryChannelId();
  if (p && state.channels[p] && !ids.includes(p)) ids.unshift(p);
  state.myChannelIds = ids;

  const storedActive = u.activeChannel;
  if (storedActive && ids.includes(storedActive)) state.activeChannelId = storedActive;
  else if (p && ids.includes(p)) state.activeChannelId = p;
  else state.activeChannelId = ids[0] || null;

  renderSidebar();
  render();
}

async function migrateUserChannels() {
  if (!PIXLECT.user) return;
  const uid = state.uid;
  const p = primaryChannelId();
  if (!state.channels[p]) return;
  const u = state.users[uid] || {};
  const idx = u.channels || {};
  if (idx[p]) return;
  await addChannelToIndex(p);
  if (!u.activeChannel) await setActiveChannel(p);
}

function reloadUserScopedData() {
  if (state.mode === 'local' && localDB) applyData(localDB);
  else if (lastData) applyData(lastData);
}

function setStatus() {
  const p = $('#statusPill');
  if (!p) return;
  if (state.mode === 'firebase') { p.textContent = 'Realtime DB'; p.className = 'status-pill live'; }
  else if (state.mode === 'local') { p.textContent = 'Local mode'; p.className = 'status-pill local'; }
  else { p.textContent = 'connecting'; p.className = 'status-pill'; }
}

/* ============================================================
   ACTIONS
   ============================================================ */
async function toggleSub(cid) {
  if (!cid) return;
  if (!PIXLECT.user) { toast('Sign in with PIXLECT to subscribe'); pixlectSignIn(); return; }
  const on = isSubbed(cid), delta = on ? -1 : 1;
  if (state.mode === 'firebase') {
    try {
      const p = `pixeltube/users/${state.uid}/subs/${cid}`;
      if (on) await remove(ref(db, p)); else await set(ref(db, p), true);
      await runTransaction(ref(db, `pixeltube/channels/${cid}/subs`),
        n => Math.max(0, (Number(n) || 0) + delta));
      toast(on ? 'Unsubscribed' : 'Subscribed 🔔');
    } catch (e) { toast('Could not update subscription'); }
  } else {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    const s = u.subs || (u.subs = {});
    if (on) delete s[cid]; else s[cid] = true;
    const ch = localDB.channels[cid];
    if (ch) ch.subs = Math.max(0, (Number(ch.subs) || 0) + delta);
    persistLocal();
    applyData(localDB);
  }
}

async function toggleLike(vid) {
  if (!vid) return;
  if (!PIXLECT.user) { toast('Sign in with PIXLECT to like'); pixlectSignIn(); return; }
  const on = isLiked(vid), delta = on ? -1 : 1;
  const wasDisliked = isDisliked(vid);

  if (state.mode === 'firebase') {
    try {
      const pLike    = `pixeltube/users/${state.uid}/likes/${vid}`;
      const pDislike = `pixeltube/users/${state.uid}/dislikes/${vid}`;
      if (on) await remove(ref(db, pLike)); else await set(ref(db, pLike), true);
      await runTransaction(ref(db, `pixeltube/videos/${vid}/likes`),
        n => Math.max(0, (Number(n) || 0) + delta));
      if (wasDisliked && !on) {
        await remove(ref(db, pDislike));
        await runTransaction(ref(db, `pixeltube/videos/${vid}/dislikes`),
          n => Math.max(0, (Number(n) || 0) - 1));
      }
    } catch (e) { toast('Could not update like'); }
  } else {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    const l = u.likes || (u.likes = {});
    const d = u.dislikes || (u.dislikes = {});
    if (on) delete l[vid]; else l[vid] = true;
    const v = localDB.videos[vid];
    if (v) {
      v.likes = Math.max(0, (Number(v.likes) || 0) + delta);
      if (wasDisliked && !on) { delete d[vid]; v.dislikes = Math.max(0, (Number(v.dislikes) || 0) - 1); }
    }
    persistLocal();
    applyData(localDB);
  }
}

async function toggleDislike(vid) {
  if (!vid) return;
  if (!PIXLECT.user) { toast('Sign in with PIXLECT to dislike'); pixlectSignIn(); return; }
  const on = isDisliked(vid), delta = on ? -1 : 1;
  const wasLiked = isLiked(vid);

  if (state.mode === 'firebase') {
    try {
      const pLike    = `pixeltube/users/${state.uid}/likes/${vid}`;
      const pDislike = `pixeltube/users/${state.uid}/dislikes/${vid}`;
      if (on) await remove(ref(db, pDislike)); else await set(ref(db, pDislike), true);
      await runTransaction(ref(db, `pixeltube/videos/${vid}/dislikes`),
        n => Math.max(0, (Number(n) || 0) + delta));
      if (wasLiked && !on) {
        await remove(ref(db, pLike));
        await runTransaction(ref(db, `pixeltube/videos/${vid}/likes`),
          n => Math.max(0, (Number(n) || 0) - 1));
      }
    } catch (e) { toast('Could not update dislike'); }
  } else {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    const l = u.likes || (u.likes = {});
    const d = u.dislikes || (u.dislikes = {});
    if (on) delete d[vid]; else d[vid] = true;
    const v = localDB.videos[vid];
    if (v) {
      v.dislikes = Math.max(0, (Number(v.dislikes) || 0) + delta);
      if (wasLiked && !on) { delete l[vid]; v.likes = Math.max(0, (Number(v.likes) || 0) - 1); }
    }
    persistLocal();
    applyData(localDB);
  }
}

async function registerView(vid) {
  if (!vid || state.viewedThisSession.has(vid)) return;
  state.viewedThisSession.add(vid);
  if (state.mode === 'firebase' && db) {
    try { await runTransaction(ref(db, `pixeltube/videos/${vid}/views`), n => (Number(n) || 0) + 1); }
    catch (e) { /* ignore */ }
  } else if (state.mode === 'local' && localDB) {
    const v = localDB.videos[vid];
    if (v) { v.views = (Number(v.views) || 0) + 1; persistLocal(); applyData(localDB); }
  }
}

/* ============================================================
   VIDEO SOURCE — wrappers around storage.js
   ============================================================ */
async function hydrateVideosInView(root) {
  const vids = $$('video[data-vid]', root || document);
  await Promise.all(vids.map(async (v) => {
    const vid = v.dataset.vid;
    if (v.dataset.hydrated === '1') return;
    v.dataset.hydrated = '1';
    try {
      const url = await storage.resolvePlaybackUrl(CTX, vid);
      if (url) {
        v.src = url;
        const loading = v.parentElement.querySelector('.loading');
        if (loading) loading.remove();
      } else {
        const loading = v.parentElement.querySelector('.loading');
        if (loading) loading.textContent = 'Video source unavailable';
        v.remove();
      }
    } catch (e) {
      console.warn('[main.js] hydrate failed for', vid, e);
      const loading = v.parentElement.querySelector('.loading');
      if (loading) loading.textContent = 'Video source unavailable';
      v.remove();
    }
  }));
}

/* ============================================================
   CREATE VIDEO — includes suspension + moderation checks
   ============================================================ */
async function createVideo(payload) {
  if (!PIXLECT.user) { toast('Sign in to upload'); pixlectSignIn(); return null; }

  /* Block suspended users */
  const block = canCurrentUserUpload(CTX);
  if (block) {
    if (block.reason === 'suspended') {
      toast('Your account is suspended: ' + (block.info?.reason || 'Violation of guidelines'));
    } else {
      toast('You can\'t upload right now');
    }
    return null;
  }

  const ch = myChannel();
  if (!ch) { promptCreateChannel(CTX); return null; }

  const cid = ch.id;
  const vid = 'v_' + Math.random().toString(36).slice(2, 10);
  const kind = payload.kind === 'mini' ? 'mini' : 'long';

  let storedSrc = '';
  let srcBackend = 'url';

  try {
    if (payload.file) {
      const result = await storage.uploadVideo(CTX, payload.file, vid, kind);
      storedSrc = result.storedSrc;
      srcBackend = result.srcBackend;
    } else if (payload.src) {
      const result = storage.uploadFromUrl(payload.src);
      storedSrc = result.storedSrc;
      srcBackend = result.srcBackend;
    } else {
      toast('No video source provided');
      return null;
    }
  } catch (e) {
    console.error('[main.js] upload failed:', e);
    toast('Upload failed: ' + (e?.message || e));
    return null;
  }

  const meta = {
    id: vid,
    title: payload.title,
    channelId: cid,
    kind,
    thumb: payload.thumb || '',
    dur: payload.dur || '0:00',
    views: 0,
    likes: 0,
    dislikes: 0,
    desc: payload.desc || '',
    createdAt: Date.now(),
    createdBy: PIXLECT.user.uid,
    srcBackend
  };

  if (state.mode === 'firebase') {
    try {
      await set(ref(db, `pixeltube/videos/${vid}`), meta);
      if (srcBackend !== 'firebase' && srcBackend !== 'firebase-backup') {
        await set(ref(db, `pixeltube/videoSrc/${vid}`), storedSrc);
      }
      return vid;
    } catch (e) {
      toast('Publish failed: ' + (e?.message || e));
      try { await remove(ref(db, `pixeltube/videos/${vid}`)); } catch (_) {}
      return null;
    }
  } else {
    localDB.videos[vid] = meta;
    localDB.videoSrc = localDB.videoSrc || {};
    localDB.videoSrc[vid] = storedSrc;
    persistLocal();
    applyData(localDB);
    return vid;
  }
}

async function deleteVideo(vid) {
  const v = state.videos[vid];
  if (!v) return;
  const isMine = PIXLECT.user && v.createdBy === PIXLECT.user.uid;
  if (!isMine && !isAdmin()) { toast('You don\'t have permission to delete this'); return; }
  if (state.mode === 'firebase' && db) {
    try {
      await storage.deleteVideoSource(CTX, vid);
      await remove(ref(db, `pixeltube/videos/${vid}`));
    } catch (e) { toast('Could not delete'); }
  } else if (localDB) {
    delete localDB.videos[vid];
    if (localDB.videoSrc) delete localDB.videoSrc[vid];
    persistLocal();
    applyData(localDB);
  }
}

/* ============================================================
   COMMENTS
   ============================================================ */
async function addComment(vid, text) {
  if (!PIXLECT.user) { toast('Sign in to comment'); pixlectSignIn(); return; }
  const cid = 'c_' + Math.random().toString(36).slice(2, 10);
  const comment = {
    uid: PIXLECT.user.uid,
    username: PIXLECT.user.username,
    icon: PIXLECT.user.icon || { bg: '#38bdf8', emoji: '👤' },
    text, ts: Date.now()
  };
  if (state.mode === 'firebase') {
    try { await set(ref(db, `pixeltube/comments/${vid}/${cid}`), comment); }
    catch (e) { toast('Could not post comment'); }
  } else {
    const c = localDB.comments || (localDB.comments = {});
    const v = c[vid] || (c[vid] = {});
    v[cid] = comment;
    persistLocal();
    renderComments(vid, v);
  }
}

function subscribeComments(vid) {
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  const target = document.getElementById('commentList');
  if (!target) return;
  if (state.mode === 'firebase' && db) {
    commentsUnsub = onValue(ref(db, `pixeltube/comments/${vid}`),
      s => renderComments(vid, s.val() || {}),
      err => console.warn('comments error', err));
  } else if (localDB) {
    renderComments(vid, (localDB.comments && localDB.comments[vid]) || {});
  }
}

function renderComments(vid, map) {
  const target = document.getElementById('commentList');
  if (!target) return;
  const list = Object.values(map).sort((a, b) => (b.ts || 0) - (a.ts || 0));
  if (!list.length) { target.innerHTML = `<div class="no-comments">No comments yet. Be the first!</div>`; return; }
  target.innerHTML = list.map(c => `
    <div class="comment">
      ${c.icon?.avatar
        ? `<span class="pic"><img src="${esc(c.icon.avatar)}" alt=""></span>`
        : `<span class="pic" style="background:${esc(c.icon?.bg || '#38bdf8')}">${esc(c.icon?.emoji || '👤')}</span>`}
      <div class="body">
        <div class="meta"><b>${esc(c.username || 'user')}</b><span>${esc(timeAgo(c.ts || Date.now()))}</span></div>
        <div class="text">${esc(c.text)}</div>
      </div>
    </div>`).join('');
}

/* ============================================================
   PLAYLISTS
   ============================================================ */
function playlistsOfUser() {
  const out = [];
  for (const pl of Object.values(state.playlists)) {
    if (pl.ownerUid === PIXLECT.user?.uid) out.push(pl);
  }
  return out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

async function createPlaylist(name) {
  if (!PIXLECT.user) { toast('Sign in to create playlists'); pixlectSignIn(); return null; }
  const pid = 'pl_' + Math.random().toString(36).slice(2, 10);
  const pl = {
    id: pid, name: name.trim().slice(0, 80) || 'Untitled playlist',
    ownerUid: PIXLECT.user.uid, ownerName: PIXLECT.user.username,
    videoIds: {}, createdAt: Date.now()
  };
  if (state.mode === 'firebase' && db) {
    try { await set(ref(db, `pixeltube/playlists/${pid}`), pl); return pid; }
    catch (e) { toast('Could not create playlist'); return null; }
  } else if (localDB) {
    localDB.playlists = localDB.playlists || {};
    localDB.playlists[pid] = pl;
    persistLocal(); applyData(localDB);
    return pid;
  }
  return null;
}

async function deletePlaylist(pid) {
  if (state.mode === 'firebase' && db) {
    try { await remove(ref(db, `pixeltube/playlists/${pid}`)); } catch (_) {}
  } else if (localDB) {
    delete localDB.playlists[pid]; persistLocal(); applyData(localDB);
  }
}

async function addToPlaylist(pid, vid) {
  if (state.mode === 'firebase' && db) {
    try { await set(ref(db, `pixeltube/playlists/${pid}/videoIds/${vid}`), true); }
    catch (e) { toast('Could not add to playlist'); }
  } else if (localDB) {
    localDB.playlists[pid].videoIds = localDB.playlists[pid].videoIds || {};
    localDB.playlists[pid].videoIds[vid] = true;
    persistLocal(); applyData(localDB);
  }
}

async function removeFromPlaylist(pid, vid) {
  if (state.mode === 'firebase' && db) {
    try { await remove(ref(db, `pixeltube/playlists/${pid}/videoIds/${vid}`)); } catch (_) {}
  } else if (localDB) {
    if (localDB.playlists[pid].videoIds) delete localDB.playlists[pid].videoIds[vid];
    persistLocal(); applyData(localDB);
  }
}

function playlistVideos(pid) {
  const pl = state.playlists[pid];
  if (!pl) return [];
  return Object.keys(pl.videoIds || {}).map(id => state.videos[id]).filter(Boolean);
}

/* ============================================================
   CTX
   ============================================================ */
const CTX = {
  state, PIXLECT, isAdmin,
  get db()      { return db; },
  get dbBackup() { return dbBackup; },
  get localDB() { return localDB; },
  get supa()    { return supaPrimary; },
  SUPABASE_BUCKET: 'PIXELTUBE_VIDEOS',

  subsOf, likesOf, dislikesOf, viewsOf, isSubbed, isLiked, isDisliked, chanOf,
  videosSorted, minisSorted, longsSorted,

  myChannelId, myChannel, hasChannel, myChannels, primaryChannelId,
  createExtraChannel, deleteChannel, setActiveChannel, saveChannel, addChannelToIndex,
  extraChannelCount, canCreateExtra, MAX_EXTRA_CHANNELS,

  toggleSub, toggleLike, toggleDislike, registerView, createVideo, deleteVideo,
  addComment,
  createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
  playlistsOfUser, playlistVideos,

  pixlectSignIn, toast, openModal, closeModal,
  renderTopbar, renderSidebar, render,
  persistLocal, applyData, remove, ref, get, set, update,

  hydrateVideosInView,

  /* security.js needs these */
  reportVideo: (...args) => import('./security.js').then(m => m.reportVideo(CTX, ...args)),
  promptReportVideo: (...args) => import('./security.js').then(m => m.promptReportVideo(CTX, ...args)),

  get route() { return state.route; }
};

window.__CTX = CTX;
window.__PIXLECT = PIXLECT;
window.__state = state;
window.__isAdmin = isAdmin;

/* ============================================================
   CARD BUILDERS
   ============================================================ */
function cardHTML(v) {
  const c = chanOf(v.id);
  return `
  <a class="card" href="#/watch/${esc(v.id)}">
    <div class="thumb">
      ${thumbHTML(v)}
      <span class="dur">${esc(v.dur)}</span>
    </div>
    <div class="info">
      ${avatarHTML(c)}
      <div style="min-width:0">
        <h3>${esc(v.title)}</h3>
        <div class="sub">${esc(c.name)}</div>
        <div class="sub">${fmt(v.views)} views · ${esc(timeAgo(v.createdAt))}</div>
      </div>
    </div>
  </a>`;
}

function shortCardHTML(v) {
  const c = chanOf(v.id);
  return `
  <a class="short-card" href="#/mini/${esc(v.id)}">
    <div class="t">
      ${thumbHTML(v)}
      <span class="badge">MINI</span>
      <span class="views">
        <svg viewBox="0 0 24 24"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>
        ${fmt(v.views)}
      </span>
    </div>
    <h3>${esc(v.title)}</h3>
    <div class="sub">${esc(c.name)}</div>
  </a>`;
}

function emptyState(icon, title, text, cta) {
  return `<div class="empty">
    <div class="big">${icon}</div>
    <h2>${esc(title)}</h2>
    <p>${text}</p>
    ${cta || ''}
  </div>`;
}

CTX.cardHTML = cardHTML;
CTX.shortCardHTML = shortCardHTML;
CTX.emptyState = emptyState;

/* ============================================================
   TOPBAR
   ============================================================ */
function renderTopbar() {
  const slot = $('#authSlot');
  if (!slot) return;

  if (!PIXLECT.user) {
    slot.innerHTML = `
      <button class="signin-btn" id="pixlectSignIn" title="Sign in with PIXLECT" type="button">
        <svg class="pix" viewBox="0 0 24 24"><path d="M12 2 2 7v10l10 5 10-5V7zm0 2.3 7.5 3.7L12 11.7 4.5 8zM4 9.7l7.5 3.8v7.2L4 16.9zm16 0v7.2l-7.5 3.8v-7.2z"/></svg>
        Sign in
      </button>`;
    $('#pixlectSignIn').onclick = pixlectSignIn;
    return;
  }

  const u = PIXLECT.user;
  const ch = myChannel();
  const displayName = ch ? ch.name : u.username;
  const avHTML = ch && ch.avatar
    ? `<span class="pic"><img src="${esc(ch.avatar)}" alt=""></span>`
    : ch
      ? `<span class="pic" style="background:${esc(ch.color || '#38bdf8')}">${esc(initial(ch.name))}</span>`
      : `<span class="pic" style="background:${esc(u.icon?.bg || '#38bdf8')}">${esc(u.icon?.emoji || '👤')}</span>`;

  const channels = myChannels();
  const hasMulti = channels.length > 1;

  const channelListHTML = channels.length > 1 ? `
    <div class="sep"></div>
    <div style="padding:6px 12px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);font-weight:800">
      Your channels
    </div>
    ${channels.map(c => `
      <button data-action="switch-channel" data-cid="${esc(c.id)}" type="button"
              style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border-radius:9px;font-size:13px;font-weight:600;color:var(--text);${c.id === ch?.id ? 'background:var(--surface2)' : ''}">
        ${c.avatar
          ? `<span style="width:22px;height:22px;border-radius:50%;overflow:hidden;flex:none"><img src="${esc(c.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
          : `<span style="width:22px;height:22px;border-radius:50%;background:${esc(c.color || '#38bdf8')};display:grid;place-items:center;font-size:11px;color:#0a0e1a;font-weight:900;flex:none">${esc(initial(c.name))}</span>`}
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</span>
        ${c.id === ch?.id ? '<span style="color:var(--accent);font-size:11px;font-weight:800">✓</span>' : ''}
      </button>
    `).join('')}
    ${canCreateExtra()
      ? `<button id="menuAddChannel" type="button" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border-radius:9px;font-size:13px;font-weight:600;color:var(--accent)">
           <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>
           Add a channel (${extraChannelCount()}/${MAX_EXTRA_CHANNELS})
         </button>`
      : `<div style="padding:9px 12px;font-size:12px;color:var(--muted)">
           ${MAX_EXTRA_CHANNELS} extra channels — limit reached.
         </div>`}
  ` : '';

  const channelBlock = ch
    ? `<button id="menuEditChannel" type="button">
         <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
         Edit "${esc(ch.name)}"
       </button>
       <a href="#/channel/${esc(ch.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600" id="menuViewChannel">
         <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" opacity="0.8"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>
         View this channel
       </a>`
    : `<button id="menuCreateChannel" type="button">
         <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>
         Create PIXELChannel
       </button>`;

  const adminBadge = isAdmin() ? `
    <div style="display:flex;align-items:center;gap:8px;padding:10px 12px;font-size:11.5px;color:var(--warn);font-weight:800;letter-spacing:.6px">
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M12 1l3 6 6 1-4.5 4.5L18 19l-6-3-6 3 1.5-6.5L3 8l6-1z"/></svg>
      ADMIN
    </div>` : '';

  slot.innerHTML = `
    <button class="user-chip" id="userChip" type="button">
      ${avHTML}
      <span class="nm">${esc(displayName)}</span>
    </button>
    <div class="user-menu" id="userMenu">
      <div class="head">
        ${avHTML}
        <div style="min-width:0">
          <strong>${esc(displayName)}</strong>
          <small>@${esc(u.username)}${hasMulti ? ` · ${channels.length} channels` : (ch ? ' · PIXELChannel' : ' · No channel')}${isAdmin() ? ' · ADMIN' : ''}</small>
        </div>
      </div>
      ${channelBlock}
      ${channelListHTML}
      ${adminBadge}
      <div class="sep"></div>
      <button id="menuSignOut" type="button">
        <svg viewBox="0 0 24 24"><path d="M16 13v-2H7V8l-5 4 5 4v-3zM20 3h-8v2h8v14h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg>
        Sign out
      </button>
    </div>`;

  const chip = $('#userChip');
  const menu = $('#userMenu');
  if (chip && menu) chip.onclick = (e) => { e.stopPropagation(); menu.classList.toggle('open'); };

  const mc = document.getElementById('menuCreateChannel');
  if (mc) mc.onclick = () => { menu.classList.remove('open'); promptCreateChannel(CTX); };

  const me = document.getElementById('menuEditChannel');
  if (me) me.onclick = () => { menu.classList.remove('open'); promptEditChannel(CTX); };

  const mv = document.getElementById('menuViewChannel');
  if (mv) mv.onclick = () => menu.classList.remove('open');

  const ma = document.getElementById('menuAddChannel');
  if (ma) ma.onclick = () => { menu.classList.remove('open'); promptCreateExtraChannel(); };

  const so = $('#menuSignOut');
  if (so) so.onclick = () => { menu.classList.remove('open'); pixlectSignOut(); };

  document.addEventListener('click', () => menu.classList.remove('open'));
}

/* ============================================================
   CREATE EXTRA CHANNEL MODAL
   ============================================================ */
function promptCreateExtraChannel() {
  if (!PIXLECT.user) { pixlectSignIn(); return; }
  if (!canCreateExtra()) {
    toast(`You've reached the limit of ${MAX_EXTRA_CHANNELS} extra channels.`);
    return;
  }

  openModal(`
    <button class="close" type="button" onclick="document.getElementById('modalRoot').innerHTML=''">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </button>
    <h2>Add a channel</h2>
    <p class="lede">You've made <b>${extraChannelCount()}</b> of ${MAX_EXTRA_CHANNELS} extra channels.</p>

    <div class="avatar-preview">
      <div class="av" id="chAvPreview">N</div>
      <div class="meta">
        <strong>New channel</strong>
        <small>Extra channels are separate from your primary</small>
      </div>
    </div>

    <div class="field">
      <label for="chName">Channel name *</label>
      <input id="chName" type="text" maxlength="60" placeholder="e.g. Pixel Gaming" />
    </div>
    <div class="field">
      <label for="chHandle">Handle</label>
      <input id="chHandle" type="text" maxlength="30" placeholder="@pixelgaming" />
    </div>
    <div class="field">
      <label>Profile picture</label>
      <div class="source-tabs">
        <button type="button" class="source-tab active" data-chav="auto">✨ Auto</button>
        <button type="button" class="source-tab" data-chav="upload">🖼️ Upload</button>
        <button type="button" class="source-tab" data-chav="url">🔗 URL</button>
      </div>
      <div id="chAvPaneAuto"><div class="info-note">A colored circle with the first letter will be used.</div></div>
      <div id="chAvPaneUpload" style="display:none">
        <div class="dropzone" id="chAvDrop">
          <input type="file" id="chAvFile" accept="image/*" />
          <div class="dz-icon">🖼️</div>
          <div class="dz-title">Click to choose an image</div>
          <div class="dz-sub">JPG, PNG, WebP</div>
        </div>
      </div>
      <div id="chAvPaneUrl" style="display:none">
        <input id="chAvUrl" type="url" placeholder="https://example.com/avatar.jpg" />
      </div>
    </div>

    <div class="form-actions">
      <button type="button" class="btn-secondary" onclick="document.getElementById('modalRoot').innerHTML=''">Cancel</button>
      <button type="button" class="btn-primary" id="chCreateBtn">Create channel</button>
    </div>
  `);

  let chAvMode = 'auto';
  let chAvData = '';

  const avPreview = document.getElementById('chAvPreview');
  const nameInput = document.getElementById('chName');
  const handleInput = document.getElementById('chHandle');

  nameInput.addEventListener('input', () => {
    if (!handleInput.dataset.touched) {
      const slug = nameInput.value.trim().toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9._-]/g, '');
      handleInput.value = slug ? ('@' + slug) : '';
    }
  });
  handleInput.addEventListener('input', () => { handleInput.dataset.touched = '1'; });

  const updateAvPreview = () => {
    if (chAvMode === 'auto' || !chAvData) {
      avPreview.innerHTML = esc(initial(nameInput.value || 'N'));
      avPreview.style.background = 'linear-gradient(135deg,var(--accent),var(--accent2))';
    } else {
      avPreview.innerHTML = `<img src="${esc(chAvData)}" alt="">`;
    }
  };

  document.querySelectorAll('[data-chav]').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('[data-chav]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    chAvMode = t.dataset.chav;
    document.getElementById('chAvPaneAuto').style.display   = chAvMode === 'auto'   ? '' : 'none';
    document.getElementById('chAvPaneUpload').style.display = chAvMode === 'upload' ? '' : 'none';
    document.getElementById('chAvPaneUrl').style.display    = chAvMode === 'url'    ? '' : 'none';
    if (chAvMode === 'auto') chAvData = '';
    updateAvPreview();
  }));

  const drop = document.getElementById('chAvDrop');
  const file = document.getElementById('chAvFile');
  if (drop && file) {
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      chAvData = await resizeImageFile(f, 240);
      updateAvPreview();
    });
  }
  const url = document.getElementById('chAvUrl');
  if (url) url.addEventListener('input', (e) => {
    chAvData = e.target.value.trim();
    updateAvPreview();
  });

  document.getElementById('chCreateBtn').onclick = async () => {
    const name = nameInput.value.trim();
    const handle = handleInput.value.trim() || ('@' + name.toLowerCase().replace(/\s+/g, ''));
    if (!name) { toast('Channel name is required'); return; }
    const avatar = chAvMode === 'auto' ? '' : chAvData;
    const cid = await createExtraChannel({ name, handle, avatar });
    if (cid) closeModal();
  };
}

/* ============================================================
   SIDEBAR
   ============================================================ */
const ICONS = {
  feed:   '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/></svg>',
  minis:  '<svg viewBox="0 0 24 24"><path d="M13 2L4.5 13H11l-1 9L18.5 11H12z"/></svg>',
  subs:   '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/><circle cx="18" cy="16" r="3"/></svg>',
  like:   '<svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg>',
  create: '<svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z"/></svg>',
  admin:  '<svg viewBox="0 0 24 24"><path d="M12 1l3 6 6 1-4.5 4.5L18 19l-6-3-6 3 1.5-6.5L3 8l6-1z"/></svg>'
};

function renderSidebar() {
  const [page] = state.route;
  const subIds = Object.keys(state.subs);
  const likeCount = Object.keys(state.likes).length;
  const channels = myChannels();
  const active = myChannel();
  const myPls = playlistsOfUser();

  const userBlock = PIXLECT.user ? `
    <div class="side-user">
      ${active
        ? (active.avatar
            ? `<span class="pic"><img src="${esc(active.avatar)}" alt=""></span>`
            : `<span class="pic" style="background:${esc(active.color || '#38bdf8')}">${esc(initial(active.name))}</span>`)
        : `<span class="pic" style="background:${esc(PIXLECT.user.icon?.bg || '#38bdf8')}">${esc(PIXLECT.user.icon?.emoji || '👤')}</span>`}
      <div class="t">
        <strong>${esc(active ? active.name : PIXLECT.user.username)}</strong>
        <small>${active ? 'PIXELChannel' : 'No channel'}${isAdmin() ? ' · ADMIN' : ''}</small>
      </div>
    </div>
    ${channels.length > 1 ? `
      <button class="btn-secondary" style="margin:8px 4px 0;width:calc(100% - 8px);font-size:12.5px;padding:8px 12px" id="sideSwitchChannel" type="button">
        🔄 Switch channel (${channels.length})
      </button>` : ''}
    ${!active && canCreateExtra() ? `<button class="btn-primary" style="margin:8px 4px 0;width:calc(100% - 8px)" id="sideCreateChannel" type="button">Create PIXELChannel</button>` : ''}
    ${active && canCreateExtra() ? `
      <button class="btn-secondary" style="margin:8px 4px 0;width:calc(100% - 8px);font-size:12.5px;padding:8px 12px" id="sideAddChannel" type="button">
        + Add channel (${extraChannelCount()}/${MAX_EXTRA_CHANNELS})
      </button>` : ''}
  ` : `<div class="side-note">Not signed in.<br>Sign in to upload, like, and comment.</div>`;

  const sb = $('#sidebar');
  if (!sb) return;

  sb.innerHTML = `
    <a class="nav ${page === 'home' ? 'active' : ''}" href="#/">${ICONS.feed} Feed</a>
    <a class="nav ${page === 'minis' ? 'active' : ''}" href="#/minis">${ICONS.minis} Minis</a>
    <a class="nav ${page === 'subs' ? 'active' : ''}" href="#/subs">${ICONS.subs} Subscriptions <span class="count">${subIds.length || ''}</span></a>
    <a class="nav ${page === 'liked' ? 'active' : ''}" href="#/liked">${ICONS.like} Liked <span class="count">${likeCount || ''}</span></a>
    <a class="nav ${page === 'create' ? 'active' : ''}" href="#/create">${ICONS.create} Create</a>
    ${isAdmin() ? `<a class="nav ${page === 'admin' ? 'active' : ''}" href="#/admin">${ICONS.admin} Admin</a>` : ''}

    <h4>Playlists</h4>
    ${myPls.length ? myPls.map(pl => `
      <a class="pl-row" href="#/playlist/${esc(pl.id)}">
        <span class="avatar sm" style="background:linear-gradient(135deg,var(--accent),var(--accent2));color:#fff">♪</span>
        <span class="nm">${esc(pl.name)}</span>
      </a>`).join('') : ''}
    <a class="pl-row" href="#/playlists" style="color:var(--muted);font-size:13px">
      <span class="avatar sm" style="background:var(--surface2);color:var(--muted)">+</span>
      <span class="nm">${myPls.length ? 'Manage playlists' : 'Create a playlist'}</span>
    </a>

    <h4>Subscriptions</h4>
    ${subIds.length ? subIds.map(cid => {
      const c = state.channels[cid];
      if (!c) return '';
      return `<a class="sub-row" href="#/channel/${esc(cid)}">${avatarHTML(c, 'sm')}<span class="nm">${esc(c.name)}</span></a>`;
    }).join('') : `<div class="side-note">No subscriptions yet.</div>`}

    <h4>Account</h4>
    ${userBlock}
  `;

  const sc = document.getElementById('sideCreateChannel');
  if (sc) sc.onclick = () => promptCreateChannel(CTX);

  const sa = document.getElementById('sideAddChannel');
  if (sa) sa.onclick = () => promptCreateExtraChannel();

  const ss = document.getElementById('sideSwitchChannel');
  if (ss) ss.onclick = () => promptSwitchChannel();
}

/* ============================================================
   SWITCH CHANNEL MODAL
   ============================================================ */
function promptSwitchChannel() {
  const channels = myChannels();
  if (channels.length < 2) return;

  openModal(`
    <button class="close" type="button" onclick="document.getElementById('modalRoot').innerHTML=''">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </button>
    <h2>Switch channel</h2>
    <p class="lede">Pick which channel you're uploading and managing as.</p>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${channels.map(c => {
        const isActive = c.id === state.activeChannelId;
        return `<button data-action="switch-channel" data-cid="${esc(c.id)}" type="button"
                style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px;border-radius:12px;border:1px solid ${isActive ? 'var(--accent)' : 'var(--line)'};background:${isActive ? 'var(--surface2)' : 'var(--surface)'};transition:.15s;color:var(--text)">
          ${c.avatar
            ? `<span style="width:38px;height:38px;border-radius:50%;overflow:hidden;flex:none"><img src="${esc(c.avatar)}" alt="" style="width:100%;height:100%;object-fit:cover"></span>`
            : `<span style="width:38px;height:38px;border-radius:50%;background:${esc(c.color || '#38bdf8')};display:grid;place-items:center;font-weight:900;color:#0a0e1a;font-size:16px;flex:none">${esc(initial(c.name))}</span>`}
          <div style="flex:1;min-width:0">
            <strong style="display:block;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.name)}</strong>
            <small style="color:var(--muted);font-size:11.5px">${esc(c.handle || '')} · ${fmt(subsOf(c.id))} subs</small>
          </div>
          ${isActive ? '<span style="color:var(--accent);font-weight:800;font-size:12px">ACTIVE</span>' : ''}
        </button>`;
      }).join('')}
    </div>
    <div class="form-actions" style="justify-content:flex-start;gap:10px">
      ${canCreateExtra()
        ? `<button type="button" class="btn-primary" id="chSwitchAdd" style="margin-right:auto">+ New channel</button>`
        : ''}
      <button type="button" class="btn-secondary" onclick="document.getElementById('modalRoot').innerHTML=''">Close</button>
    </div>
  `);

  const addBtn = document.getElementById('chSwitchAdd');
  if (addBtn) addBtn.onclick = () => { closeModal(); promptCreateExtraChannel(); };
}

/* ============================================================
   ROUTER / RENDER
   ============================================================ */
let renderedKey = null;

function render(force = false) {
  const key = state.route.join('/');
  const isStateful = !force && key === renderedKey &&
    (state.route[0] === 'watch' || state.route[0] === 'minis' || state.route[0] === 'mini');
  if (isStateful) { syncDynamic(); return; }
  renderedKey = key;

  const view = $('#view');
  if (!view) return;
  view.classList.toggle('snap', state.route[0] === 'minis');
  view.scrollTop = 0;

  const [page, arg] = state.route;

  if      (page === 'home')      view.innerHTML = viewFeed(CTX);
  else if (page === 'minis')     { view.innerHTML = viewMinis(CTX); setupMinis(CTX); hydrateVideosInView(view); }
  else if (page === 'mini')      {
    view.innerHTML = viewMiniViewer(CTX, arg);
    setupMinis(CTX);
    hydrateVideosInView(view);
    requestAnimationFrame(() => {
      const el = document.getElementById('mini-' + arg);
      if (el) el.scrollIntoView({ block: 'start' });
    });
  }
  else if (page === 'subs')      view.innerHTML = viewSubs(CTX);
  else if (page === 'liked')     view.innerHTML = viewLiked(CTX);
  else if (page === 'create')    { view.innerHTML = viewCreate(); setupCreateForm(); }
  else if (page === 'watch')     { view.innerHTML = viewWatch(CTX, arg); subscribeComments(arg); setupCommentForm(CTX, arg); hydrateVideosInView(view); }
  else if (page === 'channel')   view.innerHTML = viewChannel(CTX, arg);
  else if (page === 'playlists') view.innerHTML = viewPlaylists(CTX);
  else if (page === 'playlist')  view.innerHTML = viewPlaylist(CTX);
  else if (page === 'admin')     view.innerHTML = viewAdmin(CTX, arg || 'reports');
  else if (page === 'terms')     view.innerHTML = viewTerms();
  else if (page === 'guidelines')view.innerHTML = viewGuidelines();
  else                           view.innerHTML = viewFeed(CTX);

  syncDynamic();
}

function syncDynamic() {
  $$('[data-dyn]').forEach(el => {
    const t = el.dataset.dyn;
    if (t === 'like') {
      const on = isLiked(el.dataset.video);
      el.classList.toggle('active', on);
      const lbl = el.querySelector('.lbl');
      if (lbl) lbl.textContent = fmt(likesOf(el.dataset.video));
    } else if (t === 'dislike') {
      const on = isDisliked(el.dataset.video);
      el.classList.toggle('active', on);
      const lbl = el.querySelector('.lbl');
      if (lbl) lbl.textContent = fmt(dislikesOf(el.dataset.video));
    } else if (t === 'sub') {
      const on = isSubbed(el.dataset.channel);
      el.classList.toggle('subbed', on);
      el.textContent = on ? 'Subscribed' : 'Subscribe';
    } else if (t === 'subcount') {
      el.textContent = fmt(subsOf(el.dataset.channel)) + ' subscribers';
    } else if (t === 'views') {
      el.textContent = fmt(viewsOf(el.dataset.video)) + ' views';
    }
  });
  renderSidebar();
}

/* ============================================================
   CREATE PAGE
   ============================================================ */
function viewCreate() {
  if (!PIXLECT.user) {
    return emptyState('🎬', 'Sign in to upload',
      'You need a PIXLECT account to publish videos on PIXELTube.',
      `<button class="btn-primary" id="createSignIn" type="button">Sign in with PIXLECT</button>`);
  }

  /* Suspended banner */
  const block = canCurrentUserUpload(CTX);
  if (block && block.reason === 'suspended') {
    const info = block.info || {};
    return emptyState('🚫', 'Your account is suspended',
      `Reason: ${esc(info.reason || 'Violation of community guidelines')}. If you believe this is a mistake, contact support.`,
      `<a class="btn-ghost" href="#/guidelines">Read Community Guidelines</a>`);
  }

  const channels = myChannels();
  if (!channels.length) {
    return emptyState('🎬', 'Create your PIXELChannel first',
      'Before uploading, you need a PIXELChannel. It takes ten seconds.',
      `<button class="btn-primary" id="createChannelBtn" type="button">Create PIXELChannel</button>`);
  }
  const ch = myChannel();
  const channelOptions = channels.map(c =>
    `<option value="${esc(c.id)}"${c.id === ch.id ? ' selected' : ''}>${esc(c.name)}</option>`
  ).join('');

  return `
    <div class="form-wrap">
      <h1>Upload to PIXELTube</h1>
      <p class="lede">Publishing to <b>${esc(ch.name)}</b>. Longs go to Backblaze B2, Shorts to Supabase. By uploading, you agree to our <a href="#/guidelines" style="color:var(--accent)">Community Guidelines</a>.</p>
      <form id="createForm" autocomplete="off">
        ${channels.length > 1 ? `
        <div class="field">
          <label for="f-channel">Publish as *</label>
          <select id="f-channel">${channelOptions}</select>
        </div>` : ''}
        <div class="field">
          <label for="f-title">Title *</label>
          <input id="f-title" type="text" maxlength="120" required placeholder="What's your video called?" />
        </div>
        <div class="field">
          <label>Video source *</label>
          <div class="source-tabs">
            <button type="button" class="source-tab active" data-source="upload">📁 Upload file</button>
            <button type="button" class="source-tab" data-source="url">🔗 Paste URL</button>
          </div>
          <div id="paneUpload">
            <div class="dropzone" id="dropzone">
              <input type="file" id="f-file" accept="video/mp4,video/webm,video/quicktime" />
              <div id="dropzoneEmpty">
                <div class="dz-icon">⬆️</div>
                <div class="dz-title">Click to choose or drop a video</div>
                <div class="dz-sub">MP4, WebM, or MOV — Longs up to 50 MB, Minis up to 8 MB</div>
              </div>
              <div id="dropzoneFile" class="dz-file" style="display:none">
                <div style="font-size:30px">🎬</div>
                <div style="min-width:0;text-align:left">
                  <div class="nm" id="dzFileName">video.mp4</div>
                  <div class="sz" id="dzFileSize">—</div>
                </div>
              </div>
              <div class="progress" id="progress" style="display:none">
                <div class="bar" id="progressBar"></div>
              </div>
              <div class="lbl" id="progressLabel" style="display:none"></div>
            </div>
            <div class="size-warn" id="sizeWarn" style="display:none"></div>
          </div>
          <div id="paneUrl" style="display:none">
            <input id="f-src" type="url" placeholder="https://example.com/video.mp4" />
          </div>
        </div>
        <div class="field">
          <label>Thumbnail</label>
          <div class="thumb-preview" id="thumbPreview">
            <div class="empty" id="thumbPreviewEmpty">No thumbnail yet — upload a video to auto‑generate one, or pick your own below.</div>
            <img id="thumbPreviewImg" style="display:none" alt="" />
            <span class="badge" id="thumbPreviewBadge" style="display:none">AUTO</span>
          </div>
          <div class="source-tabs" style="margin-top:6px">
            <button type="button" class="source-tab thumb-tab active" data-thumb="auto">✨ Auto</button>
            <button type="button" class="source-tab thumb-tab" data-thumb="upload">🖼️ Upload</button>
            <button type="button" class="source-tab thumb-tab" data-thumb="url">🔗 URL</button>
          </div>
          <div id="thumbPaneAuto"><div class="info-note" id="thumbAutoNote">Auto‑thumbnail will be captured from the video you upload.</div></div>
          <div id="thumbPaneUpload" style="display:none">
            <div class="dropzone" id="thumbDropzone">
              <input type="file" id="f-thumbfile" accept="image/*" />
              <div id="thumbDzEmpty">
                <div class="dz-icon">🖼️</div>
                <div class="dz-title">Click to choose an image</div>
                <div class="dz-sub">JPG, PNG, WebP · resized to 480px wide</div>
              </div>
              <div id="thumbDzFile" class="dz-file" style="display:none">
                <div style="font-size:30px">🖼️</div>
                <div style="min-width:0;text-align:left">
                  <div class="nm" id="thumbDzName">image.jpg</div>
                  <div class="sz" id="thumbDzSize">—</div>
                </div>
              </div>
            </div>
          </div>
          <div id="thumbPaneUrl" style="display:none">
            <input id="f-thumb" type="url" placeholder="https://example.com/thumb.jpg" />
          </div>
        </div>
        <div class="form-row">
          <div class="field">
            <label for="f-kind">Type</label>
            <select id="f-kind">
              <option value="long">Long (B2 · up to 8 min / 50 MB)</option>
              <option value="mini">Mini / Short (Supabase · up to 1 min / 8 MB)</option>
            </select>
          </div>
          <div class="field">
            <label for="f-dur">Duration</label>
            <input id="f-dur" type="text" placeholder="e.g. 4:21" value="0:00" />
          </div>
        </div>
        <div class="field">
          <label for="f-desc">Description</label>
          <textarea id="f-desc" maxlength="4000" placeholder="Tell viewers about your video…"></textarea>
        </div>
        <div class="form-actions">
          <a class="btn-secondary" href="#/">Cancel</a>
          <button type="submit" class="btn-primary" id="createSubmit">Publish</button>
        </div>
      </form>
    </div>`;
}

function setupCreateForm() {
  const signIn = document.getElementById('createSignIn');
  if (signIn) signIn.onclick = pixlectSignIn;
  const cc = document.getElementById('createChannelBtn');
  if (cc) cc.onclick = () => promptCreateChannel(CTX);

  const form = document.getElementById('createForm');
  if (!form) return;

  const channelSelect = document.getElementById('f-channel');
  const tabs = $$('.source-tab[data-source]');
  const paneUpload = document.getElementById('paneUpload');
  const paneUrl = document.getElementById('paneUrl');
  let sourceMode = 'upload';

  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    sourceMode = t.dataset.source;
    paneUpload.style.display = sourceMode === 'upload' ? '' : 'none';
    paneUrl.style.display = sourceMode === 'url' ? '' : 'none';
  }));

  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('f-file');
  const dzEmpty = document.getElementById('dropzoneEmpty');
  const dzFile = document.getElementById('dropzoneFile');
  const dzFileName = document.getElementById('dzFileName');
  const dzFileSize = document.getElementById('dzFileSize');
  const progress = document.getElementById('progress');
  const progressBar = document.getElementById('progressBar');
  const progressLabel = document.getElementById('progressLabel');
  const sizeWarn = document.getElementById('sizeWarn');
  const kindSelect = document.getElementById('f-kind');

  let pickedFile = null;
  let pickedDuration = 0;
  let autoThumbDataUrl = '';

  function resetVideoFile() {
    pickedFile = null;
    pickedDuration = 0;
    fileInput.value = '';
    dzEmpty.style.display = '';
    dzFile.style.display = 'none';
    dropzone.classList.remove('has-file');
    progress.style.display = 'none';
    progressBar.style.width = '0';
    progressLabel.style.display = 'none';
    sizeWarn.style.display = 'none';
  }

  function limitFor(kind) {
    return kind === 'mini'
      ? { bytes: MAX_MINI_BYTES, seconds: MAX_MINI_SECONDS }
      : { bytes: MAX_LONG_BYTES, seconds: MAX_LONG_SECONDS };
  }

  function validate() {
    if (!pickedFile) return true;
    const lim = limitFor(kindSelect.value);
    if (pickedFile.size > lim.bytes) {
      sizeWarn.style.display = '';
      sizeWarn.innerHTML = `⚠️ <b>${fmtBytes(pickedFile.size)}</b> is above the ${fmtBytes(lim.bytes)} limit.`;
      return false;
    }
    if (pickedDuration && pickedDuration > lim.seconds + 1) {
      const m = Math.floor(pickedDuration / 60);
      const s = Math.round(pickedDuration % 60);
      sizeWarn.style.display = '';
      sizeWarn.innerHTML = `⚠️ Video is ${m}:${String(s).padStart(2, '0')} — limit is ${Math.floor(lim.seconds / 60)} min.`;
      return false;
    }
    sizeWarn.style.display = 'none';
    return true;
  }

  function readFile(file) {
    if (!file) return;
    if (!/^video\//.test(file.type)) { toast('Please choose a video file'); return; }
    pickedFile = file;
    pickedDuration = 0;

    dzEmpty.style.display = 'none';
    dzFile.style.display = 'flex';
    dzFileName.textContent = file.name;
    dzFileSize.textContent = fmtBytes(file.size) + ' · ' + file.type;
    dropzone.classList.add('has-file');
    progress.style.display = '';
    progressBar.style.width = '0%';
    progressLabel.style.display = '';
    progressLabel.textContent = 'Reading metadata…';

    const v = document.createElement('video');
    v.preload = 'metadata';
    v.src = URL.createObjectURL(file);
    v.addEventListener('loadedmetadata', () => {
      if (isFinite(v.duration) && v.duration > 0) {
        pickedDuration = v.duration;
        const d = Math.round(v.duration);
        document.getElementById('f-dur').value =
          `${Math.floor(d / 60)}:${String(d % 60).padStart(2, '0')}`;
      }
      progress.style.display = 'none';
      progressLabel.style.display = 'none';
      validate();
      URL.revokeObjectURL(v.src);
    }, { once: true });
    v.addEventListener('error', () => {
      progress.style.display = 'none';
      progressLabel.style.display = 'none';
      validate();
      URL.revokeObjectURL(v.src);
    }, { once: true });

    const autoNote = document.getElementById('thumbAutoNote');
    autoNote.textContent = 'Capturing thumbnail…';
    captureThumbnailFromFile(file).then((thumb) => {
      if (thumb) {
        autoThumbDataUrl = thumb;
        autoNote.innerHTML = '✅ Auto‑thumbnail captured.';
        if (thumbMode === 'auto') updateThumbPreview();
      } else {
        autoThumbDataUrl = '';
        autoNote.innerHTML = `<span style="color:var(--warn)">⚠️ Could not capture a frame.</span>`;
        if (thumbMode === 'auto') updateThumbPreview();
      }
    });
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => readFile(e.target.files[0]));
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag');
    if (e.dataTransfer.files.length) readFile(e.dataTransfer.files[0]);
  });

  kindSelect.addEventListener('change', validate);

  const thumbTabs = $$('.thumb-tab');
  const thumbPaneAuto = document.getElementById('thumbPaneAuto');
  const thumbPaneUpload = document.getElementById('thumbPaneUpload');
  const thumbPaneUrl = document.getElementById('thumbPaneUrl');
  const thumbPreviewImg = document.getElementById('thumbPreviewImg');
  const thumbPreviewEmpty = document.getElementById('thumbPreviewEmpty');
  const thumbPreviewBadge = document.getElementById('thumbPreviewBadge');

  let thumbMode = 'auto';
  let uploadedThumbDataUrl = '';
  let urlThumbValue = '';

  function currentThumb() {
    if (thumbMode === 'auto') return autoThumbDataUrl;
    if (thumbMode === 'upload') return uploadedThumbDataUrl;
    if (thumbMode === 'url') return urlThumbValue.trim();
    return '';
  }
  function updateThumbPreview() {
    const val = currentThumb();
    if (val) {
      thumbPreviewImg.src = val;
      thumbPreviewImg.style.display = 'block';
      thumbPreviewEmpty.style.display = 'none';
      thumbPreviewBadge.style.display = '';
      thumbPreviewBadge.textContent = thumbMode === 'auto' ? 'AUTO' : (thumbMode === 'upload' ? 'UPLOADED' : 'URL');
    } else {
      thumbPreviewImg.removeAttribute('src');
      thumbPreviewImg.style.display = 'none';
      thumbPreviewEmpty.style.display = '';
      thumbPreviewBadge.style.display = 'none';
    }
  }
  thumbTabs.forEach(t => t.addEventListener('click', () => {
    thumbTabs.forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    thumbMode = t.dataset.thumb;
    thumbPaneAuto.style.display = thumbMode === 'auto' ? '' : 'none';
    thumbPaneUpload.style.display = thumbMode === 'upload' ? '' : 'none';
    thumbPaneUrl.style.display = thumbMode === 'url' ? '' : 'none';
    updateThumbPreview();
  }));

  const thumbDropzone = document.getElementById('thumbDropzone');
  const thumbFileInput = document.getElementById('f-thumbfile');
  const thumbDzEmpty = document.getElementById('thumbDzEmpty');
  const thumbDzFile = document.getElementById('thumbDzFile');
  const thumbDzName = document.getElementById('thumbDzName');
  const thumbDzSize = document.getElementById('thumbDzSize');

  function readThumbFile(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { toast('Please choose an image file'); return; }
    thumbDzEmpty.style.display = 'none';
    thumbDzFile.style.display = 'flex';
    thumbDzName.textContent = file.name;
    thumbDzSize.textContent = fmtBytes(file.size) + ' · ' + file.type;
    thumbDropzone.classList.add('has-file');
    resizeImageFile(file).then((dataUrl) => {
      if (dataUrl) { uploadedThumbDataUrl = dataUrl; updateThumbPreview(); }
      else toast('Could not read the image');
    });
  }
  thumbDropzone.addEventListener('click', () => thumbFileInput.click());
  thumbFileInput.addEventListener('change', (e) => readThumbFile(e.target.files[0]));
  thumbDropzone.addEventListener('dragover', (e) => { e.preventDefault(); thumbDropzone.classList.add('drag'); });
  thumbDropzone.addEventListener('dragleave', () => thumbDropzone.classList.remove('drag'));
  thumbDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    thumbDropzone.classList.remove('drag');
    if (e.dataTransfer.files.length) readThumbFile(e.dataTransfer.files[0]);
  });

  const thumbUrlInput = document.getElementById('f-thumb');
  thumbUrlInput.addEventListener('input', () => {
    urlThumbValue = thumbUrlInput.value;
    if (thumbMode === 'url') updateThumbPreview();
  });

  /* Wrapped in requireGuidelines so first-time uploaders see the rules */
  const doSubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createSubmit');

    /* Re-check suspension on submit */
    const block = canCurrentUserUpload(CTX);
    if (block && block.reason === 'suspended') {
      toast('Your account is suspended and cannot upload.');
      return;
    }

    if (channelSelect && channelSelect.value && channelSelect.value !== state.activeChannelId) {
      await setActiveChannel(channelSelect.value);
      renderTopbar();
      renderSidebar();
    }

    const title = document.getElementById('f-title').value.trim();
    const kind = kindSelect.value;
    const dur = document.getElementById('f-dur').value.trim() || '0:00';
    const desc = document.getElementById('f-desc').value.trim();
    if (!title) { toast('Title is required'); return; }

    let src = '';
    let file = null;
    if (sourceMode === 'url') {
      src = document.getElementById('f-src').value.trim();
      if (!src) { toast('Paste a video URL'); return; }
    } else {
      if (!pickedFile) { toast('Choose a video file first'); return; }
      if (!validate()) { toast('File exceeds the limit'); return; }
      file = pickedFile;
    }

    const thumb = currentThumb();
    btn.disabled = true;
    btn.textContent = kind === 'mini' ? 'Saving…' : 'Uploading…';

    const vid = await createVideo({
      title, src, thumb, kind, dur, desc, file
    });

    if (vid) {
      toast('Video published 🎉');
      location.hash = '#/watch/' + vid;
    } else {
      btn.disabled = false;
      btn.textContent = 'Publish';
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!hasAcceptedGuidelines()) {
      promptGuidelines(() => doSubmit(e));
      return;
    }
    doSubmit(e);
  });
}

/* ============================================================
   GLOBAL EVENTS
   ============================================================ */
window.addEventListener('pixeltube:signin', pixlectSignIn);

document.addEventListener('click', async (e) => {
  const sw = e.target.closest('[data-action="switch-channel"]');
  if (sw) {
    e.preventDefault();
    const cid = sw.dataset.cid;
    if (cid) {
      await setActiveChannel(cid);
      closeModal();
      renderTopbar();
      renderSidebar();
      render(true);
    }
    return;
  }

  if (e.target.id === 'makeActiveBtn') {
    const cid = e.target.dataset.cid;
    await setActiveChannel(cid);
    renderTopbar();
    renderSidebar();
    render(true);
    return;
  }
  if (e.target.id === 'deleteChBtn') {
    const cid = e.target.dataset.cid;
    if (!confirm('Delete this channel permanently?')) return;
    const ok = await deleteChannel(cid);
    if (ok) { location.hash = '#/'; renderTopbar(); renderSidebar(); render(true); }
    return;
  }
  if (e.target.id === 'editChBtn') {
    promptEditChannel(CTX);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'menu') { e.preventDefault(); document.body.classList.toggle('nav-open'); return; }
  if (action === 'like')    { e.preventDefault(); e.stopPropagation(); toggleLike(el.dataset.video); return; }
  if (action === 'dislike') { e.preventDefault(); e.stopPropagation(); toggleDislike(el.dataset.video); return; }
  if (action === 'sub')     { e.preventDefault(); e.stopPropagation(); toggleSub(el.dataset.channel); return; }
  if (action === 'mute') {
    e.preventDefault();
    const mini = el.closest('.mini');
    if (!mini) return;
    const v = mini.querySelector('video');
    v.muted = !v.muted;
    el.textContent = v.muted ? '🔇' : '🔊';
    return;
  }
  if (action === 'share') {
    e.preventDefault();
    const url = location.origin + location.pathname + '#/watch/' + el.dataset.video;
    navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url));
    return;
  }
  if (action === 'report-video') {
    e.preventDefault();
    promptReportVideo(CTX, el.dataset.video);
    return;
  }
  if (action === 'del-video') {
    e.preventDefault();
    if (!confirm('Delete this video permanently?')) return;
    deleteVideo(el.dataset.video).then(() => { location.hash = '#/'; toast('Video deleted'); });
    return;
  }
  if (action === 'admin-dismiss') {
    e.preventDefault();
    (async () => {
      try {
        await update(ref(db, `pixeltube/reports/${el.dataset.rid}`), {
          status: 'resolved',
          resolvedAt: Date.now(),
          resolvedBy: PIXLECT.user.username,
          action: 'dismissed'
        });
        toast('Report dismissed');
        render(true);
      } catch (err) { console.error(err); toast('Could not dismiss'); }
    })();
    return;
  }
  if (action === 'admin-delete') {
    e.preventDefault();
    if (!confirm('Delete this video permanently?')) return;
    (async () => {
      await deleteVideo(el.dataset.vid);
      try {
        await update(ref(db, `pixeltube/reports/${el.dataset.rid}`), {
          status: 'resolved',
          resolvedAt: Date.now(),
          resolvedBy: PIXLECT.user.username,
          action: 'deleted-video'
        });
      } catch (_) {}
      toast('Video deleted and report resolved');
      render(true);
    })();
    return;
  }
  if (action === 'admin-suspend') {
    e.preventDefault();
    const reason = prompt('Reason for suspension (shown to the channel owner):');
    if (!reason) return;
    (async () => {
      const ok = await suspendChannel(CTX, el.dataset.cid, reason);
      if (!ok) return;
      if (el.dataset.rid) {
        try {
          await update(ref(db, `pixeltube/reports/${el.dataset.rid}`), {
            status: 'resolved',
            resolvedAt: Date.now(),
            resolvedBy: PIXLECT.user.username,
            action: 'suspended-channel'
          });
        } catch (_) {}
      }
      render(true);
    })();
    return;
  }
  if (action === 'admin-delete-standalone') {
    e.preventDefault();
    if (!confirm('Delete this video permanently?')) return;
    deleteVideo(el.dataset.vid).then(() => {
      toast('Video deleted');
      render(true);
    });
    return;
  }
  if (action === 'pl-add') {
    e.preventDefault();
    addToPlaylist(el.dataset.pid, el.dataset.vid);
    toast('Added to playlist');
    return;
  }
  if (action === 'pl-remove') {
    e.preventDefault();
    removeFromPlaylist(el.dataset.pid, el.dataset.vid);
    toast('Removed from playlist');
    render(true);
    return;
  }
});

document.addEventListener('play', (e) => {
  const v = e.target;
  if (v.tagName === 'VIDEO' && v.dataset.vid) registerView(v.dataset.vid);
}, true);

document.addEventListener('click', (e) => {
  if (e.target.id === 'emptyCreateChannel') promptCreateChannel(CTX);
  if (e.target.id === 'newPlaylistBtn') {
    const name = prompt('Playlist name:');
    if (name) createPlaylist(name).then(pid => { if (pid) location.hash = '#/playlist/' + pid; });
  }
  if (e.target.id === 'plDeleteBtn') {
    const pid = state.route[1];
    if (!confirm('Delete this playlist?')) return;
    deletePlaylist(pid).then(() => { location.hash = '#/playlists'; toast('Playlist deleted'); });
  }
});

wireSearchInput(CTX);
wireClearHistory(CTX);

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length ? parts : ['home'];
}

window.addEventListener('hashchange', () => {
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  resetMinisPagination();
  state.route = parseRoute();
  document.body.classList.remove('nav-open');
  render(true);
});

console.log('[main.js] bootstrapping PIXELTube');
state.route = parseRoute();
renderTopbar();
renderSidebar();
render(true);
boot();