/* ============================================================
   PIXELTube — helpers.js
   Utility functions used across every module.
   Fixed: avatar fallback, sub count fallback, thumb fallback.
   ============================================================ */

export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export const initial = s => {
  const str = String(s ?? '').trim();
  return str ? str.charAt(0).toUpperCase() : '?';
};

export function fmt(n) {
  n = Number(n) || 0;
  if (n >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(n);
}

export function fmtBytes(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1048576).toFixed(1) + ' MB';
}

export function timeAgo(ts) {
  if (!ts) return 'just now';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 2592000) return Math.floor(s / 86400) + 'd ago';
  if (s < 31536000) return Math.floor(s / 2592000) + 'mo ago';
  return Math.floor(s / 31536000) + 'y ago';
}

export function parseDuration(str) {
  if (!str) return 0;
  const parts = String(str).split(':').map(p => parseInt(p, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

/* ============================================================
   AVATAR — three-tier fallback so nothing ever disappears
   Tier 1: avatar image URL
   Tier 2: solid color + first letter
   Tier 3: neutral gray + ? (only if color and name are both missing)
   ============================================================ */
const AVATAR_COLORS = [
  '#38bdf8', '#f472b6', '#fbbf24', '#34d399',
  '#a78bfa', '#f87171', '#22d3ee', '#fb923c'
];

function colorForChannel(c) {
  /* Prefer explicit color from channel record */
  if (c && c.color && typeof c.color === 'string' && c.color.trim()) {
    return c.color;
  }
  /* Derive a stable color from the channel name so it's never random */
  const name = (c && c.name) ? String(c.name) : '';
  if (!name) return '#8b98b8';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function avatarHTML(c, cls = '') {
  /* Guard: channel object might be missing entirely */
  if (!c || typeof c !== 'object') {
    return `<span class="avatar ${cls}" style="background:#8b98b8;color:#fff">?</span>`;
  }

  const avatarUrl = (c.avatar || '').trim();
  const name = (c.name || '').trim();
  const color = colorForChannel(c);
  const letter = initial(name);

  /* Tier 1 — real avatar image */
  if (avatarUrl && (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:'))) {
    return `<span class="avatar ${cls}"><img src="${esc(avatarUrl)}" alt="" loading="lazy" onerror="this.parentElement.innerHTML='${esc(letter)}';this.parentElement.style.background='${esc(color)}';this.parentElement.style.color='#0b0b0f'"></span>`;
  }

  /* Tier 2 — colored initial */
  return `<span class="avatar ${cls}" style="background:${esc(color)};color:#0b0b0f">${esc(letter)}</span>`;
}

/* ============================================================
   USER AVATAR — for the current signed-in user
   ============================================================ */
export function userAvatarHTML(user, cls = '') {
  if (!user) {
    return `<span class="avatar ${cls}" style="background:#8b98b8;color:#fff">?</span>`;
  }

  const icon = user.icon || {};
  const avatarUrl = (icon.avatar || '').trim();
  const emoji = icon.emoji || '👤';
  const bg = icon.bg || '#38bdf8';

  if (avatarUrl && (avatarUrl.startsWith('http') || avatarUrl.startsWith('data:'))) {
    return `<span class="avatar ${cls}"><img src="${esc(avatarUrl)}" alt="" loading="lazy"></span>`;
  }

  const display = emoji || initial(user.username);
  return `<span class="avatar ${cls}" style="background:${esc(bg)};color:#0a0e1a">${esc(display)}</span>`;
}

/* ============================================================
   THUMBNAIL — three-tier fallback
   Tier 1: real thumbnail image
   Tier 2: gradient placeholder with a film emoji
   Tier 3: plain dark block (only if the parent element is gone)
   ============================================================ */
export function thumbHTML(v) {
  const thumbUrl = (v && v.thumb) ? String(v.thumb).trim() : '';

  if (thumbUrl && (thumbUrl.startsWith('http') || thumbUrl.startsWith('data:'))) {
    return `<img src="${esc(thumbUrl)}" alt="" loading="lazy"
                 crossorigin="anonymous" referrerpolicy="no-referrer"
                 onerror="this.parentElement.insertAdjacentHTML('beforeend','<div class=\\'placeholder\\'>🎬</div>');this.remove()">`;
  }

  return `<div class="placeholder">🎬</div>`;
}

/* ============================================================
   SUBSCRIBER COUNT — always returns a number, never undefined
   ============================================================ */
export function subsCount(c) {
  if (!c || typeof c !== 'object') return 0;
  const n = Number(c.subs);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/* ============================================================
   FILE READING
   ============================================================ */
export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

/* ============================================================
   THUMBNAIL CAPTURE — grab a frame from a video file
   ============================================================ */
const THUMB_MAX_W = 480;
const THUMB_QUALITY = 0.75;

export function captureThumbnailFromFile(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = url;

    const cleanup = (result) => {
      try { URL.revokeObjectURL(url); } catch (_) {}
      video.removeAttribute('src');
      video.load();
      resolve(result);
    };

    const timeout = setTimeout(() => cleanup(''), 8000);

    video.addEventListener('loadedmetadata', () => {
      const dur = isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
      const target = Math.max(0.5, Math.min(dur * 0.2, dur - 0.1));
      try { video.currentTime = target; }
      catch (_) { clearTimeout(timeout); cleanup(''); }
    }, { once: true });

    video.addEventListener('seeked', () => {
      clearTimeout(timeout);
      try {
        const vw = video.videoWidth || 640;
        const vh = video.videoHeight || 360;
        const scale = Math.min(1, THUMB_MAX_W / vw);
        const w = Math.round(vw * scale);
        const h = Math.round(vh * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(video, 0, 0, w, h);
        cleanup(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
      } catch (e) {
        cleanup('');
      }
    }, { once: true });

    video.addEventListener('error', () => {
      clearTimeout(timeout);
      cleanup('');
    }, { once: true });
  });
}

/* ============================================================
   IMAGE RESIZE — for channel avatars and thumbnails
   ============================================================ */
export function resizeImageFile(file, maxW = THUMB_MAX_W) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxW / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', THUMB_QUALITY);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (e) {
        URL.revokeObjectURL(url);
        resolve('');
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}

/* ============================================================
   SEARCH HISTORY — shared between feed.js and main.js
   ============================================================ */
const HISTORY_KEY = 'pixeltube_search_history';
const HISTORY_MAX = 20;

export function getSearchHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

export function pushSearchHistory(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q || q.length < 2) return;
  const hist = getSearchHistory().filter(h => h.q !== q);
  hist.unshift({ q, ts: Date.now() });
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, HISTORY_MAX)));
  } catch (_) {}
}

export function clearSearchHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
}

export function hasSearchHistory() {
  return getSearchHistory().length > 0;
}