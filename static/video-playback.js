/* Allows only one actively playing PIXELTube video per browser origin. */
(function () {
  'use strict';

  const LOCK_NAME = 'pixeltube-exclusive-video-playback';
  const LEASE_KEY = 'pixeltube:video-playback-lease';
  const TAB_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const states = new WeakMap();
  const videos = new Set();
  const channel = 'BroadcastChannel' in window
    ? new BroadcastChannel('pixeltube-video-playback')
    : null;

  function showMessage(video, text) {
    const target = video.closest('[data-video-player]')?.querySelector('[data-playback-message]');
    if (target) target.textContent = text;
  }

  function pauseOtherVideos(activeVideo) {
    for (const video of videos) {
      if (video !== activeVideo && !video.paused) video.pause();
    }
  }

  function releaseState(video, state) {
    if (!state) return;
    state.wantsPlay = false;
    state.granted = false;
    if (state.release) {
      const release = state.release;
      state.release = null;
      release();
    }
    if (state.leaseTimer) {
      clearInterval(state.leaseTimer);
      state.leaseTimer = null;
    }
    try {
      const lease = JSON.parse(localStorage.getItem(LEASE_KEY) || 'null');
      if (state.leaseToken && lease?.token === state.leaseToken) localStorage.removeItem(LEASE_KEY);
    } catch (error) {
      console.error('Could not release local playback lease:', error);
    }
    state.leaseToken = null;
    showMessage(video, '');
    channel?.postMessage({ type: 'released', tabId: TAB_ID });
  }

  function acquireLease(video, state) {
    const token = `${TAB_ID}:${Math.random().toString(36).slice(2)}`;
    const readLease = () => {
      const raw = localStorage.getItem(LEASE_KEY);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    };
    const current = readLease();
    if (current && current.expiresAt > Date.now() && current.token !== token) {
      return false;
    }

    const writeLease = () => localStorage.setItem(LEASE_KEY, JSON.stringify({
      token,
      expiresAt: Date.now() + 60000,
    }));
    writeLease();
    if (readLease()?.token !== token) return false;
    state.leaseToken = token;
    state.leaseTimer = setInterval(() => {
      if (readLease()?.token !== token) {
        video.pause();
        releaseState(video, state);
        showMessage(video, 'Playback stopped because another PIXELTube video is active.');
        return;
      }
      writeLease();
    }, 10000);
    return true;
  }

  async function requestPlayback(video, state) {
    if (state.pending || state.granted) return;
    state.pending = true;

    const beginPlayback = async () => {
      state.pending = false;
      if (!state.wantsPlay || !video.isConnected) return;
      state.granted = true;
      const held = new Promise(resolve => { state.release = resolve; });
      pauseOtherVideos(video);
      showMessage(video, '');
      channel?.postMessage({ type: 'claimed', tabId: TAB_ID });
      try {
        await video.play();
        await held;
      } catch (error) {
        showMessage(video, `Could not start playback: ${error.message}`);
        releaseState(video, state);
        return;
      }
    };

    if (navigator.locks?.request) {
      navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async lock => {
        if (!lock) {
          state.pending = false;
          state.wantsPlay = false;
          showMessage(video, 'Another PIXELTube video is playing in another tab. Pause it before starting this one.');
          return;
        }
        await beginPlayback();
      }).catch(error => {
        state.pending = false;
        if (!state.wantsPlay) return;
        console.error('Exclusive playback lock failed; using browser storage lease:', error);
        if (!acquireLease(video, state)) {
          state.wantsPlay = false;
          showMessage(video, 'Another PIXELTube video is active in this browser. Pause it before starting this one.');
          return;
        }
        state.granted = true;
        pauseOtherVideos(video);
        channel?.postMessage({ type: 'claimed', tabId: TAB_ID });
        video.play().catch(playError => {
          showMessage(video, `Could not start playback: ${playError.message}`);
          releaseState(video, state);
        });
      });
      return;
    }

    if (!acquireLease(video, state)) {
      state.pending = false;
      state.wantsPlay = false;
      showMessage(video, 'Another PIXELTube video is active in this browser. Pause it before starting this one.');
      return;
    }
    state.pending = false;
    state.granted = true;
    pauseOtherVideos(video);
    channel?.postMessage({ type: 'claimed', tabId: TAB_ID });
    try {
      await video.play();
    } catch (error) {
      showMessage(video, `Could not start playback: ${error.message}`);
      releaseState(video, state);
    }
  }

  function register(video) {
    if (videos.has(video)) return;
    videos.add(video);
    const state = { pending: false, granted: false, wantsPlay: false, release: null, leaseTimer: null };
    states.set(video, state);

    video.addEventListener('play', () => {
      if (state.granted) return;
      state.wantsPlay = true;
      state.blockingPlay = true;
      video.pause();
      requestPlayback(video, state);
    });
    video.addEventListener('pause', () => {
      if (state.blockingPlay) {
        state.blockingPlay = false;
        return;
      }
      if (state.pending) {
        state.wantsPlay = false;
        return;
      }
      if (!state.granted) return;
      releaseState(video, state);
    });
    video.addEventListener('ended', () => releaseState(video, state));
    video.addEventListener('error', () => releaseState(video, state));
    video.addEventListener('emptied', () => releaseState(video, state));
    video.addEventListener('loadedmetadata', () => {
      if (video.paused) return;
      const currentState = states.get(video);
      if (!currentState.granted) {
        currentState.wantsPlay = true;
        currentState.blockingPlay = true;
        video.pause();
        requestPlayback(video, currentState);
      }
    });
  }

  channel?.addEventListener('message', event => {
    if (event.data?.type === 'claimed' && event.data.tabId !== TAB_ID) {
      pauseOtherVideos(null);
    }
  });

  function scan(root = document) {
    if (root instanceof HTMLVideoElement) register(root);
    root.querySelectorAll?.('video').forEach(register);
  }

  scan();
  new MutationObserver(records => {
    records.forEach(record => record.addedNodes.forEach(node => {
      if (node instanceof Element) scan(node);
    }));
  }).observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    for (const video of videos) {
      const state = states.get(video);
      if (state?.granted && state.leaseToken && localStorage.getItem(LEASE_KEY)) {
        try {
          if (JSON.parse(localStorage.getItem(LEASE_KEY)).token !== state.leaseToken) video.pause();
        } catch {
          video.pause();
        }
      }
    }
  });

  window.addEventListener('pagehide', () => {
    for (const video of videos) {
      video.pause();
      releaseState(video, states.get(video));
    }
    channel?.close();
  });
})();
