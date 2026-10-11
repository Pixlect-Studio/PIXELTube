export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export const initial = s => (s || '?').trim().charAt(0).toUpperCase();

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

export function avatarHTML(c, cls = '') {
  if (c?.avatar) return `<span class="avatar ${cls}"><img src="${esc(c.avatar)}" alt=""></span>`;
  return `<span class="avatar ${cls}" style="background:${esc(c?.color || '#666')}">${esc(initial(c?.name))}</span>`;
}

export function thumbHTML(v) {
  if (v.thumb) {
    return `<img src="${esc(v.thumb)}" alt="" loading="lazy"
                 crossorigin="anonymous" referrerpolicy="no-referrer"
                 onerror="this.parentElement.insertAdjacentHTML('beforeend','<div class=\\'placeholder\\'>🎬</div>');this.remove()">`;
  }
  return `<div class="placeholder">🎬</div>`;
}

export function parseDuration(str) {
  if (!str) return 0;
  const parts = String(str).split(':').map(p => parseInt(p, 10) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

export function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
      try { video.currentTime = target; } catch (_) { clearTimeout(timeout); cleanup(''); }
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
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(video, 0, 0, w, h);
        cleanup(canvas.toDataURL('image/jpeg', THUMB_QUALITY));
      } catch (e) { cleanup(''); }
    }, { once: true });
    video.addEventListener('error', () => { clearTimeout(timeout); cleanup(''); }, { once: true });
  });
}

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
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', THUMB_QUALITY);
        URL.revokeObjectURL(url);
        resolve(dataUrl);
      } catch (e) { URL.revokeObjectURL(url); resolve(''); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(''); };
    img.src = url;
  });
}