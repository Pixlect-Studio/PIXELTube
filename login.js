/* =====================================================================
   PIXELTube × PIXLECT Account Network — login.js (Static Version)
   ===================================================================== */

(function () {
  'use strict';

  const CONFIG = {
    app: 'PIXELTube',
    authUrl: 'https://www.account.pixlect-studios.com/?app=PIXELTube&mode=popup',
    trustedOrigins: [
      'https://accounts.pixlect-studios.com',
      'https://www.accounts.pixlect-studios.com',
      'https://account.pixlect-studios.com',
      'https://www.account.pixlect-studios.com'
    ],
    // Static path: /domain.json sits right next to index.html
    domainJsonUrl: '/domain.json',
    storageKey: 'pixeltube:pixlect_user',
    sessionTTL: 24 * 60 * 60 * 1000,
    popupWidth: 520,
    popupHeight: 640
  };

  const TAG = '[PIXELTubeAuth]';
  function log(...a) { console.log(TAG, ...a); }
  function warn(...a) { console.warn(TAG, ...a); }
  function err(...a) { console.error(TAG, ...a); }

  function showFatal(btn, msg) {
    err(msg);
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = 'Sign in with PIXELTube (error — see console)';
    btn.title = msg;
  }

  let registryReady = false;

  function getCrypto() {
    const c = window.PixlectCrypto;
    if (!c || typeof c.seal !== 'function' || typeof c.open !== 'function') {
      throw new Error('pixlect-crypto.js missing. Add <script src="/pixlect-crypto.js"></script> before login.js.');
    }
    return c;
  }

  async function ensureRegistry() {
    if (registryReady) return;
    try {
      await getCrypto().loadRegistry(CONFIG.domainJsonUrl);
      registryReady = true;
    } catch (e) {
      throw new Error('Could not load domain.json at ' + CONFIG.domainJsonUrl + ': ' + e.message);
    }
  }

  let currentUser = null;
  let popup = null;
  let authFrame = null;
  let authOverlay = null;
  let readyResolved = false;
  let readyResolve;
  const readyPromise = new Promise((r) => { readyResolve = r; });
  const listeners = new Set();

  function markReady(u) {
    if (readyResolved) return;
    readyResolved = true;
    readyResolve(u);
  }

  async function saveUser(user) {
    try {
      await ensureRegistry();
      await getCrypto().saveSession(CONFIG.app, CONFIG.storageKey, user, CONFIG.sessionTTL);
    } catch (e) { warn('Could not save session:', e); }
    setUser(user);
  }

  async function loadUser() {
    try {
      await ensureRegistry();
      return await getCrypto().loadSession(CONFIG.app, CONFIG.storageKey);
    } catch (e) { return null; }
  }

  function clearUser() {
    try { localStorage.removeItem(CONFIG.storageKey); } catch (e) {}
    setUser(null);
  }

  function setUser(user) {
    currentUser = user || null;
    renderUser();
    listeners.forEach((fn) => {
      try { fn(currentUser); } catch (e) { warn(e); }
    });
    markReady(currentUser);
  }

  function closeAuth() {
    authOverlay?.remove();
    authOverlay = null;
    authFrame = null;
    try { popup && !popup.closed && popup.close(); } catch (e) {}
    popup = null;
  }

  function login() {
    if (authOverlay) {
      authFrame?.contentWindow?.focus();
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
    overlay.querySelector('.pixlect-auth-popout').addEventListener('click', (event) => {
      event.preventDefault();
      const width = CONFIG.popupWidth;
      const height = CONFIG.popupHeight;
      const left = Math.max(0, window.screenX + (window.outerWidth - width) / 2);
      const top = Math.max(0, window.screenY + (window.outerHeight - height) / 2);
      popup = window.open(
        CONFIG.authUrl,
        'pixlect-auth',
        `width=${width},height=${height},left=${left},top=${top},` +
        'menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes'
      );
    });
    overlay.querySelector('.pixlect-auth-close').addEventListener('click', () => {
      closeAuth();
    });
    document.body.appendChild(overlay);
    authOverlay = overlay;
    authFrame = frame;
    frame.src = CONFIG.authUrl;
  }

  window.addEventListener('message', async (ev) => {
    if (!CONFIG.trustedOrigins.includes(ev.origin)) return;
    if (ev.source !== authFrame?.contentWindow && ev.source !== popup) return;
    const data = ev.data;
    if (!data || data.type !== 'PIXLECT_AUTH_ENC') return;

    let payload;
    try {
      await ensureRegistry();
      payload = await getCrypto().open(CONFIG.app, data.envelope);
    } catch (e) {
      err('Rejected encrypted auth message:', e.message);
      closeAuth();
      return;
    }
    
    if (payload && payload.app === CONFIG.app) {
      if (payload.status === 'success' && payload.user) {
        await saveUser(payload.user);
        closeAuth();
      } else if (payload.status === 'denied') {
        closeAuth();
      }
    }
  });

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[c]));
  }

  function iconMarkup(icon, size) {
    const i = icon || {};
    const emoji = i.emoji || '🦊';
    const bg = i.bg || 'linear-gradient(135deg,#7c5cff,#22d3ee)';
    const shape = i.shape || 'squircle';
    let radius = '28%', clip = 'none';
    if (shape === 'circle') radius = '50%';
    if (shape === 'hex') { radius = '0'; clip = 'polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)'; }
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
      if (btn) { btn.hidden = true; }
      if (slot) {
        slot.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">
            ${iconMarkup(currentUser.icon, 36)}
            <div style="line-height:1.2">
              <strong>${escapeHtml(currentUser.username)}</strong><br>
              <small style="color:#8fa0c4">Signed in with PIXLECT</small>
            </div>
            <button type="button" id="pixlect-logout"
              style="margin-left:auto;padding:6px 12px;border-radius:8px;
                     border:1px solid #22304f;background:#141d33;
                     color:#e8eefc;font-size:12px;cursor:pointer">
              Sign out
            </button>
          </div>`;
        document.getElementById('pixlect-logout').onclick = clearUser;
      }
    } else {
      if (btn) { btn.hidden = false; }
      if (slot) slot.innerHTML = '';
    }
  }

  function bindButton() {
    const btn = document.getElementById('pixlect-login');
    if (!btn || btn.__pixlectBound) return;
    btn.__pixlectBound = true;
    try { getCrypto(); } catch (e) { showFatal(btn, e.message); return; }
    btn.addEventListener('click', login);
  }

  async function init() {
    try { getCrypto(); } catch (e) { showFatal(document.getElementById('pixlect-login'), e.message); return; }
    try { await ensureRegistry(); } catch (e) { showFatal(document.getElementById('pixlect-login'), e.message); return; }
    
    bindButton();
    const saved = await loadUser();
    setUser(saved);

    if (document.body) {
      new MutationObserver(bindButton).observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.PIXELTubeAuth = {
    get user() { return currentUser; },
    login,
    logout: clearUser,
    onChange(fn) {
      listeners.add(fn);
      if (readyResolved) fn(currentUser);
      else readyPromise.then(fn);
      return () => listeners.delete(fn);
    },
    ready() { return readyPromise; }
  };
})();