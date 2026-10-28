/* =====================================================================
   PIXELTube × PIXLECT Account Network — login.js  (hardened)
   ---------------------------------------------------------------------
   Requires /static/js/pixlect-crypto.js to be loaded first.
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
    storageKey: 'pixeltube:pixlect_user',
    legacyKey: 'pixeltube_pixlect',
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
    btn.textContent = 'Sign in with PIXLECT (error — see console)';
    btn.title = msg;
  }

  function getCrypto() {
    const c = window.PixlectCrypto;
    if (!c || typeof c.seal !== 'function' || typeof c.open !== 'function') {
      throw new Error('pixlect-crypto.js missing or wrong version.');
    }
    return c;
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
    let persisted = false;
    try {
      await getCrypto().saveSession(CONFIG.storageKey, user, CONFIG.sessionTTL);
      const check = await getCrypto().loadSession(CONFIG.storageKey);
      if (check && check.username === user.username) persisted = true;
    } catch (e) {
      warn('Encrypted saveSession failed:', e);
    }

    if (!persisted) {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({
          v: 1, plain: true, savedAt: Date.now(),
          expiresAt: Date.now() + CONFIG.sessionTTL, user
        }));
        persisted = true;
        warn('FALLBACK ACTIVE — session saved in PLAIN TEXT.');
      } catch (e) {
        warn('Plain fallback also failed:', e);
      }
    }
    setUser(user);
  }

  async function loadUser() {
    try {
      const u = await getCrypto().loadSession(CONFIG.storageKey);
      if (u) return u;
    } catch (e) {
      warn('Encrypted loadSession failed:', e);
    }

    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.plain && parsed.user && parsed.expiresAt > Date.now()) {
          return parsed.user;
        }
      }
    } catch (e) {
      warn('Plain session parse failed:', e);
    }
    return null;
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

  function syncUserProfile(user) {
    if (!user || !window.PIXELTubeAPI?.syncUser) return;
    const profile = window.PIXELTubeSettings?.get?.() || {};
    window.PIXELTubeAPI.syncUser(user, profile).catch((error) => {
      warn('Could not sync profile:', error);
    });
  }

  function login() {
    if (authOverlay) {
      authFrame?.contentWindow?.focus();
      return;
    }

    const overlay = document.createElement('div');
    overlay.className = 'pixlect-auth-overlay';
    overlay.innerHTML = `
      <section class="pixlect-auth-dialog" role="dialog" aria-modal="true">
        <div class="pixlect-auth-heading">
          <span>Sign in with PIXLECT</span>
          <div class="pixlect-auth-controls">
            <a class="pixlect-auth-popout" href="${CONFIG.authUrl}" target="pixlect-auth">Open in new window</a>
            <button type="button" class="pixlect-auth-close">×</button>
          </div>
        </div>
        <iframe class="pixlect-auth-frame" title="PIXLECT Account sign-in"></iframe>
      </section>
    `;
    const frame = overlay.querySelector('iframe');
    
    overlay.querySelector('.pixlect-auth-popout').addEventListener('click', (event) => {
      event.preventDefault();
      popup = window.open(CONFIG.authUrl, 'pixlect-auth', 'width=520,height=640');
    });
    
    overlay.querySelector('.pixlect-auth-close').addEventListener('click', () => {
      closeAuth();
      window.dispatchEvent(new CustomEvent('pixeltube:authpopupclosed'));
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
    if (!data || data.type !== 'PIXELECT_AUTH_ENC') return; // handles common typo

    let payload;
    try {
      payload = await getCrypto().open(data.envelope);
    } catch (e) {
      err('Rejected encrypted auth message:', e.message);
      closeAuth();
      return;
    }
    
    if (!payload || payload.app !== CONFIG.app) {
      warn('Ignored payload for wrong app:', payload && payload.app);
      closeAuth();
      return;
    }

    if (payload.status === 'success' && payload.user) {
      await saveUser(payload.user);
      syncUserProfile(payload.user);
      closeAuth();
    } else {
      closeAuth();
    }
  });

  function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  }

  function iconMarkup(icon, size) {
    const i = icon || {};
    const emoji = i.emoji || '🦊';
    const bg = i.bg || 'linear-gradient(135deg,#7c5cff,#22d3ee)';
    const shape = i.shape || 'squircle';
    let radius = '28%', clip = 'none';
    if (shape === 'circle') radius = '50%';
    if (shape === 'hex') { radius = '0'; clip = 'polygon(50% 0%,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)'; }
    return `<span style="display:inline-grid;place-items:center;width:${size}px;height:${size}px;font-size:${Math.round(size * 0.55)}px;line-height:1;background:${bg};border-radius:${radius};clip-path:${clip};vertical-align:middle;flex:none;">${escapeHtml(emoji)}</span>`;
  }

  function renderUser() {
    const btn  = document.getElementById('pixlect-login');
    const slot = document.getElementById('pixlect-user');

    if (currentUser) {
      if (btn) { btn.hidden = true; btn.textContent = 'Sign in with PIXLECT'; }
      if (slot) {
        slot.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px">
            ${iconMarkup(currentUser.icon, 36)}
            <div style="line-height:1.2">
              <strong>${escapeHtml(currentUser.username)}</strong><br>
              <small style="color:#8fa0c4">Signed in with PIXLECT</small>
            </div>
            <button type="button" id="pixlect-logout" style="margin-left:auto;padding:6px 12px;border-radius:8px;border:1px solid #22304f;background:#141d33;color:#e8eefc;font-size:12px;cursor:pointer">Sign out</button>
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
    log('initializing…');
    try { getCrypto(); } catch (e) {
      err(e.message);
      showFatal(document.getElementById('pixlect-login'), e.message);
      return;
    }

    bindButton();

    let saved = await loadUser();
    let needsMigration = false;

    if (!saved) {
      try {
        const legacy = localStorage.getItem(CONFIG.legacyKey);
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (parsed && parsed.username) {
            saved = parsed;
            needsMigration = true;
            log('Migrating legacy session for', parsed.username);
          }
        }
      } catch (e) {}
    }

    setUser(saved);
    syncUserProfile(saved);

    if (needsMigration && saved) {
      saveUser(saved).catch(() => {});
    }

    if (document.body) {
      new MutationObserver(bindButton).observe(document.body, { childList: true, subtree: true });
    }

    log('ready. user =', currentUser ? currentUser.username : 'none');
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
      if (readyResolved) { try { fn(currentUser); } catch (e) {} }
      else { readyPromise.then((u) => { try { fn(u); } catch (e) {} }); }
      return () => listeners.delete(fn);
    },
    ready() { return readyPromise; }
  };
})();