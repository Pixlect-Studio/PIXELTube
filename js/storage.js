/* ============================================================
   PIXELTube — storage.js
   Backend abstraction for video uploads and playback.

   Routing:
     Minis → Bunny Stream (primary) → Firebase base64 (fallback)
     Longs → Bunny Stream (primary) → Firebase base64 (fallback)

   Credentials come from .env via env.js. Nothing hardcoded.

   Public API:
     uploadVideo(ctx, file, vid, kind, onProgress)
     uploadFromUrl(url)
     resolvePlaybackUrl(ctx, vid)
     deleteVideoSource(ctx, vid)
   ============================================================ */
import { loadEnv, getEnv } from './env.js';

export const MAX_LONG_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MAX_MINI_UPLOAD_BYTES = 100 * 1024 * 1024;

/* ============================================================
   CONFIG — populated from .env after loadEnv()
   ============================================================ */
let BUNNY_LIBRARY_ID = '';
let BUNNY_API_KEY    = '';
let BUNNY_CDN_HOST   = '';

const TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload';

/* Kick off the load at module init. If an upload runs before the
   load finishes, ensureEnv() awaits the same promise. */
loadEnv().then(() => {
  const env = getEnv();
  BUNNY_LIBRARY_ID = env.BUNNY_LIBRARY_ID      || '';
  BUNNY_API_KEY    = env.BUNNY_STREAM_API_KEY  || '';
  BUNNY_CDN_HOST   = env.BUNNY_CDN_HOST        || '';
  console.log('[storage] env ready:',
    'library=' + (BUNNY_LIBRARY_ID ? '✓' : '✗'),
    'key='     + (BUNNY_API_KEY    ? '✓' : '✗'),
    'cdn='     + (BUNNY_CDN_HOST   ? '✓' : '✗'));
});

async function ensureEnv() {
  if (BUNNY_LIBRARY_ID && BUNNY_API_KEY && BUNNY_CDN_HOST) return;
  await loadEnv();
  const env = getEnv();
  BUNNY_LIBRARY_ID = env.BUNNY_LIBRARY_ID      || '';
  BUNNY_API_KEY    = env.BUNNY_STREAM_API_KEY  || '';
  BUNNY_CDN_HOST   = env.BUNNY_CDN_HOST        || '';
}

/* ============================================================
   BUNNY STREAM — TUS resumable upload
   ============================================================ */

async function bunnyCreateVideo(title) {
  await ensureEnv();
  if (!BUNNY_LIBRARY_ID || !BUNNY_API_KEY) {
    throw new Error('Bunny Stream not configured — check .env');
  }

  const res = await fetch(
    `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'AccessKey': BUNNY_API_KEY
      },
      body: JSON.stringify({ title })
    }
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Bunny create video failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  const data = await res.json();
  const videoId = data.guid;
  if (!videoId) throw new Error('Bunny did not return a video guid');

  /* TUS signature = SHA256(library_id + api_key + expiration + video_id) */
  const expirationTime = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const signatureInput = `${BUNNY_LIBRARY_ID}${BUNNY_API_KEY}${expirationTime}${videoId}`;
  const signature = await sha256Hex(signatureInput);

  return { videoId, signature, expirationTime };
}

async function bunnyUpload(file, title, onProgress) {
  const { videoId, signature, expirationTime } = await bunnyCreateVideo(title);

  return new Promise((resolve, reject) => {
    if (typeof tus === 'undefined' || !tus.Upload) {
      reject(new Error('tus-js-client is not loaded — add it to index.html'));
      return;
    }

    const upload = new tus.Upload(file, {
      endpoint: TUS_ENDPOINT,
      retryDelays: [0, 3000, 5000, 10000, 20000, 60000],
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expirationTime),
        VideoId: videoId,
        LibraryId: String(BUNNY_LIBRARY_ID)
      },
      metadata: {
        filetype: file.type || 'video/mp4',
        title: title || file.name
      },
      onError(error) {
        console.error('[storage] Bunny TUS error:', error);
        reject(new Error(`Bunny upload failed: ${error?.message || error}`));
      },
      onProgress(bytesUploaded, bytesTotal) {
        if (onProgress) onProgress(bytesUploaded, bytesTotal);
      },
      onSuccess() {
        resolve(videoId);
      }
    });

    upload.start();
  });
}

/* Public playback URL — Bunny returns an HLS manifest. */
function bunnyPublicUrl(videoId) {
  if (!BUNNY_CDN_HOST) return '';
  return `https://${BUNNY_CDN_HOST}/${videoId}/playlist.m3u8`;
}

/* SHA-256 hex via Web Crypto. */
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* ============================================================
   FIREBASE — base64 fallback
   ============================================================ */

function fileToDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
}

async function firebaseUpload(ctx, vid, fileOrDataUrl) {
  const { db, dbBackup, ref, set } = ctx;

  let dataUrl;
  if (typeof fileOrDataUrl === 'string' && fileOrDataUrl.startsWith('data:')) {
    dataUrl = fileOrDataUrl;
  } else {
    dataUrl = await fileToDataURL(fileOrDataUrl);
  }

  if (db) {
    try {
      await set(ref(db, `pixeltube/videoSrc/${vid}`), dataUrl);
      return 'firebase';
    } catch (e) {
      console.warn('[storage] Firebase primary failed:', e?.message);
    }
  }

  if (dbBackup) {
    try {
      await set(ref(dbBackup, `pixeltube/videoSrc/${vid}`), dataUrl);
      return 'firebase-backup';
    } catch (e) {
      console.error('[storage] Firebase backup failed:', e?.message);
    }
  }

  throw new Error('Firebase rejected the write');
}

async function firebaseRead(ctx, vid, preferBackend) {
  const { db, dbBackup, ref, get } = ctx;
  const tryOne = async (h) => {
    if (!h) return '';
    try {
      const snap = await get(ref(h, `pixeltube/videoSrc/${vid}`));
      return snap.val() || '';
    } catch (_) { return ''; }
  };
  if (preferBackend === 'firebase-backup') {
    return (await tryOne(dbBackup)) || (await tryOne(db));
  }
  return (await tryOne(db)) || (await tryOne(dbBackup));
}

async function firebaseDelete(ctx, vid) {
  const { db, dbBackup, ref, remove } = ctx;
  if (db) { try { await remove(ref(db, `pixeltube/videoSrc/${vid}`)); } catch (_) {} }
  if (dbBackup) { try { await remove(ref(dbBackup, `pixeltube/videoSrc/${vid}`)); } catch (_) {} }
}

/* ============================================================
   READ HELPER — reads the non-base64 pointer (URL or Bunny id)
   ============================================================ */
async function readStoredSrc(ctx, vid) {
  const { db, ref, get } = ctx;
  if (!db) return '';
  try {
    const snap = await get(ref(db, `pixeltube/videoSrc/${vid}`));
    return snap.val() || '';
  } catch (_) {
    return '';
  }
}

/* ============================================================
   PUBLIC API — upload
   ============================================================ */

export async function uploadVideo(ctx, file, vid, kind, onProgress) {
  const uid = ctx.PIXLECT?.user?.uid;
  if (!uid) throw new Error('Not signed in');
  const maxBytes = kind === 'mini' ? MAX_MINI_UPLOAD_BYTES : MAX_LONG_UPLOAD_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`${kind === 'mini' ? 'Mini' : 'Long'} uploads are limited to 100 MB.`);
  }

  await ensureEnv();

  const title = file.name || 'Untitled';

  /* ---- Bunny Stream first (both kinds) ---- */
  if (BUNNY_LIBRARY_ID && BUNNY_API_KEY) {
    try {
      const videoId = await bunnyUpload(file, title, onProgress);
      return { storedSrc: videoId, srcBackend: 'bunny' };
    } catch (e) {
      console.warn('[storage] Bunny upload failed, falling back to Firebase:', e?.message);
    }
  } else {
    console.warn('[storage] Bunny not configured — falling back to Firebase base64');
  }

  /* ---- Firebase base64 fallback ---- */
  if (file.size && file.size > 8 * 1024 * 1024) {
    throw new Error('Bunny Stream failed and file is too large for Firebase fallback (> 8 MB)');
  }
  const backend = await firebaseUpload(ctx, vid, file);
  return { storedSrc: '', srcBackend: backend };
}

export function uploadFromUrl(url) {
  return { storedSrc: url, srcBackend: 'url' };
}

/* ============================================================
   PUBLIC API — playback
   ============================================================ */
export async function resolvePlaybackUrl(ctx, vid) {
  const v = ctx.state?.videos?.[vid];
  if (!v) return '';

  const backend = v.srcBackend || 'firebase';

  if (backend === 'bunny') {
    await ensureEnv();
    const videoId = await readStoredSrc(ctx, vid);
    if (!videoId) return '';
    const url = bunnyPublicUrl(videoId);
    if (!url) {
      console.warn('[storage] Bunny CDN host missing — check .env');
      return '';
    }
    return url;
  }

  if (backend === 'supabase' || backend === 'url' || backend === 'url-backup') {
    return await readStoredSrc(ctx, vid);
  }

  return await firebaseRead(ctx, vid, backend);
}

/* ============================================================
   PUBLIC API — delete
   ============================================================ */
export async function deleteVideoSource(ctx, vid) {
  const v = ctx.state?.videos?.[vid];
  const backend = v?.srcBackend || 'firebase';

  if (backend === 'firebase' || backend === 'firebase-backup') {
    await firebaseDelete(ctx, vid);
  }

  const { db, ref, remove } = ctx;
  if (db) {
    try { await remove(ref(db, `pixeltube/videoSrc/${vid}`)); } catch (_) {}
  }
}

/* ============================================================
   EXPORTS FOR ADVANCED USE
   ============================================================ */
export const storageInternals = {
  bunnyUpload,
  bunnyCreateVideo,
  bunnyPublicUrl,
  firebaseUpload,
  firebaseRead,
  firebaseDelete,
  fileToDataURL,
  sha256Hex,
  ensureEnv
};
