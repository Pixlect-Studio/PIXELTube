/* =====================================================================
   PIXELTube × PIXLECT Account Network — login.js
   ---------------------------------------------------------------------
   Usage in any page under /static/html/:

     <script src="/static/js/pixlect-crypto.js"></script>
     <script src="/static/js/login.js" defer></script>

     <button id="pixlect-login">Sign in with PIXLECT</button>
     <div id="pixlect-user"></div>

   Public API:
     window.PIXELTubeAuth.user          -> current user or null
     window.PIXELTubeAuth.login()       -> open popup
     window.PIXELTubeAuth.logout()      -> clear session
     window.PIXELTubeAuth.onChange(fn)  -> subscribe (returns unsubscribe)
     window.PIXELTubeAuth.ready()       -> Promise<user|null>
   ===================================================================== */

(function () {
  'use strict';

  // ----------------------------------------------------------------
  // CONFIG
  // ----------------------------------------------------------------
  const CONFIG = {
    app: 'PIXELTube',

    authUrl: 'https://www.account.pixlect-studios.com/?app=PIXELTube&mode=popup',

    trustedOrigins: [
      'http://localhost:8000',
      'http://127.0.0.1:8000',
      'https://accounts.pixlect-studios.com',
      'https://www.accounts.pixlect-studios.com',
      'https://www.account.pixlect-studios.com'
    ],

    storageKey: 'pixeltube:pixlect_user',
    // How long a stored session lives (ms). Default 24 h.
    sessionTTL: 24 * 60 * 60 * 1000
  };

  // ----------------------------------------------------------------
  // Guard — crypto module must be loaded first
  // ----------------------------------------------------------------
  function getCrypto() {
    if (!window.PixlectCrypto || typeof window.PixlectCrypto.seal !== 'function') {
      throw new Error(
        'PixlectCrypto not loaded. Add <script src="js/pixlect-crypto.js"></script> ' +
        'BEFORE login.js.'
      );
    }
    return window.PixlectCrypto;
  }

  // ----------------------------------------------------------------
  // State
  // ----------------------------------------------------------------
  let currentUser = null;
  let authFrame = null;
  let authOverlay = null;
  let authPopup = null;
  let readyResolved = false;
  let readyPromise;
  let readyResolve;
  const listeners = new Set();

  readyPromise = new Promise((resolve) => { readyResolve = resolve; });

  function markReady(user) {
    if (readyResolved) return;
    readyResolved = true;
    readyResolve(user);
  }

  // ----------------------------------------------------------------
  // Session storage (encrypted via PixlectCrypto)
  // ----------------------------------------------------------------
  async function saveUser(user) {
    try {
      const c = getCrypto();
      await c.saveSession(CONFIG.storageKey, user, CONFIG.sessionTTL);
    } catch (e) {
      console.warn('[PIXELTube] Could not save session:', e);
    }
    setUser(user);
  }

  async function loadUser() {
    try {
      const c = getCrypto();
      return await c.loadSession(CONFIG.storageKey);
    } catch (e) {
      console.warn('[PIXELTube] Could not load session:', e);
      return null;
    }
  }

  function clearUser() {
    try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {}
    setUser(null);
  }

  function setUser(user) {
    currentUser = user || null;
    renderUser();
    listeners.forEach((fn) => {
      try { fn(currentUser); } catch (e) { console.warn(e); }
    });
    markReady(currentUser);
  }

  function closeAuthFrame() {
    authOverlay?.remove();
    authOverlay = null;
    authFrame = null;
    try { authPopup && !authPopup.closed && authPopup.close(); } catch (e) {}
    authPopup = null;
  }

  function syncUserProfile(user) {
    if (!user || !window.PIXELTubeAPI?.syncUser) return;
    const profile = window.PIXELTubeSettings?.get?.() || {};
    window.PIXELTubeAPI.syncUser(user, profile).catch((error) => {
      console.warn('[PIXELTube] Could not sync the PIXLECT profile to Bunny Storage:', error);
      window.dispatchEvent(new CustomEvent('pixeltube:profilesyncerror', {
        detail: { message: error.message }
      }));
    });
  }

  // ----------------------------------------------------------------
  // Popup login
  // ----------------------------------------------------------------
  function login() {
    if (authFrame) {
      authFrame.contentWindow?.focus();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'pixlect-auth-overlay';
    overlay.innerHTML = `
      <section class="pixlect-auth-dialog" role="dialog" aria-modal="true" aria-label="Sign in with PIXLECT">
        <div class="pixlect-auth-heading">
          <span>Sign in with PIXLECT</span>
          <div class="pixlect-auth-controls">
            <a class="pixlect-auth-popout" href="${CONFIG.authUrl}" target="pixlect-auth">Open in new window</a>
            <button type="button" class="pixlect-auth-close" aria-label="Close sign-in">×</button>
          </div>
        </div>
        <p class="pixlect-auth-help">If the sign-in panel stays blank, use “Open in new window.”</p>
        <iframe class="pixlect-auth-frame" title="PIXLECT Account sign-in"></iframe>
      </section>
    `;
    const frame = overlay.querySelector('iframe');
    overlay.querySelector('.pixlect-auth-popout').addEventListener('click', event => {
      event.preventDefault();
      const width = 520;
      const height = 640;
      const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
      const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
      authPopup = window.open(
        CONFIG.authUrl,
        'pixlect-auth',
        `width=${width},height=${height},left=${left},top=${top},` +
        'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
      );
      if (!authPopup) {
        overlay.querySelector('.pixlect-auth-help').textContent =
          'The browser blocked the sign-in window. Allow popups or continue in the embedded panel.';
      }
    });
    overlay.querySelector('.pixlect-auth-close').addEventListener('click', () => {
      closeAuthFrame();
      window.dispatchEvent(new CustomEvent('pixeltube:authpopupclosed'));
    });
    document.body.appendChild(overlay);
    authOverlay = overlay;
    authFrame = frame;
    frame.src = CONFIG.authUrl;
  }

  // ----------------------------------------------------------------
  // Message listener (encrypted payload)
  // ----------------------------------------------------------------
  window.addEventListener('message', async (ev) => {
    if (ev.data?.type === 'PIXLECT_AUTH_ENC') {
      console.info('[PIXELTube] Received a PIXLECT sign-in response from', ev.origin);
    }
    if (!CONFIG.trustedOrigins.includes(ev.origin)) {
      if (ev.source === authFrame?.contentWindow) {
        window.dispatchEvent(new CustomEvent('pixeltube:autherror', {
          detail: { message: `PIXLECT replied from an unrecognized address (${ev.origin}).` }
        }));
      }
      return;
    }

    const data = ev.data;
    if (!data || data.type !== 'PIXLECT_AUTH_ENC') {
      if (ev.source === authFrame?.contentWindow || ev.source === authPopup) {
        window.dispatchEvent(new CustomEvent('pixeltube:autherror', {
          detail: { message: 'PIXLECT returned an unexpected sign-in response. Please try again.' }
        }));
      }
      return;
    }
    if (ev.source !== authFrame?.contentWindow && ev.source !== authPopup) return;

    let payload;
    try {
      const c = getCrypto();
      payload = await c.open(data.envelope);
    } catch (err) {
      console.warn('[PIXELTube] Rejected auth message:', err.message);
      closeAuthFrame();
      window.dispatchEvent(new CustomEvent('pixeltube:autherror', {
        detail: { message: 'PIXLECT sign-in could not be verified. Please try again.' }
      }));
      return;
    }

    if (payload.app !== CONFIG.app) {
      closeAuthFrame();
      window.dispatchEvent(new CustomEvent('pixeltube:autherror', {
        detail: { message: 'The sign-in response was for a different app.' }
      }));
      return;
    }

    if (payload.status === 'success' && payload.user) {
      await saveUser(payload.user);
      onSuccessfulLogin(payload.user);
      closeAuthFrame();
    } else if (payload.status === 'denied') {
      onDenied();
      closeAuthFrame();
      window.dispatchEvent(new CustomEvent('pixeltube:autherror', {
        detail: { message: 'PIXLECT sign-in was not completed. Please try again.' }
      }));
    } else {
      closeAuthFrame();
      window.dispatchEvent(new CustomEvent('pixeltube:autherror', {
        detail: { message: 'PIXLECT returned an incomplete sign-in response. Please try again.' }
      }));
    }
  });

  // ----------------------------------------------------------------
  // Hooks
  // ----------------------------------------------------------------
  function onSuccessfulLogin(user) {
    syncUserProfile(user);
    console.log('[PIXELTube] signed in as', user.username);
  }

  function onDenied() {
    console.log('[PIXELTube] sign-in denied by user');
  }

  function logout() {
    clearUser();
    // fetch('/api/pixeltube/logout', { method: 'POST', credentials: 'include' });
  }

  // ----------------------------------------------------------------
  // Rendering
  // ----------------------------------------------------------------
  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function iconMarkup(icon, size) {
    const i = icon || {};
    const emoji = i.emoji || '🦊';
    const bg = i.bg || 'linear-gradient(135deg,#7c5cff,#22d3ee)';
    const shape = i.shape || 'squircle';

    let radius = '28%', clip = 'none';
    if (shape === 'circle') radius = '50%';
    if (shape === 'hex') {
      radius = '0';
      clip = 'polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)';
    }

    return `<span style="
      display:inline-grid;place-items:center;
      width:${size}px;height:${size}px;
      font-size:${Math.round(size * 0.55)}px;line-height:1;
      background:${bg};border-radius:${radius};clip-path:${clip};
      vertical-align:middle;flex:none;
    ">${escapeHtml(emoji)}</span>`;
  }

  function renderUser() {
    const btn  = document.getElementById('pixlect-login');
    const slot = document.getElementById('pixlect-user');

    if (currentUser) {
      if (btn)  btn.hidden = true;
      if (slot) slot.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          ${iconMarkup(currentUser.icon, 36)}
          <div style="line-height:1.2">
            <strong>${escapeHtml(currentUser.username)}</strong><br>
            <small style="color:#8fa0c4">Signed in with PIXLECT</small>
          </div>
          <button
            type="button"
            id="pixlect-logout"
            style="margin-left:auto;padding:6px 12px;border-radius:8px;
                   border:1px solid #22304f;background:#141d33;
                   color:#e8eefc;font-size:12px;cursor:pointer">
            Sign out
          </button>
        </div>
      `;
      const out = document.getElementById('pixlect-logout');
      if (out) out.onclick = logout;
    } else {
      if (btn)  btn.hidden = false;
      if (slot) slot.innerHTML = '';
    }
  }

  // ----------------------------------------------------------------
  // Bind the login button (and re-bind if HTML changes later)
  // ----------------------------------------------------------------
  function bindButton() {
    const btn = document.getElementById('pixlect-login');
    if (!btn || btn.__pixlectBound) return;
    btn.__pixlectBound = true;
    btn.addEventListener('click', login);
  }

  // ----------------------------------------------------------------
  // Init
  // ----------------------------------------------------------------
  async function init() {
    bindButton();
    const saved = await loadUser();
    setUser(saved);
    syncUserProfile(saved);

    // Re-bind if the button is injected later by SPA / lazy render
    if (document.body) {
      const mo = new MutationObserver(bindButton);
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // ----------------------------------------------------------------
  // Public API
  // ----------------------------------------------------------------
  window.PIXELTubeAuth = {
    get user() { return currentUser; },

    login,
    logout,

    onChange(fn) {
      listeners.add(fn);
      // Fire once with current value (may be null before init completes)
      if (readyResolved) {
        try { fn(currentUser); } catch (e) { console.warn(e); }
      } else {
        readyPromise.then((u) => { try { fn(u); } catch (e) { console.warn(e); } });
      }
      return () => listeners.delete(fn);
    },

    ready() {
      return readyPromise;
    }
  };

  window.addEventListener('pixeltube:profilesettingschange', () => syncUserProfile(currentUser));
})();