/* =====================================================================
   PIXLECT Crypto — STRICT DOMAIN MODE
   Requires domain.json to exist. No hardcoded fallback keys.
   ===================================================================== */
(function (global) {
  'use strict';

  const TAG = '[PixlectCrypto]';

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const _keyCache = new Map();
  let _registry = null;
  let _registryPromise = null;

  // ----------------------------------------------------------------
  // Registry Loader (Strict)
  // ----------------------------------------------------------------
  async function loadRegistry(url) {
    if (_registryPromise) return _registryPromise;
    
    _registryPromise = fetch(url || '/domain.json', { cache: 'no-store' })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load domain.json (HTTP ${r.status}). Make sure it exists at the root!`);
        return r.json();
      })
      .then((j) => { 
        _registry = j; 
        console.log(TAG, '✅ domain.json loaded successfully.');
        return j; 
      })
      .catch((e) => {
        console.error(TAG, '❌ CRITICAL:', e.message);
        throw e; // Stop execution
      });
      
    return _registryPromise;
  }

  async function getRegistry() {
    if (_registry) return _registry;
    return loadRegistry();
  }

  // ----------------------------------------------------------------
  // Derive a CryptoKey from a raw string (Hashed to 32 bytes)
  // ----------------------------------------------------------------
  async function deriveKey(secretString) {
    if (typeof secretString !== 'string' || secretString.length === 0) {
      throw new Error(TAG + ' ❌ Key material missing in domain.json.');
    }
    
    // Hash to exactly 32 bytes
    const hash = await crypto.subtle.digest('SHA-256', enc.encode(secretString));
    const bytes = new Uint8Array(hash);
    
    return await crypto.subtle.importKey(
      'raw',
      bytes,
      { name: 'AES-GCM' },
      false,
      ['encrypt', 'decrypt']
    );
  }

  // ----------------------------------------------------------------
  // Resolve key for a specific app
  // ----------------------------------------------------------------
  async function getKeyForApp(appName) {
    const cacheKey = appName || '__global__';
    if (_keyCache.has(cacheKey)) return _keyCache.get(cacheKey);

    const reg = await getRegistry();
    if (!reg) throw new Error(TAG + ' ❌ Registry not loaded.');

    let entry = null;
    
    // Support both full registry (auth server) and single-app registry (app)
    if (reg.apps && reg.apps[appName]) {
      entry = reg.apps[appName];
    } else if (reg.app && reg.app.name === appName) {
      entry = reg.app;
    } else if (reg.app && !reg.app.name) {
      // Fallback if the app didn't specify a name in its local domain.json
      entry = reg.app;
    }

    if (!entry || !entry.publicKey) {
      throw new Error(TAG + ` ❌ No publicKey found for app "${appName}" in domain.json.`);
    }

    // Optional: Validate origin
    if (entry.origins && Array.isArray(entry.origins)) {
      const currentOrigin = window.location.origin;
      if (!entry.origins.includes(currentOrigin)) {
        console.warn(TAG, `⚠️ Origin ${currentOrigin} is not explicitly listed in domain.json for ${appName}. Allowed:`, entry.origins);
      }
    }

    const key = await deriveKey(entry.publicKey);
    _keyCache.set(cacheKey, key);
    return key;
  }

  // ----------------------------------------------------------------
  // Base64url Helpers
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
  // Core Encrypt / Decrypt
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
    if (parts.length !== 2) throw new Error(TAG + ' ❌ Bad ciphertext format');
    const iv = b64urlToBytes(parts[0]);
    const ct = b64urlToBytes(parts[1]);
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    return dec.decode(pt);
  }

  // ----------------------------------------------------------------
  // Replay Guard
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
  // Seal / Open
  // ----------------------------------------------------------------
  async function seal(a, b) {
    let appName, payload;
    if (b === undefined) {
      appName = null; payload = a;
    } else {
      appName = a || null; payload = b;
    }

    if (payload === undefined) throw new Error(TAG + ' ❌ seal called with no payload');

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
      appName = null; env = a;
    } else {
      appName = a || null; env = b;
    }

    if (!env || typeof env !== 'object') throw new Error(TAG + ' ❌ open: bad envelope');
    if (env.v !== 1) throw new Error(TAG + ' ❌ open: unsupported version ' + env.v);

    const effectiveApp = env.app || appName || null;
    const now = Date.now();

    if (Math.abs(now - env.ts) > MAX_SKEW_MS) throw new Error(TAG + ' ❌ envelope expired');
    pruneNonces();
    if (env.nonce && seenNonces.has(env.nonce)) throw new Error(TAG + ' ❌ replay detected');

    const key = await getKeyForApp(effectiveApp);
    
    try {
      const json = await decryptWithKey(key, env.ciphertext);
      if (env.nonce) seenNonces.set(env.nonce, now + NONCE_TTL_MS);
      return JSON.parse(json);
    } catch (err) {
      console.error(TAG, `❌ Decryption failed for app "${effectiveApp}". This means the keys in domain.json DO NOT MATCH between the Auth Server and the App.`);
      throw err;
    }
  }

  // ----------------------------------------------------------------
  // Session Helpers
  // ----------------------------------------------------------------
  async function saveSession(a, b, c, d) {
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
      console.warn(TAG, 'Session load failed:', e.message);
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
    _getKeyForApp: getKeyForApp // exposed for debugging
  };
})(typeof window !== 'undefined' ? window : globalThis);