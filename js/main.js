import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, onValue, get, set, remove, update, runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import {
  $, $$, esc, fmt, fmtBytes, timeAgo, initial,
  avatarHTML, thumbHTML, captureThumbnailFromFile, resizeImageFile,
  parseDuration
} from './helpers.js';

import {
  viewHome, viewSubs, viewLiked, viewPlaylists, viewPlaylist
} from './feed.js';

import {
  viewMiniViewer, viewMinis, setupMinis
} from './video_mini.js';

import {
  viewWatch, setupCommentForm
} from './video_large.js';

import {
  viewChannel, promptCreateChannel, promptEditChannel
} from './channel.js';

/* ============================================================
   FIREBASE CONFIG
   ============================================================ */
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBLc2W7w4F0XSnsNlHbmlaSyM982Ha2bhM",
  authDomain: "the-amazing-digital-fanbase.firebaseapp.com",
  databaseURL: "https://the-amazing-digital-fanbase-default-rtdb.firebaseio.com",
  projectId: "the-amazing-digital-fanbase",
  storageBucket: "the-amazing-digital-fanbase.firebasestorage.app",
  messagingSenderId: "899632202736",
  appId: "1:899632202736:web:3b6de3d2e312bd6d6b5335"
};

/* ============================================================
   SUPABASE CONFIG (Longs only)
   ============================================================ */
const SUPABASE_URL      = 'https://finuvmxyymhfvmscmgac.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_UAbpVV0jSe2h6aPkbYEgtw_kWzaT7qt';
const SUPABASE_BUCKET   = 'PIXELTUBE_VIDEOS';

const MAX_LONG_BYTES   = 50 * 1024 * 1024;   // 50 MB
const MAX_MINI_BYTES   = 8  * 1024 * 1024;   // 8 MB
const MAX_LONG_SECONDS = 8 * 60;             // 8 minutes
const MAX_MINI_SECONDS = 60;                 // 1 minute

let supa = null;
try {
  supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
  console.log('[main.js] Supabase client ready');
} catch (e) {
  console.warn('[main.js] Supabase client failed:', e);
}

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

function getLocalUid() {
  let u = localStorage.getItem('pixeltube_uid');
  if (!u) {
    u = 'u_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    localStorage.setItem('pixeltube_uid', u);
  }
  return u;
}

function pixlectSignIn() {
  console.log('[main.js] pixlectSignIn called');
  const w = 520, h = 640;
  const left = (screen.width - w) / 2;
  const top  = (screen.height - h) / 2;
  window.open(PIXLECT.AUTH_URL, 'pixlect-auth',
    `width=${w},height=${h},left=${left},top=${top},popup=yes,resizable=yes,scrollbars=yes`);
}

function pixlectSignOut() {
  console.log('[main.js] pixlectSignOut called');
  PIXLECT.user = null;
  localStorage.removeItem('pixeltube_pixlect');
  state.uid = getLocalUid();
  reloadUserScopedData();
  renderTopbar();
  renderSidebar();
  render(true);
  toast('Signed out');
}

function handlePixlectMessage(d) {
  if (!d || typeof d !== 'object') return false;
  console.log('[main.js] [PIXLECT] message received:', d);

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
  renderTopbar();
  renderSidebar();
  render(true);
  toast('Signed in as ' + clean.username);
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
  videos: {}, channels: {}, playlists: {}, subs: {}, likes: {},
  search: '', route: ['home'],
  viewedThisSession: new Set()
};

let db = null;
let localDB = null;
let lastData = null;
let commentsUnsub = null;
const srcCache = {};

/* ============================================================
   DERIVED HELPERS
   ============================================================ */
const subsOf   = cid => (state.channels[cid]?.subs) || 0;
const likesOf  = vid => (state.videos[vid]?.likes) || 0;
const viewsOf  = vid => (state.videos[vid]?.views) || 0;
const isSubbed = cid => !!state.subs[cid];
const isLiked  = vid => !!state.likes[vid];
const chanOf   = vid => state.channels[state.videos[vid]?.channelId] || { name: 'Unknown', color: '#555' };

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
  console.log('[main.js] openModal called, html length =', html?.length);
  const root = $('#modalRoot');
  if (!root) {
    console.error('[main.js] #modalRoot not found!');
    return;
  }
  root.innerHTML = `<div class="modal-backdrop" data-modal-backdrop>
    <div class="modal-wrap"><div class="modal">${html}</div></div></div>`;
  console.log('[main.js] modal injected. modalRoot.innerHTML length =', root.innerHTML.length);
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
   CHANNEL HELPERS
   ============================================================ */
const myChannelId = () => PIXLECT.user ? ('pl_' + PIXLECT.user.uid) : null;
const myChannel = () => { const c = myChannelId(); return c ? state.channels[c] : null; };
const hasChannel = () => !!myChannel();

async function createOrUpdateChannel(data) {
  console.log('[main.js] createOrUpdateChannel called with', data);
  const cid = myChannelId();
  if (!cid) {
    console.warn('[main.js] no channel id — not signed in?');
    return;
  }
  const existing = state.channels[cid] || {};
  const ch = {
    id: cid,
    name: data.name || existing.name || PIXLECT.user.username,
    handle: data.handle || existing.handle || ('@' + PIXLECT.user.username),
    color: data.color || existing.color || (PIXLECT.user.icon?.bg || '#38bdf8'),
    avatar: data.avatar !== undefined ? data.avatar : (existing.avatar || ''),
    banner: data.banner !== undefined ? data.banner : (existing.banner || ''),
    subs: existing.subs || 0,
    ownerUid: PIXLECT.user.uid,
    createdAt: existing.createdAt || Date.now()
  };
  console.log('[main.js] writing channel to', `pixeltube/channels/${cid}`);

  if (state.mode === 'firebase' && db) {
    try {
      await set(ref(db, `pixeltube/channels/${cid}`), ch);
      console.log('[main.js] channel write succeeded');
    } catch (e) {
      console.error('[main.js] channel write FAILED', e);
      toast('Could not save channel: ' + (e?.message || e));
      throw e;
    }
  } else if (state.mode === 'local' && localDB) {
    localDB.channels[cid] = ch;
    persistLocal();
    applyData(localDB);
    console.log('[main.js] channel saved to localStorage');
  }
}

/* ============================================================
   DATA LAYER
   ============================================================ */
async function boot() {
  console.log('[main.js] boot()');
  setLoaderStatus('Connecting to Firebase…');
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getDatabase(app);
    state.mode = 'firebase';
    console.log('[main.js] Firebase initialized');

    await new Promise((resolve) => {
      let done = false;
      const rootRef = ref(db, 'pixeltube');
      onValue(rootRef,
        s => {
          applyData(s.val() || {});
          if (!done) {
            done = true;
            setLoaderStatus('Loaded.');
            setTimeout(hideLoader, 250);
            resolve();
          }
        },
        err => {
          console.warn('[main.js] stream error:', err);
          if (!done) {
            done = true;
            setLoaderStatus('Using offline mode…');
            setTimeout(() => { bootLocal(); hideLoader(); }, 400);
            resolve();
          }
        }
      );
      setTimeout(() => {
        if (!done) {
          done = true;
          setLoaderStatus('Slow connection — loading anyway…');
          hideLoader();
          resolve();
        }
      }, 6000);
    });

    setStatus();
    console.log('[main.js] boot complete');
  } catch (e) {
    console.warn('[main.js] Firebase unavailable → local mode.', e);
    setLoaderStatus('Offline mode.');
    bootLocal();
    setTimeout(hideLoader, 400);
  }
}

function bootLocal() {
  console.log('[main.js] bootLocal()');
  state.mode = 'local';
  let raw = null;
  try { raw = JSON.parse(localStorage.getItem('pixeltube_db') || 'null'); } catch (_) {}
  if (!raw) raw = { channels: {}, videos: {}, videoSrc: {}, users: {}, comments: {}, playlists: {} };
  localDB = raw;
  applyData(localDB);
  setStatus();
  hideLoader();
}

function persistLocal() {
  try { localStorage.setItem('pixeltube_db', JSON.stringify(localDB)); } catch (_) {}
}

function applyData(d) {
  lastData = d;
  state.videos    = d.videos    || {};
  state.channels  = d.channels  || {};
  state.playlists = d.playlists || {};
  const u = (d.users && d.users[state.uid]) || {};
  state.subs  = u.subs  || {};
  state.likes = u.likes || {};
  renderSidebar();
  render();
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
    } catch (e) { console.warn(e); toast('Could not update subscription'); }
  } else {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    const s = u.subs || (u.subs = {});
    if (on) delete s[cid]; else s[cid] = true;
    const ch = localDB.channels[cid];
    if (ch) ch.subs = Math.max(0, (Number(ch.subs) || 0) + delta);
    persistLocal();
    applyData(localDB);
    toast(on ? 'Unsubscribed' : 'Subscribed 🔔');
  }
}

async function toggleLike(vid) {
  if (!vid) return;
  if (!PIXLECT.user) { toast('Sign in with PIXLECT to like'); pixlectSignIn(); return; }
  const on = isLiked(vid), delta = on ? -1 : 1;

  if (state.mode === 'firebase') {
    try {
      const p = `pixeltube/users/${state.uid}/likes/${vid}`;
      if (on) await remove(ref(db, p)); else await set(ref(db, p), true);
      await runTransaction(ref(db, `pixeltube/videos/${vid}/likes`),
        n => Math.max(0, (Number(n) || 0) + delta));
    } catch (e) { console.warn(e); toast('Could not update like'); }
  } else {
    const u = localDB.users[state.uid] || (localDB.users[state.uid] = {});
    const l = u.likes || (u.likes = {});
    if (on) delete l[vid]; else l[vid] = true;
    const v = localDB.videos[vid];
    if (v) v.likes = Math.max(0, (Number(v.likes) || 0) + delta);
    persistLocal();
    applyData(localDB);
  }
}

async function registerView(vid) {
  if (!vid || state.viewedThisSession.has(vid)) return;
  state.viewedThisSession.add(vid);

  if (state.mode === 'firebase' && db) {
    try { await runTransaction(ref(db, `pixeltube/videos/${vid}/views`), n => (Number(n) || 0) + 1); }
    catch (e) { console.warn('view increment failed', e); }
  } else if (state.mode === 'local' && localDB) {
    const v = localDB.videos[vid];
    if (v) { v.views = (Number(v.views) || 0) + 1; persistLocal(); applyData(localDB); }
  }
}

async function fetchVideoSrc(vid) {
  if (srcCache[vid] !== undefined) return srcCache[vid];
  if (state.mode === 'firebase' && db) {
    try { srcCache[vid] = (await get(ref(db, `pixeltube/videoSrc/${vid}`))).val() || ''; }
    catch (e) { srcCache[vid] = ''; }
  } else if (localDB) {
    srcCache[vid] = (localDB.videoSrc && localDB.videoSrc[vid]) || '';
  } else srcCache[vid] = '';
  return srcCache[vid];
}

async function hydrateVideosInView(root) {
  const vids = $$('video[data-vid]', root || document);
  await Promise.all(vids.map(async (v) => {
    const vid = v.dataset.vid;
    if (v.dataset.hydrated === '1') return;
    v.dataset.hydrated = '1';
    const src = await fetchVideoSrc(vid);
    if (src) {
      v.src = src;
      const loading = v.parentElement.querySelector('.loading');
      if (loading) loading.remove();
    } else {
      const loading = v.parentElement.querySelector('.loading');
      if (loading) loading.textContent = 'Video source unavailable';
      v.remove();
    }
  }));
}

/* ============================================================
   CREATE VIDEO — Longs → Supabase, Shorts → Firebase
   ============================================================ */
async function createVideo(payload) {
  if (!PIXLECT.user) { toast('Sign in to upload'); pixlectSignIn(); return null; }
  if (!hasChannel()) { promptCreateChannel(CTX); return null; }

  const cid = myChannelId();
  const vid = 'v_' + Math.random().toString(36).slice(2, 10);
  const isLong = payload.kind !== 'mini';

  let storedSrc = payload.src;

  if (isLong && payload.file) {
    if (!supa) { toast('Supabase client not ready'); return null; }
    const ext = (payload.file.name.split('.').pop() || 'mp4').toLowerCase();
    const path = `${PIXLECT.user.uid}/${vid}.${ext}`;

    console.log('[main.js] Supabase upload →', path, '(' + fmtBytes(payload.file.size) + ')');

    const { data, error } = await supa.storage
      .from(SUPABASE_BUCKET)
      .upload(path, payload.file, {
        cacheControl: '3600',
        upsert: false,
        contentType: payload.file.type || 'video/mp4'
      });

    if (error) {
      console.error('[main.js] Supabase upload FAILED', error);
      toast('Upload failed: ' + error.message);
      return null;
    }

    const { data: pub } = supa.storage.from(SUPABASE_BUCKET).getPublicUrl(path);
    storedSrc = pub?.publicUrl || '';
    console.log('[main.js] Supabase URL:', storedSrc);

    if (!storedSrc) { toast('Could not get public URL'); return null; }
  }

  const meta = {
    id: vid, title: payload.title, channelId: cid, kind: payload.kind,
    thumb: payload.thumb || '', dur: payload.dur || '0:00',
    views: 0, likes: 0, desc: payload.desc || '',
    createdAt: Date.now(), createdBy: PIXLECT.user.uid
  };

  if (state.mode === 'firebase') {
    try {
      await set(ref(db, `pixeltube/videos/${vid}`), meta);
      await set(ref(db, `pixeltube/videoSrc/${vid}`), storedSrc);
      srcCache[vid] = storedSrc;
      return vid;
    } catch (e) {
      console.warn('createVideo failed', e);
      toast('Publish failed: ' + (e?.message || e));
      try { await remove(ref(db, `pixeltube/videos/${vid}`)); } catch (_) {}
      return null;
    }
  } else {
    localDB.videos[vid] = meta;
    localDB.videoSrc = localDB.videoSrc || {};
    localDB.videoSrc[vid] = storedSrc;
    srcCache[vid] = storedSrc;
    persistLocal();
    applyData(localDB);
    return vid;
  }
}

async function deleteVideo(vid) {
  if (state.mode === 'firebase' && db) {
    try {
      await remove(ref(db, `pixeltube/videos/${vid}`));
      await remove(ref(db, `pixeltube/videoSrc/${vid}`));
    } catch (e) { console.warn(e); toast('Could not delete'); }
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
    catch (e) { console.warn(e); toast('Could not post comment'); }
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
  if (!list.length) {
    target.innerHTML = `<div class="no-comments">No comments yet. Be the first!</div>`;
    return;
  }
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
    id: pid,
    name: name.trim().slice(0, 80) || 'Untitled playlist',
    ownerUid: PIXLECT.user.uid,
    ownerName: PIXLECT.user.username,
    videoIds: {},
    createdAt: Date.now()
  };
  if (state.mode === 'firebase' && db) {
    try { await set(ref(db, `pixeltube/playlists/${pid}`), pl); return pid; }
    catch (e) { console.warn(e); toast('Could not create playlist'); return null; }
  } else if (localDB) {
    localDB.playlists = localDB.playlists || {};
    localDB.playlists[pid] = pl;
    persistLocal();
    applyData(localDB);
    return pid;
  }
  return null;
}

async function deletePlaylist(pid) {
  if (state.mode === 'firebase' && db) {
    try { await remove(ref(db, `pixeltube/playlists/${pid}`)); } catch (e) { console.warn(e); }
  } else if (localDB) {
    delete localDB.playlists[pid];
    persistLocal();
    applyData(localDB);
  }
}

async function addToPlaylist(pid, vid) {
  if (state.mode === 'firebase' && db) {
    try { await set(ref(db, `pixeltube/playlists/${pid}/videoIds/${vid}`), true); }
    catch (e) { console.warn(e); toast('Could not add to playlist'); }
  } else if (localDB) {
    localDB.playlists[pid].videoIds = localDB.playlists[pid].videoIds || {};
    localDB.playlists[pid].videoIds[vid] = true;
    persistLocal();
    applyData(localDB);
  }
}

async function removeFromPlaylist(pid, vid) {
  if (state.mode === 'firebase' && db) {
    try { await remove(ref(db, `pixeltube/playlists/${pid}/videoIds/${vid}`)); } catch (e) { console.warn(e); }
  } else if (localDB) {
    if (localDB.playlists[pid].videoIds) delete localDB.playlists[pid].videoIds[vid];
    persistLocal();
    applyData(localDB);
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
  state,
  PIXLECT,
  get db()      { return db; },
  get localDB() { return localDB; },
  get supa()    { return supa; },
  SUPABASE_BUCKET,

  subsOf, likesOf, viewsOf, isSubbed, isLiked, chanOf,
  videosSorted, minisSorted, longsSorted,

  myChannelId, myChannel, hasChannel, createOrUpdateChannel,

  toggleSub, toggleLike, registerView, createVideo, deleteVideo,
  addComment,
  createPlaylist, deletePlaylist, addToPlaylist, removeFromPlaylist,
  playlistsOfUser, playlistVideos,

  pixlectSignIn, toast, openModal, closeModal,
  renderTopbar, renderSidebar, render,
  persistLocal, applyData, remove, ref,

  get route() { return state.route; }
};

window.__CTX = CTX;
window.__PIXLECT = PIXLECT;
window.__state = state;

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
  console.log('[main.js] renderTopbar() — user?', !!PIXLECT.user);
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
      ? `<span class="pic" style="background:${esc(ch.color)}">${esc(initial(ch.name))}</span>`
      : `<span class="pic" style="background:${esc(u.icon?.bg || '#38bdf8')}">${esc(u.icon?.emoji || '👤')}</span>`;

  const channelBlock = ch
    ? `<button id="menuEditChannel" type="button">
         <svg viewBox="0 0 24 24"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75z"/></svg>
         Edit PIXELChannel
       </button>
       <a href="#/channel/${esc(ch.id)}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;border-radius:9px;font-size:13.5px;font-weight:600" id="menuViewChannel">
         <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" opacity="0.8"><path d="M12 5c-7 0-10 7-10 7s3 7 10 7 10-7 10-7-3-7-10-7zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8z"/></svg>
         View my channel
       </a>`
    : `<button id="menuCreateChannel" type="button">
         <svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>
         Create PIXELChannel
       </button>`;

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
          <small>@${esc(u.username)} · ${ch ? 'PIXELChannel' : 'No channel'}</small>
        </div>
      </div>
      ${channelBlock}
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

  const so = $('#menuSignOut');
  if (so) so.onclick = () => { menu.classList.remove('open'); pixlectSignOut(); };

  document.addEventListener('click', () => menu.classList.remove('open'));
}

/* ============================================================
   SIDEBAR
   ============================================================ */
const ICONS = {
  home:   '<svg viewBox="0 0 24 24"><path d="M12 3l9 8h-3v9h-5v-6h-2v6H6v-9H3z"/></svg>',
  mini:   '<svg viewBox="0 0 24 24"><path d="M13 2L4.5 13H11l-1 9L18.5 11H12z"/></svg>',
  subs:   '<svg viewBox="0 0 24 24"><path d="M4 6h16v2H4zm0 5h16v2H4zm0 5h10v2H4z"/><circle cx="18" cy="16" r="3"/></svg>',
  like:   '<svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg>',
  create: '<svg viewBox="0 0 24 24"><path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11z"/></svg>'
};

function renderSidebar() {
  const [page] = state.route;
  const subIds = Object.keys(state.subs);
  const likeCount = Object.keys(state.likes).length;
  const miniCount = minisSorted().length;
  const myPls = playlistsOfUser();

  const userBlock = PIXLECT.user ? `
    <div class="side-user">
      ${myChannel()
        ? (myChannel().avatar
            ? `<span class="pic"><img src="${esc(myChannel().avatar)}" alt=""></span>`
            : `<span class="pic" style="background:${esc(myChannel().color)}">${esc(initial(myChannel().name))}</span>`)
        : `<span class="pic" style="background:${esc(PIXLECT.user.icon?.bg || '#38bdf8')}">${esc(PIXLECT.user.icon?.emoji || '👤')}</span>`}
      <div class="t">
        <strong>${esc(myChannel() ? myChannel().name : PIXLECT.user.username)}</strong>
        <small>${myChannel() ? 'PIXELChannel' : 'No channel'}</small>
      </div>
    </div>
    ${!myChannel() ? `<button class="btn-primary" style="margin:8px 4px 0;width:calc(100% - 8px)" id="sideCreateChannel" type="button">Create PIXELChannel</button>` : ''}
  ` : `<div class="side-note">Not signed in.<br>Sign in to upload, like, and comment.</div>`;

  const sb = $('#sidebar');
  if (!sb) return;

  sb.innerHTML = `
    <a class="nav ${page === 'home' ? 'active' : ''}" href="#/">${ICONS.home} Home</a>
    <a class="nav ${page === 'minis' ? 'active' : ''}" href="#/minis">${ICONS.mini} Minis <span class="count">${miniCount || ''}</span></a>
    <a class="nav ${page === 'subs' ? 'active' : ''}" href="#/subs">${ICONS.subs} Subscriptions <span class="count">${subIds.length || ''}</span></a>
    <a class="nav ${page === 'liked' ? 'active' : ''}" href="#/liked">${ICONS.like} Liked <span class="count">${likeCount || ''}</span></a>
    <a class="nav ${page === 'create' ? 'active' : ''}" href="#/create">${ICONS.create} Create</a>

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

  if      (page === 'home')      view.innerHTML = viewHome(CTX);
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
  else                           view.innerHTML = viewHome(CTX);

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
  if (!hasChannel()) {
    return emptyState('🎬', 'Create your PIXELChannel first',
      'Before uploading, you need a PIXELChannel. It takes ten seconds.',
      `<button class="btn-primary" id="createChannelBtn" type="button">Create PIXELChannel</button>`);
  }
  const ch = myChannel();
  return `
    <div class="form-wrap">
      <h1>Upload to PIXELTube</h1>
      <p class="lede">Publish to <b>${esc(ch.name)}</b>. <b>Longs</b> (up to 8 min / 50 MB) go to Supabase Storage. <b>Shorts / Minis</b> (up to 1 min / 8 MB) go to Firebase.</p>
      <form id="createForm" autocomplete="off">
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
              <option value="long">Long (Supabase · up to 8 min / 50 MB)</option>
              <option value="mini">Mini / Short (Firebase · up to 1 min / 8 MB)</option>
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
      sizeWarn.innerHTML = `⚠️ <b>${fmtBytes(pickedFile.size)}</b> is above the ${fmtBytes(lim.bytes)} limit for ${kindSelect.value === 'mini' ? 'Minis' : 'Longs'}.`;
      return false;
    }
    if (pickedDuration && pickedDuration > lim.seconds + 1) {
      const m = Math.floor(pickedDuration / 60);
      const s = Math.round(pickedDuration % 60);
      sizeWarn.style.display = '';
      sizeWarn.innerHTML = `⚠️ Video is ${m}:${String(s).padStart(2, '0')} — the limit for ${kindSelect.value === 'mini' ? 'Minis' : 'Longs'} is ${Math.floor(lim.seconds / 60)} min.`;
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
        autoNote.innerHTML = `<span style="color:var(--warn)">⚠️ Could not capture a frame. Pick an image instead.</span>`;
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('createSubmit');
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

    if (file && kind === 'mini') {
      btn.disabled = true;
      btn.textContent = 'Encoding…';
      src = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => resolve('');
        r.readAsDataURL(file);
      });
      if (!src) { toast('Could not read file'); btn.disabled = false; btn.textContent = 'Publish'; return; }
    }

    const thumb = currentThumb();
    btn.disabled = true;
    btn.textContent = kind === 'mini' ? 'Saving to Firebase…' : 'Uploading to Supabase…';

    const vid = await createVideo({
      title, src, thumb, kind, dur, desc,
      file: kind === 'mini' ? null : file
    });

    if (vid) {
      toast('Video published 🎉');
      location.hash = '#/watch/' + vid;
    } else {
      btn.disabled = false;
      btn.textContent = 'Publish';
    }
  });
}

/* ============================================================
   GLOBAL EVENTS
   ============================================================ */
window.addEventListener('pixeltube:signin', pixlectSignIn);

document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'menu') { e.preventDefault(); document.body.classList.toggle('nav-open'); return; }
  if (action === 'like') { e.preventDefault(); e.stopPropagation(); toggleLike(el.dataset.video); return; }
  if (action === 'sub')  { e.preventDefault(); e.stopPropagation(); toggleSub(el.dataset.channel); return; }
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
  if (action === 'del-video') {
    e.preventDefault();
    if (!confirm('Delete this video permanently?')) return;
    deleteVideo(el.dataset.video).then(() => { location.hash = '#/'; toast('Video deleted'); });
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
  if (e.target.id === 'editChBtn') promptEditChannel(CTX);
});

$('#searchInput').addEventListener('input', e => {
  state.search = e.target.value.trim();
  if (state.route[0] !== 'home' && state.search) location.hash = '#/';
  else render(true);
});

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length ? parts : ['home'];
}

window.addEventListener('hashchange', () => {
  if (commentsUnsub) { commentsUnsub(); commentsUnsub = null; }
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