/**
 * storage.js — PIXELTube client-side video fetcher + uploader.
 *
 * Video bytes go directly from the browser to Bunny Storage using a signed
 * upload URL issued by our API (`/api/upload/init` → PUT to Bunny →
 * `/api/upload/complete`). This bypasses Vercel's 4.5 MB serverless body limit
 * so the `413` error no longer occurs for large uploads.
 */

window.PIXELTubeAPI = (() => {
  const API_ORIGIN = window.location.port === '5500'
    ? `${window.location.protocol}//${window.location.hostname}:8000`
    : '';
  const BASE = API_ORIGIN;

  async function requestJson(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, options);
    if (!response.ok) {
      let message = response.statusText || 'Request failed';
      const text = await response.text();
      try {
        const detail = JSON.parse(text);
        message = detail.detail || detail.message || message;
      } catch (error) {
        if (text) message = text;
      }
      throw new Error(message);
    }
    return response.json();
  }

  // Robustly extracts the PIXLECT User ID from various nested payload formats
  function userId(user) {
    if (!user) return '';
    const id = user.PIXELUserUUID
      || user.pixelUserUUID
      || user.pixel_user_uuid
      || user.user_uuid
      || user.PIXELUser?.UUID
      || user.pixelUser?.uuid
      || user.uuid
      || user.uid;
    return typeof id === 'string' && id.trim() ? id.trim() : '';
  }

  async function listVideos() {
    const res = await fetch(`${BASE}/api/videos`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    return data.videos || [];
  }

  async function addView(id) {
    return requestJson(`/api/videos/${encodeURIComponent(id)}/view`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId(window.PIXELTubeAuth?.user) || null }),
    });
  }

  async function getVideo(id) {
    return requestJson(`/api/videos/${encodeURIComponent(id)}`);
  }

  async function getVideoSocial(id, user = window.PIXELTubeAuth?.user) {
    const idValue = userId(user);
    const query = idValue ? `?user_id=${encodeURIComponent(idValue)}` : '';
    return requestJson(`/api/videos/${encodeURIComponent(id)}/social${query}`);
  }

  async function setReaction(id, reaction, user = window.PIXELTubeAuth?.user) {
    const idValue = userId(user);
    if (!idValue) throw new Error('Sign in with PIXLECT before reacting.');
    await syncUser(user, window.PIXELTubeSettings?.get?.() || {});
    return requestJson(`/api/videos/${encodeURIComponent(id)}/reaction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: idValue, reaction }),
    });
  }

  async function addComment(id, text, user = window.PIXELTubeAuth?.user) {
    const idValue = userId(user);
    if (!idValue) throw new Error('Sign in with PIXLECT before commenting.');
    await syncUser(user, window.PIXELTubeSettings?.get?.() || {});
    return requestJson(`/api/videos/${encodeURIComponent(id)}/comments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: idValue, text }),
    });
  }

  async function toggleSubscription(videoId, user = window.PIXELTubeAuth?.user) {
    const idValue = userId(user);
    if (!idValue) throw new Error('Sign in with PIXLECT before subscribing.');
    await syncUser(user, window.PIXELTubeSettings?.get?.() || {});
    return requestJson(`/api/videos/${encodeURIComponent(videoId)}/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: idValue }),
    });
  }

  async function syncUser(user, profile = {}) {
    const idValue = userId(user);
    if (!idValue) return null;
    const username = String(profile.name || user.username || user.displayName || '').trim();
    if (!username) return null;
    return requestJson('/api/users/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: idValue,
        username,
        channel: profile.channel || '',
        icon: user.icon || null,
      }),
    });
  }

  async function getUserActivity(user = window.PIXELTubeAuth?.user) {
    const idValue = userId(user);
    if (!idValue) throw new Error('Sign in with PIXLECT to view account activity.');
    return requestJson(`/api/users/${encodeURIComponent(idValue)}/activity`);
  }

  async function markNotificationsRead(user = window.PIXELTubeAuth?.user) {
    const idValue = userId(user);
    if (!idValue) throw new Error('Sign in with PIXLECT to update notifications.');
    return requestJson(`/api/users/${encodeURIComponent(idValue)}/notifications/read`, { method: 'POST' });
  }

  // UPDATED: Passes the user_id to the backend so the server can verify
  // if you are the owner of the video or an Admin before allowing deletion.
  async function deleteVideo(id) {
    const idValue = userId(window.PIXELTubeAuth?.user);
    const query = idValue ? `?user_id=${encodeURIComponent(idValue)}` : '';
    return requestJson(`/api/videos/${encodeURIComponent(id)}${query}`, { method: 'DELETE' });
  }

  /**
   * Upload a video using the client-direct flow:
   *   1. POST /api/upload/init           → reserve ID + Bunny URL + headers
   *   2. PUT  (upload_url)               → stream file bytes to Bunny directly
   *   3. POST /api/upload/complete       → register metadata in the video index
   */
  async function uploadVideo(file, meta = {}, onProgress = () => {}) {
    if (!file) throw new Error('No file selected.');
    const creatorId = (meta.creator_id || userId(window.PIXELTubeAuth?.user) || '').trim();

    // ---- Step 1: reserve an upload slot ----
    const initBody = new FormData();
    initBody.append('title', meta.title || 'Untitled');
    initBody.append('description', meta.description || '');
    initBody.append('category', meta.category || 'General');
    initBody.append('visibility', meta.visibility || 'Public');
    initBody.append('channel', meta.channel || '');
    initBody.append('creator_name', meta.creator_name || '');
    initBody.append('video_type', meta.video_type || 'long');
    initBody.append('creator_id', creatorId);
    initBody.append('filename', file.name || 'video.mp4');
    initBody.append('content_type', file.type || 'video/mp4');
    initBody.append('file_size', file.size);

    let init;
    try {
      const initRes = await fetch(`${BASE}/api/upload/init`, { method: 'POST', body: initBody });
      if (!initRes.ok) {
        let message = initRes.statusText || 'Could not start upload';
        const text = await initRes.text();
        try {
          const detail = JSON.parse(text);
          message = detail.detail || message;
        } catch (_) {
          if (text) message = text;
        }
        throw new Error(message);
      }
      init = await initRes.json();
    } catch (err) {
      throw new Error(`Upload init failed: ${err.message}`);
    }

    const { video_id, remote_path, upload_url, headers, meta: validatedMeta } = init || {};
    if (!video_id || !remote_path || !upload_url) {
      throw new Error('Server did not return a valid upload URL.');
    }

    // ---- Step 2: stream the file straight to Bunny ----
    await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', upload_url, true);
      
      for (const [key, value] of Object.entries(headers || {})) {
        try { xhr.setRequestHeader(key, value); } catch (_) { /* skip restricted headers */ }
      }
      
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable && event.total > 0) {
          const pct = Math.min(99, Math.round((event.loaded / event.total) * 100));
          try { onProgress(pct); } catch (_) { /* ignore */ }
        }
      });
      
      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve();
        } else {
          reject(new Error(`Bunny rejected the upload (${xhr.status}). ${xhr.responseText || xhr.statusText}`));
        }
      });
      
      xhr.addEventListener('error', () => reject(new Error(
        'Network error while uploading to Bunny. If this is a CORS error, enable CORS on your Bunny Storage zone (methods PUT/GET/HEAD/OPTIONS, headers AccessKey, Content-Type).'
      )));
      
      xhr.addEventListener('abort', () => reject(new Error('Upload was cancelled.')));
      xhr.send(file);
    });

    try { onProgress(100); } catch (_) { /* ignore */ }

    // ---- Step 3: finalize the record in the video index ----
    try {
      const doneRes = await fetch(`${BASE}/api/upload/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id, remote_path, meta: validatedMeta || meta }),
      });
      if (!doneRes.ok) {
        let message = doneRes.statusText || 'Could not finalize upload';
        const text = await doneRes.text();
        try {
          const detail = JSON.parse(text);
          message = detail.detail || message;
        } catch (_) {
          if (text) message = text;
        }
        throw new Error(message);
      }
      return await doneRes.json();
    } catch (err) {
      throw new Error(`Saved to storage but index registration failed: ${err.message}`);
    }
  }

  return {
    listVideos, getVideo, addView, deleteVideo, uploadVideo, getVideoSocial,
    setReaction, addComment, toggleSubscription, syncUser, getUserActivity,
    markNotificationsRead,
  };
})();