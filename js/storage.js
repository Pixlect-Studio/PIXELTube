/* ============================================================
   PIXELTube — storage.js
   Backend abstraction:
     - supabase : public URL from Supabase Storage (Shorts + Longs)
     - b2       : presigned URLs via Cloudflare Worker (Longs, primary)
     - firebase : base64 in RTDB (legacy fallback / migration path)
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

  /* fetch() doesn't expose upload progress in browsers, but we can still
     send a "started" tick so the UI knows something is happening. */
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

function b2KeyFor(uid, vid, ext) {
  return `${uid}/${vid}.${(ext || 'mp4').toLowerCase()}`;
}

/* ============================================================
   SUPABASE
   ============================================================ */

async function supabaseUpload(client, file, key, onProgress) {
  /* Supabase JS has no progress callback in this SDK version,
     so we just tick the ends. */
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
  return client.storage.from(SUPABASE_BUCKET).getPublicUrl(key)?.data?.publicUrl || '';
}

/* ============================================================
   FIREBASE — legacy base64 (kept for older videos)
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

  if (db) {
    try {
      await set(ref(db, `pixeltube/videoSrc/${vid}`), dataUrl);
      return 'firebase';
    } catch (e) {
      console.warn('[storage] Firebase primary write failed:', e?.message);
    }
  }
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
   PUBLIC API
   ============================================================ */

/* Upload a video.
   kind: 'mini' (Short) → Supabase primary, B2 not used
         'long'         → B2 primary, Supabase fallback
   Returns { storedSrc, srcBackend } */
export async function uploadVideo(ctx, file, vid, kind, onProgress) {
  const uid = ctx.PIXLECT?.user?.uid;
  if (!uid) throw new Error('Not signed in');

  const ext = (file.name?.split('.').pop() || 'mp4').toLowerCase();

  /* ---- Shorts → Supabase ---- */
  if (kind === 'mini') {
    if (!ctx.supa) throw new Error('Supabase client not ready');
    const key = `shorts/${uid}/${vid}.${ext}`;
    try {
      const url = await supabaseUpload(ctx.supa, file, key, onProgress);
      return { storedSrc: url, srcBackend: 'supabase' };
    } catch (e) {
      console.warn('[storage] Supabase Short upload failed, falling back to Firebase base64:', e?.message);
    }
    /* If Supabase fails, fall back to base64 — this keeps Shorts working
       even if Supabase is down. */
    const backend = await firebaseUpload(ctx, vid, file);
    const dataUrl = await firebaseRead(ctx, vid, backend);
    return { storedSrc: dataUrl, srcBackend: backend };
  }

  /* ---- Longs → B2 primary, Supabase fallback ---- */
  const b2key = b2KeyFor(uid, vid, ext);
  try {
    await b2Upload(file, b2key, onProgress);
    return { storedSrc: b2key, srcBackend: 'b2' };
  } catch (e) {
    console.warn('[storage] B2 upload failed, trying Supabase:', e?.message);
  }

  if (ctx.supa) {
    const key = `longs/${uid}/${vid}.${ext}`;
    const url = await supabaseUpload(ctx.supa, file, key, onProgress);
    return { storedSrc: url, srcBackend: 'supabase' };
  }

  throw new Error('No long-form backend available');
}

export function uploadFromUrl(url) {
  return { storedSrc: url, srcBackend: 'url' };
}

/* Resolve a stored source into a URL the <video> tag can play. */
export async function resolvePlaybackUrl(ctx, vid) {
  const v = ctx.state?.videos?.[vid];
  if (!v) return '';
  const backend = v.srcBackend || 'firebase';

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

  if (backend === 'supabase' || backend === 'url' || backend === 'url-backup') {
    return await readStoredSrc(ctx, vid);
  }

  return await firebaseRead(ctx, vid, backend);
}

/* Read the raw stored src string (path or URL, not base64). */
async function readStoredSrc(ctx, vid) {
  const { db, ref, get } = ctx;
  if (!db) return '';
  try {
    const snap = await get(ref(db, `pixeltube/videoSrc/${vid}`));
    return snap.val() || '';
  } catch (_) { return ''; }
}

/* Clean up. B2/Supabase files stay in the bucket; we only drop the pointer. */
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

export const storageInternals = {
  b2Upload, b2PlaybackUrl, b2KeyFor,
  supabaseUpload, supabasePublicUrl,
  firebaseUpload, firebaseRead, firebaseDelete,
  fileToDataURL
};