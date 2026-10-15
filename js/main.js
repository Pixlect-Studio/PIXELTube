import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, remove, update, runTransaction, push
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  $, $$, esc, fmt, fmtBytes, timeAgo, initial,
  avatarHTML, thumbHTML, captureThumbnailFromFile, resizeImageFile,
  parseDuration, getSearchHistory, pushSearchHistory, clearSearchHistory,
  hasSearchHistory
} from './helpers.js';

import * as storage from './storage.js';
import { promptEditChannel } from './channel.js';
import {
  offlineDownloads, isOfflineDownloaded, saveOfflineVideo,
  removeOfflineVideo, offlinePlaybackSource, clearOfflinePlaybackUrls
} from './offline.js';

import {
  promptReportVideo, promptGuidelines,
  canCurrentUserUpload, hasAcceptedGuidelines,
  suspendChannel, unsuspendChannel, isUserSuspended,
  viewAdmin, isAdminUser
} from './sec.js';

import { viewStudio } from './studio.js';
import { viewPrivacy, viewTerms, viewGuidelines } from './legal.js';

/* ============================================================
   FIREBASE — MAIN (videos, channels, user subscriptions, likes, comments)
   ============================================================ */
const FIREBASE_PRIMARY = {
  apiKey: "AIzaSyBLc2W7w4F0XSnsNlHbmlaSyM982Ha2bhM",
  authDomain: "the-amazing-digital-fanbase.firebaseapp.com",
  databaseURL: "https://the-amazing-digital-fanbase-default-rtdb.firebaseio.com",
  projectId: "the-amazing-digital-fanbase",
  storageBucket: "the-amazing-digital-fanbase.firebasestorage.app",
  messagingSenderId: "899632202736",
  appId: "1:899632202736:web:3b6de3d2e312bd6d6b5335"
};

/* ============================================================
   FIREBASE — BACKUP (Mini storage failover)
   ============================================================ */
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
   FIREBASE — STATS (analytics only)
   ============================================================ */
const FIREBASE_STATS = {
  apiKey: "AIzaSyC_RoYfDWEEws0Byx_79QCOoQXARpjUp60",
  authDomain: "pixquiz-5fd01.firebaseapp.com",
  databaseURL: "https://pixquiz-5fd01-default-rtdb.firebaseio.com",
  projectId: "pixquiz-5fd01",
  storageBucket: "pixquiz-5fd01.firebasestorage.app",
  messagingSenderId: "838894677501",
  appId: "1:838894677501:web:489511ad3ddb1294547d94"
};

/* ============================================================
   SUPABASE
   ============================================================ */
const SUPABASE_PRIMARY = {
  url: 'https://finuvmxyymhfvmscmgac.supabase.co',
  key: 'sb_publishable_UAbpVV0jSe2h6aPkbYEgtw_kWzaT7qt'
};
const MAX_LONG_BYTES   = storage.MAX_LONG_UPLOAD_BYTES;
const MAX_MINI_BYTES   = storage.MAX_MINI_UPLOAD_BYTES;
const MAX_LONG_SECONDS = 60 * 60;            // 60 min
const MAX_MINI_SECONDS = 5 * 60;             // 5 min
const MAX_EXTRA_CHANNELS = 5;

let supaPrimary = null;
try {
  supaPrimary = createClient(SUPABASE_PRIMARY.url, SUPABASE_PRIMARY.key, { auth: { persistSession: false } });
} catch (e) { console.warn('[main.js] Supabase init failed:', e); }

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
const ADMIN_UIDS      = ['dSs1Y55uKrcCeaXYLOqI2yco4HL2', 'SqQBVRd7A1aVxllN5XxKbLVGprw1', '67f9CRKuPAUk0dMpAz3TygtfQSW2', 'LnxFnPobLvap8n70EiFy35H2jOJ3'];
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
  statsLogEvent('signin', { username: clean.username });
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
  subscriberCounts: {},
  users: {}, reports: {}, comments: {},
  search: '', route: ['home'],
  viewedThisSession: new Set(),
  myChannelIds: [],
  activeChannelId: null
};

let db = null;
let dbBackup = null;
let dbStats = null;
let localDB = null;
let lastData = null;
let commentsUnsub = null;

/* ============================================================
   DERIVED HELPERS
   ============================================================ */
const subsOf = cid => {
  const storedCount = state.subscriberCounts[cid];
  if (storedCount !== undefined && storedCount !== null) {
    const count = Number(storedCount);
    if (Number.isFinite(count) && count >= 0) return count;
  }
  const count = Number(state.channels[cid]?.subs);
  return Number.isFinite(count) && count >= 0 ? count : 0;
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
   STATS — analytics and subscriber counts use the pixquiz-5fd01 project
   ============================================================ */
async function statsRegisterView(vid) {
  if (!dbStats) return;
  try {
    await runTransaction(ref(dbStats, `pixeltube_stats/views/${vid}`), n => (Number(n) || 0) + 1);
  } catch (e) { console.warn('[stats] registerView failed', e?.message); }
}

const subscriberCountsSeeded = new Set();

function watchSubscriberCounts() {
  if (!dbStats) return;
  onValue(ref(dbStats, 'pixeltube_stats/subscribers'), snap => {
    state.subscriberCounts = snap.val() || {};
    syncDynamic();
  }, error => {
    console.error('[stats] subscriber count read failed:', error);
  });
}

async function seedSubscriberCounts(channels) {
  if (!dbStats) return;
  await Promise.all(Object.values(channels || {}).map(async channel => {
    if (!channel?.id || subscriberCountsSeeded.has(channel.id)) return;
    subscriberCountsSeeded.add(channel.id);
    try {
      await runTransaction(ref(dbStats, `pixeltube_stats/subscribers/${channel.id}`), count => {
        if (count !== null) return count;
        const legacyCount = Number(channel.subs);
        return Number.isFinite(legacyCount) && legacyCount >= 0 ? legacyCount : 0;
      });
    } catch (error) {
      subscriberCountsSeeded.delete(channel.id);
      console.error(`[stats] could not initialize subscriber count for ${channel.id}:`, error);
    }
  }));
}

async function statsAdjustSubscriberCount(cid, delta) {
  if (!dbStats) throw new Error('Subscriber count service is unavailable.');
  const legacyCount = Number(state.channels[cid]?.subs);
  const initialCount = Number.isFinite(legacyCount) && legacyCount >= 0 ? legacyCount : 0;
  await runTransaction(ref(dbStats, `pixeltube_stats/subscribers/${cid}`), count =>
    Math.max(0, (count === null ? initialCount : Number(count) || 0) + delta));
}

async function statsLogEvent(type, payload) {
  if (!dbStats) return;
  try {
    const day = new Date().toISOString().slice(0, 10);
    await push(ref(dbStats, `pixeltube_stats/events/${day}`), {
      type,
      ts: Date.now(),
      uid: PIXELTUBE_stats_uid(),
      ...payload
    });
    await runTransaction(ref(dbStats, `pixeltube_stats/daily/${day}/${type}`),
      n => (Number(n) || 0) + 1);
  } catch (e) { console.warn('[stats] logEvent failed', e?.message); }
}

function PIXELTUBE_stats_uid() {
  return PIXLECT.user?.uid || 'anon';
}

async function statsFetchTotals() {
  if (!dbStats) return { views: {}, daily: {}, events: 0 };
  try {
    const snap = await get(ref(dbStats, 'pixeltube_stats'));
    return snap.val() || { views: {}, daily: {}, events: 0 };
  } catch (e) {
    console.warn('[stats] fetchTotals failed', e?.message);
    return { views: {}, daily: {}, events: 0 };
  }
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
    ownerUid: PIXLECT.user.uid,
    ownerUsername: PIXLECT.user.username,
    createdAt: existing.createdAt || Date.now()
  };
  if (state.mode === 'firebase' && db) {
    try { await update(ref(db, `pixeltube/channels/${cid}`), ch); }
    catch (e) { toast('Could not save channel: ' + (e?.message || e)); throw e; }
  } else if (state.mode === 'local' && localDB) {
    localDB.channels[cid] = { ...existing, ...ch };
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
  statsLogEvent('channel_create', { cid });
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
  statsLogEvent('channel_delete', { cid });
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

    try {
      const statsApp = initializeApp(FIREBASE_STATS, 'stats');
      dbStats = getDatabase(statsApp);
      watchSubscriberCounts();
      console.log('[main.js] Stats Firebase ready');
    } catch (e) { console.warn('[main.js] Stats Firebase init failed:', e); }

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
  seedSubscriberCounts(state.channels);
  offlineDownloads().forEach(item => {
    if (!item.video?.id) return;
    if (!state.videos[item.video.id]) state.videos[item.video.id] = item.video;
    if (item.channel?.id && !state.channels[item.channel.id]) state.channels[item.channel.id] = item.channel;
  });
  state.playlists = d.playlists || {};
  state.users     = d.users     || {};
  state.reports   = d.reports   || {};
  state.comments  = d.comments  || {};
  const u = (d.users && d.users[state.uid]) || {};
  state.subs     = u.subs     || {};
  state.likes    = u.likes    || {};
  state.dislikes = u.dislikes || {};
  updateJoinedUserCount();

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

function updateJoinedUserCount() {
  const counter = document.getElementById('joinedUserCount');
  if (!counter) return;
  if (state.mode !== 'firebase') {
    counter.textContent = 'Community count unavailable offline';
    return;
  }

  const joinedUsers = Object.keys(state.users).filter(uid => uid.startsWith('pl_') && uid.length > 3).length;
  counter.textContent = `${fmt(joinedUsers)} ${joinedUsers === 1 ? 'user' : 'users'} joined PIXELTube`;
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
    if (!dbStats) { toast('Subscriber count service is unavailable'); return; }
    try {
      const p = `pixeltube/users/${state.uid}/subs/${cid}`;
      if (on) await remove(ref(db, p)); else await set(ref(db, p), true);
      await statsAdjustSubscriberCount(cid, delta);
      toast(on ? 'Unsubscribed' : 'Subscribed 🔔');
    } catch (e) {
      console.error('[main.js] Could not update subscription:', e);
      toast(e?.message || 'Could not update subscription');
      return;
    }
  } else {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    const s = u.subs || (u.subs = {});
    if (on) delete s[cid]; else s[cid] = true;
    const ch = localDB.channels[cid];
    if (ch) ch.subs = Math.max(0, (Number(ch.subs) || 0) + delta);
    persistLocal();
    applyData(localDB);
  }
  statsLogEvent(on ? 'unsubscribe' : 'subscribe', { cid });
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
  statsLogEvent(on ? 'unlike' : 'like', { vid });
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
  statsLogEvent(on ? 'undislike' : 'dislike', { vid });
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
  /* Stats write — separate project, never blocks the main flow */
  statsRegisterView(vid);
  statsLogEvent('view', { vid });
}

/* ============================================================
   VIDEO SOURCE
   ============================================================ */
function showPlaybackError(video, message) {
  const player = video.parentElement;
  if (!player) return;

  let loading = player.querySelector('.loading');
  if (!loading) {
    loading = document.createElement('div');
    loading.className = 'loading';
    player.append(loading);
  }
  loading.textContent = message;
}

function playbackErrorMessage(url) {
  if (location.protocol === 'file:' && /^https?:\/\/[^/]+\.b-cdn\.net(?:\/|$)/i.test(url)) {
    return 'Open PIXELTube from its website or a local web server to play this stream.';
  }
  return 'Unable to play video';
}

async function attachPlaybackSource(video, url, isHls = false) {
  if (!isHls && !/\.m3u8(?:$|[?#])/i.test(url)) {
    video.src = url;
    return true;
  }

  let Hls = window.Hls;
  if (!Hls) {
    try {
      ({ default: Hls } = await import('https://cdn.jsdelivr.net/npm/hls.js@1.5.17/+esm'));
    } catch (error) {
      console.error('[main.js] could not load HLS.js:', error);
    }
  }

  if (Hls?.isSupported()) {
    const player = new Hls({ capLevelToPlayerSize: false });
    player.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!player.levels.length) return;
      const highest = player.levels.reduce((bestIndex, level, index, levels) => {
        const best = levels[bestIndex];
        const pixels = (level.width || 0) * (level.height || 0);
        const bestPixels = (best.width || 0) * (best.height || 0);
        return pixels > bestPixels || (pixels === bestPixels && level.bitrate > best.bitrate)
          ? index
          : bestIndex;
      }, 0);
      player.currentLevel = highest;
    });
    player.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      console.error('[main.js] fatal HLS playback error:', data);
      player.destroy();
      showPlaybackError(video, playbackErrorMessage(url));
    });
    player.loadSource(url);
    player.attachMedia(video);
    return true;
  }

  if (video.canPlayType('application/vnd.apple.mpegurl') ||
      video.canPlayType('application/x-mpegURL')) {
    video.src = url;
    return true;
  }

  const mp4Url = url.replace(/playlist\.m3u8(?=$|[?#])/i, 'play_720p.mp4');
  if (mp4Url !== url && video.canPlayType('video/mp4')) {
    console.warn('[main.js] HLS unavailable; falling back to Bunny MP4 rendition');
    video.src = mp4Url;
    return true;
  }

  showPlaybackError(video, 'This browser cannot play this video format');
  return false;
}

async function hydrateVideosInView(root) {
  const vids = $$('video[data-vid]', root || document);
  await Promise.all(vids.map(async (v) => {
    const vid = v.dataset.vid;
    if (v.dataset.hydrated === '1') return;
    v.dataset.hydrated = '1';
    v.addEventListener('volumechange', () => updateVideoAudioButton(v));
    updateVideoAudioButton(v);
    try {
      let offlineSource = null;
      try {
        offlineSource = await offlinePlaybackSource(vid);
      } catch (error) {
        console.warn('[main.js] offline copy unavailable; trying the online source:', error);
      }
      const url = offlineSource?.url || await storage.resolvePlaybackUrl(CTX, vid);
      if (url) {
        v.addEventListener('error', () => {
          showPlaybackError(v, playbackErrorMessage(url));
        }, { once: true });
        const attached = await attachPlaybackSource(v, url, offlineSource?.isHls || false);
        const loading = v.parentElement.querySelector('.loading');
        if (loading && attached) loading.remove();
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
   CREATE VIDEO
   ============================================================ */
async function createVideo(payload) {
  if (!PIXLECT.user) { toast('Sign in to upload'); pixlectSignIn(); return null; }

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
      statsLogEvent('upload', { vid, kind, channelId: cid });
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
    statsLogEvent('upload', { vid, kind, channelId: cid });
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
  statsLogEvent('video_delete', { vid });
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
  statsLogEvent('comment', { vid });
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
  get dbStats() { return dbStats; },
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

  statsLogEvent, statsRegisterView, statsFetchTotals,

  get route() { return state.route; }
};

window.__CTX = CTX;
window.__PIXLECT = PIXLECT;
window.__state = state;
window.__isAdmin = isAdmin;
window.__stats = { statsFetchTotals, statsLogEvent };

/* ============================================================
   CARD BUILDERS
   ============================================================ */
function cardHTML(v) {
  const c = chanOf(v.id);
  const href = v.kind === 'mini' ? `#/mini/${esc(v.id)}` : `#/watch/${esc(v.id)}`;
  return `
  <a class="card" href="${href}">
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
  longs:  '<svg viewBox="0 0 24 24"><path d="M4 4h16v16H4zm2 2v12h12V6zm3 2 6 4-6 4z"/></svg>',
  minis:  '<svg viewBox="0 0 24 24"><path d="M13 2L4.5 13H11l-1 9L18.5 11H12z"/></svg>',
  subs:   '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/><circle cx="18" cy="16" r="3"/></svg>',
  like:   '<svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg>',
  create: '<svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z"/></svg>'
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
    <a class="nav ${page === 'longs' ? 'active' : ''}" href="#/longs">${ICONS.longs} Longs</a>
    <a class="nav ${page === 'minis' ? 'active' : ''}" href="#/minis">${ICONS.minis} Minis</a>
    <a class="nav ${page === 'subs' ? 'active' : ''}" href="#/subs">${ICONS.subs} Subscriptions <span class="count">${subIds.length || ''}</span></a>
    <a class="nav ${page === 'liked' ? 'active' : ''}" href="#/liked">${ICONS.like} Liked <span class="count">${likeCount || ''}</span></a>
    <a class="nav ${page === 'downloads' ? 'active' : ''}" href="#/downloads">↓ Downloads <span class="count">${offlineDownloads().length || ''}</span></a>
    <a class="nav pro-upgrade ${page === 'pro' ? 'active' : ''}" href="#/pro">✦ Upgrade</a>
    <a class="nav ${page === 'create' ? 'active' : ''}" href="#/create">${ICONS.create} Create</a>
    ${PIXLECT.user && active ? `<a class="nav ${page === 'studio' ? 'active' : ''}" href="#/studio">Studio</a>` : ''}
    ${isAdmin() ? `<a class="nav ${page === 'admin' ? 'active' : ''}" href="#/admin">Admin</a>` : ''}

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
  else if (page === 'longs')     view.innerHTML = viewLongs(CTX);
  else if (page === 'minis')     view.innerHTML = viewMinis(CTX);
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
  else if (page === 'downloads') view.innerHTML = viewDownloads(CTX);
  else if (page === 'pro')       view.innerHTML = viewPro();
  else if (page === 'create')    { view.innerHTML = viewCreate(); setupCreateForm(); }
  else if (page === 'watch')     { view.innerHTML = viewWatch(CTX, arg); subscribeComments(arg); setupCommentForm(CTX, arg); hydrateVideosInView(view); }
  else if (page === 'channel')   view.innerHTML = viewChannel(CTX, arg);
  else if (page === 'playlists') view.innerHTML = viewPlaylists(CTX);
  else if (page === 'playlist')  view.innerHTML = viewPlaylist(CTX);
  else if (page === 'admin')     view.innerHTML = viewAdmin(CTX, arg || 'reports');
  else if (page === 'studio')    {
    view.innerHTML = viewStudio(CTX, arg || 'dashboard');
    if (!arg || arg === 'dashboard') setupStudioStats();
  }
  else if (page === 'privacy')   view.innerHTML = viewPrivacy();
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
    } else if (t === 'subcount-value') {
      el.textContent = fmt(subsOf(el.dataset.channel));
    } else if (t === 'subcount-label') {
      const count = subsOf(el.dataset.channel);
      el.textContent = `${fmt(count)} ${count === 1 ? 'subscriber' : 'subscribers'}`;
    } else if (t === 'views') {
      el.textContent = fmt(viewsOf(el.dataset.video)) + ' views';
    }
  });
  renderSidebar();
}

/* ============================================================
   STUDIO STATS
   ============================================================ */
async function setupStudioStats() {
  const totalEl = document.getElementById('studioStatsTotal');
  const dailyEl = document.getElementById('studioStatsDaily');
  if (!totalEl || !dbStats) return;

  const data = await statsFetchTotals();
  const total = Object.values(data.views || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  totalEl.textContent = fmt(total);

  const days = Object.entries(data.daily || {}).sort().slice(-7).reverse();
  if (!days.length) {
    dailyEl.textContent = 'No activity yet today.';
    return;
  }
  dailyEl.innerHTML = days.map(([day, events]) => {
    const totalEvents = Object.values(events).reduce((s, n) => s + (Number(n) || 0), 0);
    return `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)">
      <span>${esc(day)}</span><span><b>${totalEvents}</b> events</span>
    </div>`;
  }).join('');
}

/* ============================================================
   FEED / SUBS / LIKED / PLAYLISTS / CHANNEL / WATCH / CREATE
   (unchanged from previous version)
   ============================================================ */
function viewFeed(ctx) {
  const { state, chanOf, videosSorted, cardHTML, shortCardHTML,
          emptyState, hasChannel, PIXLECT } = ctx;

  if (state.search && state.search.trim()) {
    const q = state.search.trim().toLowerCase();
    const tokens = q.split(/\s+/).filter(Boolean);
    const matches = (t) => t && tokens.every(tok => String(t).toLowerCase().includes(tok));
    const videos = videosSorted().filter(v => {
      const c = chanOf(v.id);
      return matches(v.title) || matches(v.desc) || matches(c.name);
    });
    const longs = videos.filter(v => v.kind !== 'mini');
    const minis = videos.filter(v => v.kind === 'mini');
    const channels = Object.values(state.channels).filter(c =>
      matches(c.name) || matches(c.handle)
    ).sort((a, b) => subsOf(b.id) - subsOf(a.id));

    if (!videos.length && !channels.length) {
      return emptyState('🔍', `No results for "${state.search}"`, 'Try a different search term.', '');
    }

    const channelsBlock = channels.length ? `
      <div class="page-head" style="padding-top:14px">
        <h2 style="font-size:16px;font-weight:800">Channels</h2>
        <p>${channels.length} result${channels.length === 1 ? '' : 's'}</p>
      </div>
      <div class="chan-grid">${channels.map(c => `
        <a class="chan-card" href="#/channel/${esc(c.id)}">
          ${avatarHTML(c, 'lg')}
          <div class="chan-card-info">
            <h3>${esc(c.name)}</h3>
            <div class="sub">${esc(c.handle || '')} · <span data-dyn="subcount-label" data-channel="${esc(c.id)}">${fmt(subsOf(c.id))} subscriber${subsOf(c.id) === 1 ? '' : 's'}</span></div>
          </div>
        </a>`).join('')}</div>
    ` : '';

    const videosBlock = longs.length ? `
      <div class="page-head" style="padding-top:14px">
        <h2 style="font-size:16px;font-weight:800">Longs</h2>
        <p>${longs.length} result${longs.length === 1 ? '' : 's'}</p>
      </div>
      <div class="grid">${longs.map(cardHTML).join('')}</div>
    ` : '';
    const minisBlock = minis.length ? `
      <div class="page-head" style="padding-top:14px">
        <h2 style="font-size:16px;font-weight:800">Minis</h2>
        <p>${minis.length} result${minis.length === 1 ? '' : 's'}</p>
      </div>
      <div class="shorts-grid">${minis.map(shortCardHTML).join('')}</div>
    ` : '';

    return `
      <div class="page-head">
        <h1>Results for "${esc(state.search)}"</h1>
        <p>${channels.length} channel${channels.length === 1 ? '' : 's'} · ${videos.length} video${videos.length === 1 ? '' : 's'}</p>
      </div>
      ${channelsBlock}${videosBlock}${minisBlock}`;
  }

  if (!hasSearchHistory()) {
    return `
      <div class="empty" style="padding:120px 24px">
        <div class="big" style="font-size:56px">🔍</div>
        <h2 style="font-size:22px;margin-bottom:10px">Search To Find Videos Here</h2>
        <p style="max-width:420px">
          The Feed is built from what you search for. Try searching for
          <b style="color:var(--text)">Minecraft</b>,
          <b style="color:var(--text)">music</b>, or
          <b style="color:var(--text)">vlog</b> —
          then come back here.
        </p>
      </div>`;
  }

  const hist = getSearchHistory();
  const tokens = new Map();
  hist.forEach((h, i) => {
    const weight = Math.max(1, 20 - i);
    h.q.split(/\s+/).filter(Boolean).forEach(tok => {
      if (tok.length < 2) return;
      tokens.set(tok, (tokens.get(tok) || 0) + weight);
    });
  });

  const scored = videosSorted().filter(v => v.kind !== 'mini')
    .map(v => {
      const c = chanOf(v.id);
      let s = 0;
      tokens.forEach((w, tok) => {
        if ((v.title || '').toLowerCase().includes(tok)) s += 6 * w;
        if ((v.desc || '').toLowerCase().includes(tok))  s += 3 * w;
        if ((c.name || '').toLowerCase().includes(tok))  s += 4 * w;
      });
      return { v, s };
    })
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  if (!scored.length) {
    const latest = hist[0]?.q || '';
    return `
      <div class="empty" style="padding:120px 24px">
        <div class="big" style="font-size:56px">🎬</div>
        <h2 style="font-size:22px;margin-bottom:10px">No videos match yet</h2>
        <p style="max-width:420px">
          We found your recent search${latest ? ` for <b style="color:var(--text)">"${esc(latest)}"</b>` : ''},
          but nobody has uploaded anything matching it yet.
        </p>
      </div>`;
  }

  const longs = scored.slice(0, 40).map(x => x.v);

  return `
    <div class="page-head">
      <h1>Longs for you</h1>
      <p>${longs.length} long-form video${longs.length === 1 ? '' : 's'} based on your searches</p>
    </div>
    ${longs.length ? `<div class="grid">${longs.map(cardHTML).join('')}</div>` : ''}`;
}

function viewLongs(ctx) {
  const { longsSorted, cardHTML, emptyState } = ctx;
  const list = longsSorted();
  if (!list.length) return emptyState('🎬', 'No Longs yet', 'Long-form videos will appear here.', '');
  return `
    <div class="page-head"><h1>Longs</h1><p>${list.length} long-form video${list.length === 1 ? '' : 's'}</p></div>
    <div class="grid">${list.map(cardHTML).join('')}</div>`;
}

function viewSubs(ctx) {
  const { state, videosSorted, cardHTML, shortCardHTML, emptyState, PIXLECT } = ctx;
  const ids = Object.keys(state.subs);
  if (!ids.length) {
    return emptyState('📺', 'No subscriptions yet',
      PIXLECT.user ? 'Subscribe to channels and their newest videos show up here.' : 'Sign in with PIXLECT to subscribe.',
      PIXLECT.user ? '' : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }
  const list = videosSorted().filter(v => state.subs[v.channelId]);
  return `
    <div class="page-head">
      <h1>Subscriptions</h1>
      <p>${ids.length} channel${ids.length === 1 ? '' : 's'} · ${list.length} video${list.length === 1 ? '' : 's'}</p>
    </div>
    ${list.length ? videoTypeSections(list, cardHTML, shortCardHTML)
      : emptyState('📭', 'Nothing new yet', 'Channels you subscribe to haven\'t uploaded anything.', '')}`;
}

function viewLiked(ctx) {
  const { state, videosSorted, cardHTML, shortCardHTML, emptyState, PIXLECT } = ctx;
  const ids = Object.keys(state.likes);
  if (!ids.length) {
    return emptyState('👍', 'No liked videos',
      PIXLECT.user ? 'Videos you like are saved here.' : 'Sign in with PIXLECT to save likes.',
      PIXLECT.user ? '' : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }
  const list = videosSorted().filter(v => state.likes[v.id]);
  return `
    <div class="page-head"><h1>Liked videos</h1><p>${list.length} video${list.length === 1 ? '' : 's'}</p></div>
    ${videoTypeSections(list, cardHTML, shortCardHTML)}`;
}

function viewDownloads(ctx) {
  const { emptyState, cardHTML } = ctx;
  const downloads = offlineDownloads();
  if (!downloads.length) {
    return emptyState('⬇️', 'No offline downloads', 'Save a video from its watch page to view it offline.', '');
  }
  return `
    <div class="page-head"><h1>Downloads</h1><p>${downloads.length} saved video${downloads.length === 1 ? '' : 's'} · 2 GB limit</p></div>
    <div class="grid offline-grid">${downloads.map(item => {
      const video = item.video;
      if (!video?.id || !state.videos[video.id]) return '';
      return `<div class="offline-item">${cardHTML(video)}
        <button class="pill" data-action="offline-remove" data-video="${esc(video.id)}" type="button">Remove download</button>
      </div>`;
    }).join('')}</div>`;
}

function videoTypeSections(videos, cardHTML, shortCardHTML) {
  const longs = videos.filter(v => v.kind !== 'mini');
  const minis = videos.filter(v => v.kind === 'mini');
  return `
    ${longs.length ? `<div class="page-head"><h2>Longs</h2><p>${longs.length} video${longs.length === 1 ? '' : 's'}</p></div><div class="grid">${longs.map(cardHTML).join('')}</div>` : ''}
    ${minis.length ? `<section class="shorts-shelf">
      <div class="shelf-head"><div class="icon"><svg viewBox="0 0 24 24"><path d="M13 2L4.5 13 11 13l-1 9 8.5-11H12z"/></svg></div><h2>Minis</h2></div>
      <div class="shorts-grid">${minis.map(shortCardHTML).join('')}</div>
    </section>` : ''}`;
}

function viewPlaylists(ctx) {
  const { playlistsOfUser, playlistVideos, esc, timeAgo, emptyState, PIXLECT } = ctx;
  if (!PIXLECT.user) {
    return emptyState('🎵', 'Sign in to use playlists', 'Playlists let you group videos and watch them in sequence.',
      `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }
  const pls = playlistsOfUser();
  return `
    <div class="page-head">
      <h1>Your playlists</h1>
      <p>${pls.length} playlist${pls.length === 1 ? '' : 's'}</p>
      <button class="btn-primary" id="newPlaylistBtn" type="button" style="margin-left:auto">+ New playlist</button>
    </div>
    ${pls.length ? `<div class="grid">${pls.map(pl => {
      const vids = playlistVideos(pl.id);
      return `<a class="card" href="#/playlist/${esc(pl.id)}">
        <div class="thumb" style="background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center">
          <svg viewBox="0 0 24 24" width="52" height="52" fill="rgba(255,255,255,.9)"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
          <span class="dur">${vids.length} video${vids.length === 1 ? '' : 's'}</span>
        </div>
        <div class="info"><div style="min-width:0">
          <h3>${esc(pl.name)}</h3>
          <div class="sub">${vids.length ? 'Updated ' + esc(timeAgo(vids[0].createdAt)) : 'Empty playlist'}</div>
        </div></div>
      </a>`;
    }).join('')}</div>` : emptyState('🎵', 'No playlists yet', 'Create your first playlist to organize videos.', '')}`;
}

function viewPro() {
  return `
    <section class="pro-page">
      <div class="pro-hero">
        <div class="pro-badge">✦ PIXELTube PRO</div>
        <h1>More ways to watch.</h1>
        <p>Get more out of every video with PIXELTube Pro.</p>
        <div class="pro-price"><strong>$5</strong><span>/ month</span></div>
        <button class="btn-primary pro-coming-soon" type="button" disabled>Coming Soon</button>
      </div>
      <div class="pro-features">
        <article class="pro-feature">
          <div class="pro-feature-icon">▣</div>
          <h2>Bunny-powered 1080p playback</h2>
          <p>Watch supported videos in Full HD with Bunny’s embedded video player.</p>
        </article>
        <article class="pro-feature">
          <div class="pro-feature-icon">↓</div>
          <h2>Up to 10 GB of downloads</h2>
          <p>Keep more videos available for offline viewing.</p>
        </article>
        <article class="pro-feature">
          <div class="pro-feature-icon">◇</div>
          <h2>HEVC encoding</h2>
          <p>Enjoy efficient video encoding where supported.</p>
        </article>
      </div>
      <p class="pro-note">PIXELTube Pro is not available to purchase yet. No account or payment is needed to view this page.</p>
    </section>`;
}

function viewPlaylist(ctx) {
  const { state, route, playlistVideos, chanOf, esc, fmt, thumbHTML, emptyState, PIXLECT } = ctx;
  const pid = route[1];
  const pl = state.playlists[pid];
  if (!pl) return emptyState('🚫', 'Playlist not found', '', `<a class="btn-ghost" href="#/playlists">Back to playlists</a>`);
  const vids = playlistVideos(pid);
  const isOwner = PIXLECT.user && pl.ownerUid === PIXLECT.user.uid;

  return `
    <div class="playlist-header">
      <div class="playlist-cover">
        <svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
      </div>
      <div class="txt">
        <h1>${esc(pl.name)}</h1>
        <div class="meta">${esc(pl.ownerName || 'user')} · ${vids.length} video${vids.length === 1 ? '' : 's'}</div>
      </div>
      ${isOwner ? `<button class="btn-secondary" id="plDeleteBtn" type="button" style="color:var(--accent)">Delete playlist</button>` : ''}
    </div>
    ${vids.length ? `<div class="playlist-videos">
      ${vids.map((v, i) => {
        const c = chanOf(v.id);
        const videoHref = v.kind === 'mini' ? `#/mini/${esc(v.id)}` : `#/watch/${esc(v.id)}`;
        return `<div class="pl-item" data-pl-item="${esc(v.id)}">
          <div class="idx">${i + 1}</div>
          <a class="t" href="${videoHref}">${thumbHTML(v)}<span class="dur">${esc(v.dur)}</span></a>
          <div class="info">
            <a href="${videoHref}"><h4>${esc(v.title)}</h4></a>
            <div class="sub">${esc(c.name)} · ${fmt(v.views)} views</div>
          </div>
          ${isOwner ? `<button class="remove" data-action="pl-remove" data-pid="${esc(pid)}" data-vid="${esc(v.id)}" type="button">Remove</button>` : ''}
        </div>`;
      }).join('')}
    </div>` : emptyState('📭', 'This playlist is empty', isOwner ? 'Add videos from any watch page.' : '', '')}`;
}

function viewChannel(ctx, cid) {
  const { state, videosSorted, cardHTML, shortCardHTML, emptyState,
          subsOf, isSubbed, PIXLECT, myChannels } = ctx;
  const c = state.channels[cid];
  if (!c) return emptyState('🚫', 'Channel not found', '', `<a class="btn-ghost" href="#/">Go to Feed</a>`);

  const list = videosSorted().filter(v => v.channelId === cid);
  const longs = list.filter(v => v.kind !== 'mini');
  const minis = list.filter(v => v.kind === 'mini');
  const subbed = isSubbed(cid);
  const myIds = (myChannels() || []).map(x => x.id);
  const isMine = PIXLECT.user && c.ownerUid === PIXLECT.user.uid && myIds.includes(cid);
  const isActive = PIXLECT.user && state.activeChannelId === cid;

  const bannerStyle = c.banner
    ? `background-image:url('${esc(c.banner)}')`
    : `background:linear-gradient(120deg,${esc(c.color || '#38bdf8')},#12121a 70%)`;

  const actions = isMine
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
         ${!isActive ? `<button class="btn-primary" id="makeActiveBtn" data-cid="${esc(cid)}" type="button" style="font-size:13px;padding:9px 16px">Set as active</button>` : ''}
         <button class="btn-secondary" id="editChBtn" type="button" style="font-size:13px;padding:9px 16px">Edit channel</button>
       </div>`
    : `<button class="btn-sub ${subbed ? 'subbed' : ''}" data-action="sub" data-channel="${esc(cid)}" data-dyn="sub" type="button">${subbed ? 'Subscribed' : 'Subscribe'}</button>`;

  return `
    <div class="banner" style="${bannerStyle}"></div>
    <div class="chan-head">
      ${avatarHTML(c, 'lg')}
      <div class="txt">
        <h1>${esc(c.name)}</h1>
        <div class="meta">
          ${esc(c.handle)} ·
          <span data-dyn="subcount" data-channel="${esc(cid)}">${fmt(subsOf(cid))} subscribers</span> ·
          ${list.length} video${list.length === 1 ? '' : 's'}
        </div>
      </div>
      ${actions}
    </div>
    ${minis.length ? `
      <section class="shorts-shelf">
        <div class="shelf-head">
          <div class="icon"><svg viewBox="0 0 24 24"><path d="M13 2L4.5 13H11l-1 9L18.5 11H12z"/></svg></div>
          <h2>Minis</h2>
        </div>
        <div class="shorts-grid">${minis.map(shortCardHTML).join('')}</div>
      </section>` : ''}
    ${longs.length
      ? `<div class="grid">${longs.map(cardHTML).join('')}</div>`
      : (minis.length ? '' : emptyState('📭', 'No videos on this channel yet', 'When they upload, they\'ll appear here.', ''))}`;
}

function viewWatch(ctx, vid) {
  const {
    state, chanOf,
    isLiked, isDisliked, isSubbed,
    subsOf, likesOf, dislikesOf, viewsOf,
    videosSorted, playlistsOfUser,
    emptyState, PIXLECT, myChannel, isAdmin
  } = ctx;

  const v = state.videos[vid];
  if (!v) return emptyState('🚫', 'Video not found', 'It may have been removed.',
    `<a class="btn-ghost" href="#/">Go to Feed</a>`);

  const c = chanOf(vid);
  const liked = isLiked(vid);
  const disliked = isDisliked(vid);
  const subbed = isSubbed(c.id);
  const isMine = PIXLECT.user && v.createdBy === PIXLECT.user.uid;
  const canDelete = isMine || isAdmin();
  const canReport = PIXLECT.user && !isMine;

  const upNext = videosSorted().filter(x => x.id !== vid && (x.kind === 'mini') === (v.kind === 'mini'))
    .sort((a, b) => (b.channelId === c.id) - (a.channelId === c.id))
    .slice(0, 10);

  const userIcon = PIXLECT.user
    ? (myChannel()?.avatar
        ? `<span class="pic"><img src="${esc(myChannel().avatar)}" alt=""></span>`
        : `<span class="pic" style="background:${esc(myChannel()?.color || PIXLECT.user.icon?.bg || '#38bdf8')}">${esc(myChannel() ? initial(myChannel().name) : (PIXLECT.user.icon?.emoji || '👤'))}</span>`)
    : `<span class="pic" style="background:#2a2a36">👤</span>`;

  const commentForm = PIXLECT.user
    ? `<form class="comment-form" id="commentForm">
         ${userIcon}
         <div class="input-wrap">
           <textarea id="commentText" placeholder="Add a comment…" maxlength="2000"></textarea>
           <div class="actions">
             <button type="button" class="btn-secondary" id="commentCancel">Cancel</button>
             <button type="submit" class="btn-primary" id="commentSubmit" disabled>Comment</button>
           </div>
         </div>
       </form>`
    : `<div class="no-comments">Sign in with PIXLECT to join the conversation.</div>`;

  const myPls = playlistsOfUser();
  const plMenu = myPls.length
    ? `<div style="position:relative">
         <button class="pill" id="savePlBtn" type="button">
           <svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
           Save
         </button>
         <div id="savePlMenu" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:6px;min-width:220px;box-shadow:0 18px 50px rgba(0,0,0,.7);z-index:90">
           ${myPls.map(pl => `
             <button data-action="pl-add" data-pid="${esc(pl.id)}" data-vid="${esc(vid)}" type="button"
                     style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--text)">
               <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" opacity="0.7"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
               ${esc(pl.name)}
             </button>`).join('')}
           <div style="height:1px;background:var(--line);margin:6px 4px"></div>
           <button id="newPlBtn" type="button"
                   style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--text)">
             <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" opacity="0.7"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>
             New playlist
           </button>
         </div>
       </div>`
    : `<button class="pill" id="newPlBtn" type="button">
         <svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
         Save
       </button>`;

  const reportBtn = canReport
    ? `<button class="pill" data-action="report-video" data-video="${esc(vid)}" type="button">
         <svg viewBox="0 0 24 24"><path d="M12 2L1 21h22zM13 18h-2v-2h2zm0-4h-2V9h2z"/></svg>
         Report
       </button>` : '';

  const deleteBtn = canDelete
    ? `<button class="pill" data-action="del-video" data-video="${esc(vid)}" type="button" style="color:var(--accent)">
         <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
         Delete
       </button>` : '';

  const adminTag = isAdmin()
    ? `<span style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:10.5px;font-weight:800;letter-spacing:.5px;color:var(--warn);background:rgba(251,191,36,.12);padding:3px 8px;border-radius:99px;border:1px solid rgba(251,191,36,.35)">ADMIN</span>`
    : '';

  return `
  <div class="watch">
    <div>
      <div class="player">
        <div class="loading">Loading video…</div>
        <video data-vid="${esc(vid)}" controls autoplay playsinline referrerpolicy="origin" poster="${esc(v.thumb || '')}"></video>
        <button class="video-audio-toggle" data-action="mute" type="button" aria-label="Mute video" title="Mute video">
          <span aria-hidden="true">🔊</span><span class="audio-label">Sound on</span>
        </button>
      </div>
      <h1 class="w-title">${esc(v.title)}</h1>
      <div class="w-row">
        <div class="w-chan">
          ${avatarHTML(c, 'lg')}
          <div style="min-width:0">
            <a class="nm" href="#/channel/${esc(c.id)}">${esc(c.name)}</a>${adminTag}
            <div class="sb" data-dyn="subcount" data-channel="${esc(c.id)}">${fmt(subsOf(c.id))} subscribers</div>
          </div>
        </div>
        <button class="btn-sub ${subbed ? 'subbed' : ''}" data-action="sub" data-channel="${esc(c.id)}" data-dyn="sub" type="button">${subbed ? 'Subscribed' : 'Subscribe'}</button>
        <button class="pill ${liked ? 'active' : ''}" data-action="like" data-video="${esc(vid)}" data-dyn="like" type="button">
          <svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg>
          <span class="lbl">${fmt(likesOf(vid))}</span>
        </button>
        <button class="pill ${disliked ? 'active' : ''}" data-action="dislike" data-video="${esc(vid)}" data-dyn="dislike" type="button">
          <svg viewBox="0 0 24 24"><path d="M2 4h3v11H2zm19.8 9.4c0 .9-.7 1.6-1.6 1.6h-5l.8 3.9.03.3c0 .3-.1.6-.3.8L14.9 21l-5.5-5.6c-.3-.2-.4-.6-.4-.9V6c0-.9.7-1.6 1.6-1.6h7.2c.7 0 1.2.4 1.4 1l2.4 5.7c.1.2.1.4.1.6z"/></svg>
          <span class="lbl">${fmt(dislikesOf(vid))}</span>
        </button>
        ${plMenu}
        <button class="pill" data-action="share" data-video="${esc(vid)}" type="button">
          <svg viewBox="0 0 24 24"><path d="M14 9V5l7 7-7 7v-4.1C9.5 12.9 5.6 14.4 3 18c.5-4.5 2.9-8 11-9z"/></svg>
          Share
        </button>
        <button class="pill" data-action="${isOfflineDownloaded(vid) ? 'offline-remove' : 'offline-save'}" data-video="${esc(vid)}" type="button">
          ${isOfflineDownloaded(vid) ? 'Saved offline' : 'Download offline'}
        </button>
        ${reportBtn}
        ${deleteBtn}
      </div>
      <div class="desc">
        <span class="stats">
          <span data-dyn="views" data-video="${esc(vid)}">${fmt(viewsOf(vid))} views</span>
          · ${esc(timeAgo(v.createdAt))} · ${fmt(likesOf(vid))} likes · ${fmt(dislikesOf(vid))} dislikes
          · ${v.kind === 'mini' ? 'Mini' : 'Long'}
        </span>
        ${esc(v.desc || '')}
      </div>
      <section class="comments">
        <h2>Comments</h2>
        ${commentForm}
        <div class="comment-list" id="commentList"><div class="no-comments">Loading comments…</div></div>
      </section>
    </div>
    <aside class="upnext">
      <h2>Up next</h2>
      ${upNext.length ? upNext.map(x => {
        const xc = chanOf(x.id);
        return `<a class="mini-card" href="#/watch/${esc(x.id)}">
          <div class="t">${thumbHTML(x)}<span class="dur">${esc(x.dur)}</span></div>
          <div style="min-width:0">
            <h4>${esc(x.title)}</h4>
            <div class="sub">${esc(xc.name)}</div>
            <div class="sub">${fmt(x.views)} views · ${esc(timeAgo(x.createdAt))}</div>
          </div>
        </a>`;
      }).join('') : `<div class="no-comments">No other videos yet.</div>`}
    </aside>
  </div>`;
}

function setupCommentForm(ctx, vid) {
  const { createPlaylist, addToPlaylist, toast, addComment } = ctx;
  const form = document.getElementById('commentForm');
  if (form) {
    const ta = document.getElementById('commentText');
    const submit = document.getElementById('commentSubmit');
    const cancel = document.getElementById('commentCancel');
    ta.addEventListener('input', () => { submit.disabled = !ta.value.trim(); });
    cancel.addEventListener('click', () => { ta.value = ''; submit.disabled = true; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      submit.disabled = true;
      submit.textContent = 'Posting…';
      await addComment(vid, text);
      ta.value = '';
      submit.textContent = 'Comment';
    });
  }
  const saveBtn = document.getElementById('savePlBtn');
  const saveMenu = document.getElementById('savePlMenu');
  if (saveBtn && saveMenu) {
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveMenu.style.display = saveMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { saveMenu.style.display = 'none'; });
  }
  const newPlBtn = document.getElementById('newPlBtn');
  if (newPlBtn) {
    newPlBtn.addEventListener('click', () => {
      const name = prompt('Playlist name:');
      if (!name) return;
      createPlaylist(name).then((pid) => {
        if (!pid) return;
        addToPlaylist(pid, vid);
        toast('Saved to "' + name + '"');
        if (saveMenu) saveMenu.style.display = 'none';
      });
    });
  }
}

function viewMinis(ctx) {
  const { minisSorted, emptyState, hasChannel, PIXLECT } = ctx;
  const list = minisSorted();
  if (!list.length) {
    return emptyState('⚡', 'No Minis yet',
      PIXLECT.user ? (hasChannel() ? 'Upload a Mini to fill this feed.' : 'Create your channel to upload Minis.')
                  : 'Sign in with PIXLECT to upload Minis.',
      PIXLECT.user ? (hasChannel() ? `<a class="btn-ghost" href="#/create">Upload a Mini</a>`
                                   : `<button class="btn-primary" id="emptyCreateChannel" type="button">Create your PIXELChannel</button>`)
                   : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }
  return `
    <div class="page-head"><h1>Minis</h1><p>${list.length} Mini${list.length === 1 ? '' : 's'}</p></div>
    <div class="shorts-grid">${list.map(shortCardHTML).join('')}</div>`;
}

function viewMiniViewer(ctx, currentVid) {
  const { minisSorted, emptyState } = ctx;
  const list = minisSorted();
  if (!list.length) return emptyState('⚡', 'Mini not found', '', `<a class="btn-ghost" href="#/minis">Back to Minis</a>`);
  const exists = list.some(v => v.id === currentVid);
  const ordered = exists ? [list.find(v => v.id === currentVid), ...list.filter(v => v.id !== currentVid)] : list;
  return ordered.map(v => miniSectionHTML(v, ctx, true)).join('');
}

function miniSectionHTML(v, ctx, viewerMode) {
  const { chanOf, PIXLECT, isAdmin } = ctx;
  const c = chanOf(v.id);
  const isMine = PIXLECT.user && v.createdBy === PIXLECT.user.uid;
  const canDelete = isMine || isAdmin();
  const canReport = PIXLECT.user && !isMine;

  return `
    <section class="mini" data-mini="${esc(v.id)}" ${viewerMode ? `id="mini-${esc(v.id)}"` : ''}>
      <div class="mini-inner">
        <video data-vid="${esc(v.id)}" loop playsinline preload="metadata" referrerpolicy="origin" poster="${esc(v.thumb || '')}"></video>
        <div class="shade"></div>
        <button class="mute-btn" data-action="mute" type="button" aria-label="Turn video sound off" title="Turn video sound off">🔊</button>
        ${viewerMode ? `<a class="mini-close" href="#/minis" title="Back to Minis">✕</a>` : ''}

        <div class="rail">
          <button class="rail-btn" data-action="like" data-video="${esc(v.id)}" data-dyn="like" type="button">
            <span class="circ"><svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg></span>
            <span class="lbl">${fmt(v.likes)}</span>
          </button>
          <button class="rail-btn" data-action="sub" data-channel="${esc(c.id)}" data-dyn="sub" type="button">
            <span class="circ"><svg viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 4.5V21h16v-2.5C20 16 16 14 12 14z"/></svg></span>
          </button>
          <details class="mini-more">
            <summary class="rail-btn" aria-label="More video actions">
              <span class="circ more-circ">⋯</span>
              <span class="lbl">More</span>
            </summary>
            <div class="mini-more-menu">
              <button class="mini-more-item" data-action="dislike" data-video="${esc(v.id)}" data-dyn="dislike" type="button">
                <svg viewBox="0 0 24 24"><path d="M2 4h3v11H2zm19.8 9.4c0 .9-.7 1.6-1.6 1.6h-5l.8 3.9.03.3c0 .3-.1.6-.3.8L14.9 21l-5.5-5.6c-.3-.2-.4-.6-.4-.9V6c0-.9.7-1.6 1.6-1.6h7.2c.7 0 1.2.4 1.4 1l2.4 5.7c.1.2.1.4.1.6z"/></svg>
                <span>Dislike <span class="lbl">${fmt(v.dislikes)}</span></span>
              </button>
              <button class="mini-more-item" data-action="share" data-video="${esc(v.id)}" type="button">
                <svg viewBox="0 0 24 24"><path d="M14 9V5l7 7-7 7v-4.1C9.5 12.9 5.6 14.4 3 18c.5-4.5 2.9-8 11-9z"/></svg>
                <span>Share</span>
              </button>
              <button class="mini-more-item" data-action="${isOfflineDownloaded(v.id) ? 'offline-remove' : 'offline-save'}" data-video="${esc(v.id)}" type="button">
                <span class="more-download-icon">↓</span>
                <span>${isOfflineDownloaded(v.id) ? 'Remove download' : 'Download offline'}</span>
              </button>
              ${canReport ? `<button class="mini-more-item" data-action="report-video" data-video="${esc(v.id)}" type="button">
                <svg viewBox="0 0 24 24"><path d="M12 2L1 21h22zM13 18h-2v-2h2zm0-4h-2V9h2z"/></svg>
                <span>Report</span>
              </button>` : ''}
              ${canDelete ? `<button class="mini-more-item" data-action="del-video" data-video="${esc(v.id)}" type="button">
                <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
                <span>Delete</span>
              </button>` : ''}
            </div>
          </details>
        </div>

        <div class="bottom">
          <div class="ch">${avatarHTML(c, 'sm')}<a class="nm" href="#/channel/${esc(c.id)}">${esc(c.name)}</a></div>
          <h3>${esc(v.title)}</h3>
          <div class="views" data-dyn="views" data-video="${esc(v.id)}">${fmt(v.views)} views</div>
        </div>
      </div>
    </section>`;
}

let miniObserver = null;
function setupMinis(ctx) {
  const { registerView } = ctx;
  if (miniObserver) miniObserver.disconnect();
  const vids = document.querySelectorAll('.mini video');
  if (!vids.length) return;
  miniObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const v = en.target;
      if (!v.isConnected) return;
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        v.play().catch(() => {
          v.muted = true;
          updateVideoAudioButton(v);
          v.play().catch(() => {});
        });
        if (v.dataset.vid) registerView(v.dataset.vid);
      } else {
        v.pause();
      }
    });
  }, { threshold: [0, 0.6, 1] });
  vids.forEach(v => miniObserver.observe(v));
}

function resetMinisPagination() { /* no-op in this build */ }

function viewCreate() {
  if (!PIXLECT.user) {
    return emptyState('🎬', 'Sign in to upload',
      'You need a PIXLECT account to publish videos on PIXELTube.',
      `<button class="btn-primary" id="createSignIn" type="button">Sign in with PIXLECT</button>`);
  }

  const block = canCurrentUserUpload(CTX);
  if (block && block.reason === 'suspended') {
    const info = block.info || {};
    return emptyState('🚫', 'Your account is suspended',
      `Reason: ${esc(info.reason || 'Violation of community guidelines')}.`,
      `<a class="btn-ghost" href="#/guidelines">Read Community Guidelines</a>`);
  }

  const channels = myChannels();
  if (!channels.length) {
    return emptyState('🎬', 'Create your PIXELChannel first',
      'Before uploading, you need a PIXELChannel.',
      `<button class="btn-primary" id="createChannelBtn" type="button">Create PIXELChannel</button>`);
  }
  const ch = myChannel();
  const channelOptions = channels.map(c =>
    `<option value="${esc(c.id)}"${c.id === ch.id ? ' selected' : ''}>${esc(c.name)}</option>`
  ).join('');

  return `
    <div class="form-wrap">
      <h1>Upload to PIXELTube</h1>
      <p class="lede">Publishing to <b>${esc(ch.name)}</b>. By uploading, you agree to our <a href="#/guidelines" style="color:var(--accent)">Community Guidelines</a>.</p>
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
                <div class="dz-sub">MP4, WebM, or MOV — Longs and Minis up to 100 MB</div>
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
            <div class="empty" id="thumbPreviewEmpty">No thumbnail yet — upload a video to auto‑generate one.</div>
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
              <option value="long">Long</option>
              <option value="mini">Mini / Short</option>
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

  const doSubmit = async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createSubmit');

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
    btn.textContent = 'Uploading…';

    const vid = await createVideo({ title, src, thumb, kind, dur, desc, file });

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
function updateVideoAudioButton(video) {
  const button = video.closest('.mini, .player')?.querySelector('.mute-btn, .video-audio-toggle');
  if (!button) return;
  const muted = video.muted || video.volume === 0;
  const label = muted ? 'Turn video sound on' : 'Turn video sound off';
  if (button.classList.contains('video-audio-toggle')) {
    const icon = button.querySelector('[aria-hidden="true"]');
    const text = button.querySelector('.audio-label');
    if (icon) icon.textContent = muted ? '🔇' : '🔊';
    if (text) text.textContent = muted ? 'Sound off' : 'Sound on';
  } else {
    button.textContent = muted ? '🔇' : '🔊';
  }
  button.title = label;
  button.setAttribute('aria-label', label);
}

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
    await setActiveChannel(e.target.dataset.cid);
    renderTopbar();
    renderSidebar();
    render(true);
    return;
  }
  if (e.target.id === 'editChBtn') {
    promptEditChannel(CTX);
    return;
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  const moreMenu = el.closest('.mini-more');
  if (moreMenu) moreMenu.open = false;
  if (action === 'menu') { e.preventDefault(); document.body.classList.toggle('nav-open'); return; }
  if (action === 'like')    { e.preventDefault(); e.stopPropagation(); toggleLike(el.dataset.video); return; }
  if (action === 'dislike') { e.preventDefault(); e.stopPropagation(); toggleDislike(el.dataset.video); return; }
  if (action === 'sub')     { e.preventDefault(); e.stopPropagation(); toggleSub(el.dataset.channel); return; }
  if (action === 'mute') {
    e.preventDefault();
    e.stopPropagation();
    const player = el.closest('.mini, .player');
    if (!player) return;
    const v = player.querySelector('video');
    if (!v) return;
    if (v.muted || v.volume === 0) {
      v.muted = false;
      if (v.volume === 0) v.volume = 1;
    } else {
      v.muted = true;
    }
    updateVideoAudioButton(v);
    return;
  }
  if (action === 'share') {
    e.preventDefault();
    const url = location.origin + location.pathname + '#/watch/' + el.dataset.video;
    navigator.clipboard?.writeText(url).then(() => toast('Link copied'), () => toast(url));
    return;
  }
  if (action === 'offline-save') {
    e.preventDefault();
    const previousContent = el.innerHTML;
    el.disabled = true;
    el.textContent = 'Saving…';
    try {
      const vid = el.dataset.video;
      const sourceUrl = await storage.resolvePlaybackUrl(CTX, vid);
      if (!sourceUrl) throw new Error('Video source is unavailable.');
      await saveOfflineVideo(state.videos[vid], chanOf(vid), sourceUrl);
      toast('Video saved for offline playback');
      render(true);
    } catch (error) {
      console.error('[main.js] offline download failed:', error);
      toast(error.message || 'Could not save this video offline');
      el.disabled = false;
      el.innerHTML = previousContent;
    }
    return;
  }
  if (action === 'offline-remove') {
    e.preventDefault();
    try {
      await removeOfflineVideo(el.dataset.video);
      applyData(lastData || {});
      render(true);
      toast('Offline download removed');
    } catch (error) {
      console.error('[main.js] could not remove offline download:', error);
      toast('Could not remove offline download');
    }
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
          status: 'resolved', resolvedAt: Date.now(),
          resolvedBy: PIXLECT.user.username, action: 'dismissed'
        });
        toast('Report dismissed'); render(true);
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
          status: 'resolved', resolvedAt: Date.now(),
          resolvedBy: PIXLECT.user.username, action: 'deleted-video'
        });
      } catch (_) {}
      toast('Video deleted and report resolved'); render(true);
    })();
    return;
  }
  if (action === 'admin-suspend') {
    e.preventDefault();
    const reason = prompt('Reason for suspension:');
    if (!reason) return;
    (async () => {
      const ok = await suspendChannel(CTX, el.dataset.cid, reason);
      if (!ok) return;
      if (el.dataset.rid) {
        try {
          await update(ref(db, `pixeltube/reports/${el.dataset.rid}`), {
            status: 'resolved', resolvedAt: Date.now(),
            resolvedBy: PIXLECT.user.username, action: 'suspended-channel'
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
    deleteVideo(el.dataset.vid).then(() => { toast('Video deleted'); render(true); });
    return;
  }
  if (action === 'admin-unsuspend') {
    e.preventDefault();
    unsuspendChannel(CTX, el.dataset.cid).then(ok => { if (ok) render(true); });
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
  if (e.target.id === 'studioCreateChannel') promptCreateChannel(CTX);
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

function wireSearchInput() {
  const input = document.getElementById('searchInput');
  if (!input) return;
  let debounce = null;
  input.addEventListener('input', (e) => {
    state.search = e.target.value;
    if (state.route[0] !== 'home' && state.search.trim()) location.hash = '#/';
    else render(true);
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = state.search.trim();
      if (q.length >= 2) pushSearchHistory(q);
    }, 900);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = state.search.trim();
      if (q.length >= 2) pushSearchHistory(q);
    }
  });
}
function wireClearHistory() {
  document.addEventListener('click', (e) => {
    if (e.target.id === 'clearHistoryBtn') {
      clearSearchHistory();
      toast('Search history cleared');
      render(true);
    }
  });
}

wireSearchInput();
wireClearHistory();

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length ? parts : ['home'];
}

window.addEventListener('hashchange', () => {
  clearOfflinePlaybackUrls();
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
  state.route = parseRoute();
  document.body.classList.remove('nav-open');
  render(true);
});

console.log('[main.js] bootstrapping PIXELTube');

/* Force Studio / Admin route when loaded as creator.html / admin.html */
if (document.body.dataset.page === 'creator') {
  location.hash = '#/studio';
}
if (document.body.dataset.page === 'admin') {
  location.hash = '#/admin';
}

state.route = parseRoute();
renderTopbar();
renderSidebar();
render(true);
boot();
