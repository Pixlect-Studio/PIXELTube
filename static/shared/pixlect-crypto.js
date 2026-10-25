/* =====================================================================
   PIXLECT Crypto — dual-mode, self-healing
   Works with BOTH call styles:
     seal(payload)               ← old code
     seal(appName, payload)      ← new code
   Same for open().
   ===================================================================== */
(function (global) {
  'use strict';

  const TAG = '[PixlectCrypto]';

  // ----------------------------------------------------------------
  // Default shared secret (only used if SHARED_SECRET would be missing).
  // If you use domain.json app-scoped keys, this is ignored.
  // ----------------------------------------------------------------
  const DEFAULT_SECRET =
    'a6f1b9d2e4c8f7a3b5d1e9c2f4a8b6d3e1f7c9a5b3d1e8f6a4c2b8d9e7f1a3c5';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  // Cache: appName (or '__global__') -> CryptoKey
  const _keyCache = new Map();
  let _registry = null;
  let _registryPromise = null;

  // ----------------------------------------------------------------
  // Registry (domain.json) — optional
  // ----------------------------------------------------------------
  async function loadRegistry(url) {
    if (_registryPromise) return _registryPromise;
    _registryPromise = fetch(url || '/domain.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error('domain.json HTTP ' + r.status);
        return r.json();
      })
      .then((j) => { _registry = j; return j; })
      .catch((e) => {
        console.warn(TAG, 'registry load failed:', e.message);
        // don't reject — callers can fall back
        _registry = null;
        return null;
      });
    return _registryPromise;
  }

  async function getRegistry() {
    if (_registry) return _registry;
    return loadRegistry();
  }

  // ----------------------------------------------------------------
  // Derive a CryptoKey from a raw string (must yield exactly 32 bytes)
  // ----------------------------------------------------------------
  async function deriveKey(secretString) {
    if (typeof secretString !== 'string' || secretString.length === 0) {
      throw new Error(
        TAG + ' key material missing. Refusing to import empty key. ' +
        'Check that SHARED_SECRET or publicKey is a non-empty string.'
      );
    }

    // Hash to exactly 32 bytes — safe for any input length
    let hash;
    try {
      hash = await crypto.subtle.digest('SHA-256', enc.encode(secretString));
    } catch (e) {
      throw new Error(TAG + ' SHA-256 failed: ' + e.message);
    }

    const bytes = new Uint8Array(hash);
    if (bytes.byteLength !== 32) {
      throw new Error(TAG + ' derived key wrong length: ' + bytes.byteLength);
    }

    try {
      return await crypto.subtle.importKey(
        'raw',
        bytes,
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt']
      );
    } catch (e) {
      // Turn the cryptic DOMException into something actionable
      throw new Error(
        TAG + ' importKey failed: ' + e.message +
        ' (byteLength=' + bytes.byteLength + ')'
      );
    }
  }

  // ----------------------------------------------------------------
  // Resolve a key for a given app (or global)
  // ----------------------------------------------------------------
  async function getKeyForApp(appName) {
    const cacheKey = appName || '__global__';
    if (_keyCache.has(cacheKey)) return _keyCache.get(cacheKey);

    let secret = null;

    // Try domain.json first
    if (appName) {
      const reg = await getRegistry();
      if (reg) {
        let entry = null;
        if (reg.apps && reg.apps[appName]) entry = reg.apps[appName];
        else if (reg.app && reg.app.name === appName) entry = reg.app;
        if (entry && entry.publicKey) secret = entry.publicKey;
      }
      if (!secret) {
        console.warn(TAG, 'no publicKey for "' + appName + '" in domain.json, using DEFAULT_SECRET');
      }
    }

    if (!secret) secret = DEFAULT_SECRET;

    const key = await deriveKey(secret);
    _keyCache.set(cacheKey, key);
    return key;
  }

  // ----------------------------------------------------------------
  // Base64url
  // ----------------------------------------------------------------
  function bytesToB64url(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlToBytes(str) {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // ----------------------------------------------------------------
  // Core encrypt / decrypt
  // ----------------------------------------------------------------
  async function encryptWithKey(key, plaintext) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      enc.encode(plaintext)
    );
    return bytesToB64url(iv) + '.' + bytesToB64url(new Uint8Array(ct));
  }

  async function decryptWithKey(key, packed) {
    const parts = String(packed || '').split('.');
    if (parts.length !== 2) throw new Error(TAG + ' bad ciphertext format');
    const iv = b64urlToBytes(parts[0]);
    const ct = b64urlToBytes(parts[1]);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  }

  // ----------------------------------------------------------------
  // Replay guard
  // ----------------------------------------------------------------
  const seenNonces = new Map();
  const NONCE_TTL_MS = 2 * 60 * 1000;
  const MAX_SKEW_MS  = 60 * 1000;

  function newNonce() {
    return bytesToB64url(crypto.getRandomValues(new Uint8Array(16)));
  }
  function pruneNonces() {
    const now = Date.now();
    for (const [k, exp] of seenNonces) if (exp <= now) seenNonces.delete(k);
  }

  // ----------------------------------------------------------------
  // Sealed envelope — accepts both calling styles
  // ----------------------------------------------------------------
  async function seal(a, b) {
    let appName, payload;
    if (b === undefined) {
      // seal(payload)
      appName = null;
      payload = a;
    } else {
      // seal(appName, payload)
      appName = a || null;
      payload = b;
    }

    if (payload === undefined) {
      throw new Error(TAG + ' seal called with no payload');
    }

    pruneNonces();
    const key = await getKeyForApp(appName);
    return {
      v: 1,
      app: appName,
      ts: Date.now(),
      nonce: newNonce(),
      ciphertext: await encryptWithKey(key, JSON.stringify(payload))
    };
  }

  async function open(a, b) {
    let appName, env;
    if (b === undefined) {
      // open(envelope)
      appName = null;
      env = a;
    } else {
      // open(appName, envelope)
      appName = a || null;
      env = b;
    }

    if (!env || typeof env !== 'object') throw new Error(TAG + ' open: bad envelope');
    if (env.v !== 1) throw new Error(TAG + ' open: unsupported version ' + env.v);

    // If caller specified an app, it must match the envelope (if the envelope has one)
    if (appName && env.app && env.app !== appName) {
      throw new Error(TAG + ' open: app mismatch (' + env.app + ' vs ' + appName + ')');
    }

    const effectiveApp = env.app || appName || null;

    const now = Date.now();
    if (Math.abs(now - env.ts) > MAX_SKEW_MS) throw new Error(TAG + ' envelope expired');
    pruneNonces();
    if (env.nonce && seenNonces.has(env.nonce)) throw new Error(TAG + ' replay detected');

    const key = await getKeyForApp(effectiveApp);
    const json = await decryptWithKey(key, env.ciphertext);

    if (env.nonce) seenNonces.set(env.nonce, now + NONCE_TTL_MS);
    return JSON.parse(json);
  }

  // ----------------------------------------------------------------
  // Session helpers
  // ----------------------------------------------------------------
  async function saveSession(a, b, c, d) {
    // saveSession(appName, storageKey, user, ttl)  OR
    // saveSession(storageKey, user, ttl)
    let appName, storageKey, user, ttl;
    if (typeof b === 'string') {
      appName = a; storageKey = b; user = c; ttl = d;
    } else {
      appName = null; storageKey = a; user = b; ttl = c;
    }
    const payload = { user, exp: Date.now() + (ttl || 24 * 60 * 60 * 1000) };
    const env = await seal(appName, payload);
    localStorage.setItem(storageKey, JSON.stringify(env));
  }

  async function loadSession(a, b) {
    let appName, storageKey;
    if (typeof b === 'string') { appName = a; storageKey = b; }
    else { appName = null; storageKey = a; }

    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    try {
      const env = JSON.parse(raw);
      const data = await open(appName, env);
      if (data.exp && Date.now() > data.exp) {
        localStorage.removeItem(storageKey);
        return null;
      }
      return data.user || null;
    } catch (e) {
      console.warn(TAG, 'session load failed:', e.message);
      localStorage.removeItem(storageKey);
      return null;
    }
  }

  // ----------------------------------------------------------------
  // Export
  // ----------------------------------------------------------------
  global.PixlectCrypto = {
    loadRegistry,
    getRegistry,
    seal,
    open,
    saveSession,
    loadSession,
    newNonce,
    // exposed for debugging
    _getKeyForApp: getKeyForApp,
    _deriveKey: deriveKey
  };
})(typeof window !== 'undefined' ? window : globalThis);