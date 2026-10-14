/* ============================================================
   PIXELTube — storage.js
   Bunny Stream (Longs + Minis) with Firebase fallback for Minis.

   Routing:
     Minis  → Bunny Stream (primary) → Firebase base64 (fallback)
     Longs  → Bunny Stream (primary) → Firebase base64 (if ≤ 8 MB)

   Environment (from .env, never committed):
     BUNNY_LIBRARY_ID    — your Bunny Stream library ID (1989034)
     BUNNY_STREAM_API_KEY — your Bunny Stream API key
     BUNNY_CDN_HOST      — your pull zone host (e.g. pixeltube-videos.b-cdn.net)
   ============================================================ */

/* ============================================================
   CONFIG — read from environment
   ============================================================ */
const BUNNY_LIBRARY_ID  = import.meta.env.VITE_BUNNY_LIBRARY_ID;
const BUNNY_API_KEY     = import.meta.env.VITE_BUNNY_STREAM_API_KEY;
const BUNNY_CDN_HOST    = import.meta.env.VITE_BUNNY_CDN_HOST;

const TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload';

/* ============================================================
   BUNNY STREAM — TUS resumable upload
   ============================================================ */

/* Create a video object in Bunny Stream and return { videoId, signature, expirationTime }. */
async function bunnyCreateVideo(title) {
  if (!BUNNY_LIBRARY_ID || !BUNNY_API_KEY) {
    throw new Error('Bunny Stream not configured — check your .env');
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

  /* Generate the TUS signature: SHA256(library_id + api_key + expiration + video_id) [citation:1][citation:9] */
  const expirationTime = Math.floor(Date.now() / 1000) + 86400; // 24 hours
  const signatureInput = `${BUNNY_LIBRARY_ID}${BUNNY_API_KEY}${expirationTime}${videoId}`;
  const signature = await sha256Hex(signatureInput);

  return { videoId, signature, expirationTime };
}

/* Upload a file to Bunny Stream using tus-js-client. */
async function bunnyUpload(file, title, onProgress) {
  const { videoId, signature, expirationTime } = await bunnyCreateVideo(title);

  return new Promise((resolve, reject) => {
    const upload = new tus.Upload(file, {
      endpoint: TUS_ENDPOINT,
      retryDelays: [0, 3000, 5000, 10000, 20000, 60000, 60000],
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
        reject(new Error(`Bunny upload failed: ${error.message || error}`));
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

/* Compute SHA-256 hex of a string using Web Crypto. */
async function sha256Hex(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Public playback URL from Bunny CDN. */
function bunnyPublicUrl(videoId) {
  return `https://${BUNNY_CDN_HOST}/${videoId}/playlist.m3u8`;
}

/* ============================================================
   FIREBASE — base64 fallback for Minis
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
   READ HELPER
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

  const title = file.name || 'Untitled';

  /* ---------- MINIS → Bunny Stream, fallback Firebase ---------- */
  if (kind === 'mini') {
    if (BUNNY_LIBRARY_ID && BUNNY_API_KEY) {
      try {
        const videoId = await bunnyUpload(file, title, onProgress);
        return { storedSrc: videoId, srcBackend: 'bunny' };
      } catch (e) {
        console.warn('[storage] Bunny Mini failed, trying Firebase:', e?.message);
      }
    }

    /* Firebase fallback */
    const backend = await firebaseUpload(ctx, vid, file);
    return { storedSrc: '', srcBackend: backend };
  }

  /* ---------- LONGS → Bunny Stream, fallback Firebase (only ≤ 8 MB) ---------- */
  if (BUNNY_LIBRARY_ID && BUNNY_API_KEY) {
    try {
      const videoId = await bunnyUpload(file, title, onProgress);
      return { storedSrc: videoId, srcBackend: 'bunny' };
    } catch (e) {
      console.warn('[storage] Bunny Long failed:', e?.message);
    }
  }

  /* Firebase fallback — only if the file fits in a single RTDB value */
  if (file.size && file.size <= 8 * 1024 * 1024) {
    const backend = await firebaseUpload(ctx, vid, file);
    return { storedSrc: '', srcBackend: backend };
  }

  throw new Error('Bunny Stream failed and file is too large for Firebase');
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
    const videoId = await readStoredSrc(ctx, vid);
    if (!videoId) return '';
    return bunnyPublicUrl(videoId);
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