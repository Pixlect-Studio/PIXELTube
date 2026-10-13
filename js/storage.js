/* ============================================================
   PIXELTube — storage.js
   Backend abstraction for video uploads and playback.

   Routing:
     Minis / Shorts
       Primary  : Firebase Realtime DB (base64)
       Fallback : Backblaze B2 (via Cloudflare Worker signer)

     Longs
       Primary  : Supabase Storage
       Fallback : Backblaze B2
       Last try : Firebase Realtime DB (base64)

   Public API:
     uploadVideo(ctx, file, vid, kind, onProgress)
       → { storedSrc, srcBackend }
     uploadFromUrl(url)
       → { storedSrc, srcBackend }
     resolvePlaybackUrl(ctx, vid) → string (URL or data URL)
     deleteVideoSource(ctx, vid) → void
   ============================================================ */

/* ============================================================
   CONFIG
   ============================================================ */
const SUPABASE_BUCKET = 'PIXELTUBE_VIDEOS';
const B2_SIGNER_URL   = 'https://pixeltube-signer.aaraiz-adnan14.workers.dev';

/* ============================================================
   B2 — Cloudflare Worker signer
   ============================================================ */

async function b2Upload(file, key, onProgress) {
  /* 1. Ask the Worker for a presigned PUT URL */
  const signRes = await fetch(`${B2_SIGNER_URL}/sign-upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, contentType: file.type || 'video/mp4' })
  });

  if (!signRes.ok) {
    const err = await signRes.text().catch(() => 'signer error');
    throw new Error(`Signer rejected the request: ${err}`);
  }

  const { url, error } = await signRes.json();
  if (error) throw new Error(`Signer error: ${error}`);
  if (!url) throw new Error('Signer returned no URL');

  /* 2. PUT the file directly to B2. */
  if (onProgress) onProgress(0, file.size);

  const putRes = await fetch(url, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'video/mp4' }
  });

  if (!putRes.ok) {
    const txt = await putRes.text().catch(() => '');
    throw new Error(`B2 upload failed (${putRes.status}): ${txt.slice(0, 200)}`);
  }

  if (onProgress) onProgress(file.size, file.size);

  /* Return the object key — playback re-signs on every watch. */
  return key;
}

async function b2PlaybackUrl(key) {
  const res = await fetch(`${B2_SIGNER_URL}/sign-play`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key })
  });

  if (!res.ok) throw new Error(`Playback signing failed (${res.status})`);
  const { url, error } = await res.json();
  if (error) throw new Error(`Signer error: ${error}`);
  if (!url) throw new Error('Signer returned no URL');
  return url;
}

function b2KeyFor(uid, vid, ext, kind) {
  const prefix = kind === 'mini' ? 'shorts' : 'longs';
  return `${prefix}/${uid}/${vid}.${(ext || 'mp4').toLowerCase()}`;
}

/* ============================================================
   SUPABASE
   ============================================================ */

async function supabaseUpload(client, file, key, onProgress) {
  if (onProgress) onProgress(0, file.size);

  const { error } = await client.storage
    .from(SUPABASE_BUCKET)
    .upload(key, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'video/mp4'
    });

  if (error) throw new Error(`Supabase upload failed: ${error.message}`);

  const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(key);
  if (!data?.publicUrl) throw new Error('Supabase returned no public URL');

  if (onProgress) onProgress(file.size, file.size);
  return data.publicUrl;
}

function supabasePublicUrl(client, key) {
  try {
    const { data } = client.storage.from(SUPABASE_BUCKET).getPublicUrl(key);
    return data?.publicUrl || '';
  } catch (_) {
    return '';
  }
}

/* ============================================================
   FIREBASE — base64 (primary for Minis, fallback for Longs)
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
  } else if (fileOrDataUrl instanceof File || fileOrDataUrl instanceof Blob) {
    dataUrl = await fileToDataURL(fileOrDataUrl);
  } else {
    throw new Error('firebaseUpload expects a File, Blob, or data URL');
  }

  /* Try primary Firebase */
  if (db) {
    try {
      await set(ref(db, `pixeltube/videoSrc/${vid}`), dataUrl);
      return 'firebase';
    } catch (e) {
      console.warn('[storage] Firebase primary write failed:', e?.message);
    }
  }

  /* Try backup Firebase */
  if (dbBackup) {
    try {
      await set(ref(dbBackup, `pixeltube/videoSrc/${vid}`), dataUrl);
      return 'firebase-backup';
    } catch (e) {
      console.error('[storage] Firebase backup write also failed:', e?.message);
    }
  }

  throw new Error('Both Firebase backends rejected the write');
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
   READ HELPER — reads the non-base64 pointer (URL or B2 key)
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
   ============================================================

   Minis:
     Firebase base64 → B2

   Longs:
     Supabase → B2 → Firebase base64
   ============================================================ */
export async function uploadVideo(ctx, file, vid, kind, onProgress) {
  const uid = ctx.PIXLECT?.user?.uid;
  if (!uid) throw new Error('Not signed in');

  const ext = (file.name?.split('.').pop() || 'mp4').toLowerCase();

  /* --------------------------------------------------------
     MINIS — Firebase base64 primary, B2 fallback
     -------------------------------------------------------- */
  if (kind === 'mini') {
    /* Try Firebase first */
    try {
      const backend = await firebaseUpload(ctx, vid, file);
      return { storedSrc: '', srcBackend: backend };
    } catch (e) {
      console.warn('[storage] Firebase Mini upload failed, trying B2:', e?.message);
    }

    /* B2 fallback */
    try {
      const key = b2KeyFor(uid, vid, ext, 'mini');
      await b2Upload(file, key, onProgress);
      return { storedSrc: key, srcBackend: 'b2' };
    } catch (e) {
      console.error('[storage] B2 Mini fallback also failed:', e?.message);
      throw new Error('Both Firebase and B2 rejected the Mini upload');
    }
  }

  /* --------------------------------------------------------
     LONGS — Supabase primary, B2 fallback, Firebase last
     -------------------------------------------------------- */

  /* Try Supabase first */
  if (ctx.supa) {
    try {
      const key = `longs/${uid}/${vid}.${ext}`;
      const url = await supabaseUpload(ctx.supa, file, key, onProgress);
      return { storedSrc: url, srcBackend: 'supabase' };
    } catch (e) {
      console.warn('[storage] Supabase Long upload failed, trying B2:', e?.message);
    }
  }

  /* B2 fallback */
  try {
    const key = b2KeyFor(uid, vid, ext, 'long');
    await b2Upload(file, key, onProgress);
    return { storedSrc: key, srcBackend: 'b2' };
  } catch (e) {
    console.warn('[storage] B2 Long fallback failed, trying Firebase:', e?.message);
  }

  /* Firebase last resort — only if file is small enough for RTDB */
  if (file.size && file.size <= 8 * 1024 * 1024) {
    const backend = await firebaseUpload(ctx, vid, file);
    return { storedSrc: '', srcBackend: backend };
  }

  throw new Error('All storage backends rejected the Long upload');
}

/* ---- Paste-URL path ---- */
export function uploadFromUrl(url) {
  return { storedSrc: url, srcBackend: 'url' };
}

/* ============================================================
   PUBLIC API — playback resolution
   ============================================================ */
export async function resolvePlaybackUrl(ctx, vid) {
  const v = ctx.state?.videos?.[vid];
  if (!v) return '';

  const backend = v.srcBackend || 'firebase';

  /* B2 — re-sign on every playback since URLs expire */
  if (backend === 'b2') {
    const key = await readStoredSrc(ctx, vid);
    if (!key) return '';
    try {
      return await b2PlaybackUrl(key);
    } catch (e) {
      console.warn('[storage] B2 sign failed:', e?.message);
      return '';
    }
  }

  /* Supabase / pasted URL — stored src IS the playback URL */
  if (backend === 'supabase' || backend === 'url' || backend === 'url-backup') {
    return await readStoredSrc(ctx, vid);
  }

  /* Firebase / Firebase-backup — base64 in the DB */
  return await firebaseRead(ctx, vid, backend);
}

/* ============================================================
   PUBLIC API — deletion
   Firebase base64 entries get removed from the DB.
   B2 and Supabase files stay in their buckets; we only drop the
   Firebase pointer. Bucket cleanup is manual or scheduled.
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
  b2Upload,
  b2PlaybackUrl,
  b2KeyFor,
  supabaseUpload,
  supabasePublicUrl,
  firebaseUpload,
  firebaseRead,
  firebaseDelete,
  fileToDataURL
};