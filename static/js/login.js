  // ------------------------------------------------------------------
  // Session (encrypted, with plain fallback + legacy migration)
  // ------------------------------------------------------------------
  const LEGACY_KEY = 'pixeltube_pixlect';

  async function saveUser(user) {
    let persisted = false;

    // 1. Try encrypted save and verify the round-trip
    try {
      await getCrypto().saveSession(CONFIG.storageKey, user, CONFIG.sessionTTL);
      const check = await getCrypto().loadSession(CONFIG.storageKey);
      if (check && check.username === user.username) {
        persisted = true;
      } else {
        warn('saveSession did not round-trip — pixlect-crypto.js may be broken');
      }
    } catch (e) {
      warn('Encrypted saveSession failed:', e);
    }

    // 2. Plain localStorage fallback (self-healing until crypto is fixed)
    if (!persisted) {
      try {
        localStorage.setItem(CONFIG.storageKey, JSON.stringify({
          v: 1,
          plain: true,
          savedAt: Date.now(),
          expiresAt: Date.now() + CONFIG.sessionTTL,
          user
        }));
        persisted = true;
        warn(
          'FALLBACK ACTIVE — session saved in PLAIN TEXT because ' +
          'PixlectCrypto.saveSession() failed. Site works, but sessions ' +
          'are NOT encrypted until pixlect-crypto.js is fixed.'
        );
      } catch (e) {
        warn('Plain fallback also failed:', e);
      }
    }

    setUser(user);
  }

  async function loadUser() {
    // 1. Encrypted
    try {
      const u = await getCrypto().loadSession(CONFIG.storageKey);
      if (u) return u;
    } catch (e) {
      warn('Encrypted loadSession failed:', e);
    }

    // 2. Plain fallback
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.plain && parsed.user &&
            parsed.expiresAt > Date.now()) {
          return parsed.user;
        }
      }
    } catch (e) {
      warn('Plain session parse failed:', e);
    }

    return null;
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

    // 3. Legacy migration — pixeltube_pixlect holds a full user object
    if (!saved) {
      try {
        const legacy = localStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (parsed && parsed.username) {
            saved = parsed;
            needsMigration = true;
            log('Migrating legacy session for', parsed.username);
          }
        }
      } catch (e) {
        warn('Legacy read failed:', e);
      }
    }

    setUser(saved);
    syncUserProfile(saved);

    // Persist under the new scheme in the background; harmless if it fires setUser again.
    if (needsMigration && saved) {
      saveUser(saved).catch((e) => warn('Migration save failed:', e));
    }

    if (document.body) {
      const mo = new MutationObserver(bindButton);
      mo.observe(document.body, { childList: true, subtree: true });
    }

    log('ready. user =', currentUser ? currentUser.username : 'none',
        needsMigration ? '(migrated from legacy)' : '');
  }