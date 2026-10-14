/* ============================================================
   PIXELTube — env.js
   Loads .env at runtime in the browser.

   Browsers can't read .env files natively, so we fetch the file
   as plain text, parse KEY=VALUE pairs, and cache the result.

   Usage:
     import { loadEnv, getEnv } from './env.js';
     const env = await loadEnv();
     const key = env.BUNNY_STREAM_API_KEY;
   ============================================================ */

const ENV_PATH = './data.env';

let envCache = null;
let envPromise = null;

/**
 * Fetch and parse .env once. Subsequent calls return the cached
 * object immediately (no extra network request).
 */
export function loadEnv() {
  if (envCache) return Promise.resolve(envCache);
  if (envPromise) return envPromise;

  envPromise = fetch(ENV_PATH, { cache: 'no-store' })
    .then((res) => {
      if (!res.ok) throw new Error(`${ENV_PATH} returned ${res.status}`);
      return res.text();
    })
    .then((text) => {
      const env = parseEnv(text);
      envCache = env;
      console.log('[env] loaded', Object.keys(env).length, 'keys');
      return env;
    })
    .catch((err) => {
      console.warn('[env] failed to load', ENV_PATH, '-', err?.message);
      envCache = {};
      return envCache;
    });

  return envPromise;
}

/** Synchronous access — returns cache or empty object. */
export function getEnv() {
  return envCache || {};
}

/** Force a reload. */
export function reloadEnv() {
  envCache = null;
  envPromise = null;
  return loadEnv();
}

/* ============================================================
   PARSER
   ============================================================ */
function parseEnv(text) {
  const env = {};
  if (!text) return env;

  text.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('#')) return;

    const eq = trimmed.indexOf('=');
    if (eq === -1) return;

    const key = trimmed.slice(0, eq).trim();
    if (!key) return;

    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  });

  return env;
}

/* Convenience getters */
export function bunnyLibraryId() { return getEnv().BUNNY_LIBRARY_ID || ''; }
export function bunnyStreamKey() { return getEnv().BUNNY_STREAM_API_KEY || ''; }
export function bunnyCdnHost()   { return getEnv().BUNNY_CDN_HOST || ''; }
