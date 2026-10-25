/**
 * storage.js — PIXELTube client-side video fetcher.
 * Talks to the FastAPI backend (/api/videos) which proxies Bunny Storage.
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
        message = detail.detail || message;
      } catch (error) {
        if (text) message = text;
      }
      throw new Error(message);
    }
    return response.json();
  }

  function userId(user) {
    const id = user?.uid || user?.PIXELUserUUID || user?.pixelUserUUID || user?.uuid;
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

  async function deleteVideo(id) {
    return requestJson(`/api/videos/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async function uploadVideo(file, meta = {}, onProgress = () => {}) {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('title', meta.title || 'Untitled');
    fd.append('description', meta.description || '');
    fd.append('category', meta.category || 'General');
    fd.append('visibility', meta.visibility || 'Public');
    fd.append('channel', meta.channel || '');
    fd.append('creator_name', meta.creator_name || '');
    fd.append('video_type', meta.video_type || 'long');
    fd.append('creator_id', meta.creator_id || userId(window.PIXELTubeAuth?.user));

    return new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open('POST', `${BASE}/api/upload`);
      request.upload.addEventListener('progress', event => {
        if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
      });
      request.addEventListener('load', () => {
        if (request.status < 200 || request.status >= 300) {
          reject(new Error(request.responseText || request.statusText || 'Upload failed'));
          return;
        }
        try {
          resolve(JSON.parse(request.responseText));
        } catch (error) {
          reject(new Error(`Invalid upload response: ${error.message}`));
        }
      });
      request.addEventListener('error', () => reject(new Error('Network error during upload')));
      request.addEventListener('abort', () => reject(new Error('Upload was cancelled')));
      request.send(fd);
    });
  }

  return {
    listVideos, getVideo, addView, deleteVideo, uploadVideo, getVideoSocial,
    setReaction, addComment, toggleSubscription, syncUser, getUserActivity,
    markNotificationsRead,
  };
})();