/**
 * theme-init.js — Theme + font picker with automatic font discovery.
 * Supports sub-folders inside the font directory.
 */
(function () {
  'use strict';

  const THEME_KEY = 'pixeltube:theme';
  const FONT_KEY  = (t) => `pixeltube:font:${t}`;

  const THEMES = [
    { id: 'white',  name: 'White',  desc: 'Clean & minimal',   icon: '☀️' },
    { id: 'gaming', name: 'Gaming', desc: 'Neon & dark vibes', icon: '🎮' },
  ];

  // ----------------------------------------------------------
  // Font discovery
  // ----------------------------------------------------------
  async function fileExists(url) {
    try {
      const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  // Get file extension to tell the browser what format it is (.ttf, .woff2, etc)
  function getFormatString(filename) {
    if (filename.endsWith('.woff2')) return 'woff2';
    if (filename.endsWith('.woff')) return 'woff';
    if (filename.endsWith('.ttf')) return 'truetype';
    if (filename.endsWith('.otf')) return 'opentype';
    return 'woff2'; // fallback
  }

  async function loadManifest(themeId) {
    try {
      const res = await fetch(`theme/${themeId}/font/fonts.json`, { cache: 'no-store' });
      if (!res.ok) return null;
      const data = await res.json();
      if (!Array.isArray(data)) return null;

      const verified = [];
      for (const entry of data) {
        if (!entry.family || !entry.files) continue;

        const files = {};
        for (const [weight, filename] of Object.entries(entry.files)) {
          const url = `theme/${themeId}/font/${filename}`;
          if (await fileExists(url)) {
            files[weight] = filename;
          } else {
            console.warn(`[PIXELTube] Font file missing: ${url}`);
          }
        }
        
        // Only offer the font if at least the Regular (400) weight exists
        if (files['400']) {
          verified.push({ family: entry.family, files });
        }
      }
      return verified;
    } catch (e) {
      return null;
    }
  }

  async function listFonts(themeId) {
    return await loadManifest(themeId) || [];
  }

  // ----------------------------------------------------------
  // CSS injection
  // ----------------------------------------------------------
  function loadThemeCSS(themeId) {
    document.querySelectorAll('link[data-pixeltube-theme]').forEach(l => l.remove());
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `theme/${themeId}/style.css`;
    link.setAttribute('data-pixeltube-theme', themeId);
    document.head.appendChild(link);
  }

  function injectFontFaces(themeId, fonts) {
    document.querySelectorAll('style[data-pixeltube-fontfaces]').forEach(s => s.remove());
    if (!fonts || !fonts.length) return;

    const base = `theme/${themeId}/font/`;
    const css = fonts.map(f =>
      Object.entries(f.files).map(([weight, file]) => {
        const format = getFormatString(file);
        return `
        @font-face {
          font-family: '${f.family}';
          src: url('${base}${file}') format('${format}');
          font-weight: ${weight};
          font-style: normal;
          font-display: swap;
        }`;
      }).join('')
    ).join('\n');

    const style = document.createElement('style');
    style.setAttribute('data-pixeltube-fontfaces', themeId);
    style.textContent = css;
    document.head.appendChild(style);
  }

  function applyFontFamily(themeId, family) {
    document.querySelectorAll('style[data-pixeltube-fontapply]').forEach(s => s.remove());
    const style = document.createElement('style');
    style.setAttribute('data-pixeltube-fontapply', themeId);
    style.textContent = family
      ? `[data-theme="${themeId}"] { --font: '${family}', system-ui, sans-serif; }`
      : '';
    document.head.appendChild(style);
  }

  // ----------------------------------------------------------
  // Storage
  // ----------------------------------------------------------
  function saveTheme(themeId) {
    try { localStorage.setItem(THEME_KEY, themeId); } catch (e) {}
  }
  function saveFont(themeId, family) {
    try {
      if (family) localStorage.setItem(FONT_KEY(themeId), family);
      else localStorage.removeItem(FONT_KEY(themeId));
    } catch (e) {}
  }
  function getSavedTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }
  function getSavedFont(themeId) {
    try { return localStorage.getItem(FONT_KEY(themeId)); } catch (e) { return null; }
  }

  // ----------------------------------------------------------
  // Apply full state
  // ----------------------------------------------------------
  async function apply(themeId, fontFamily) {
    if (!THEMES.some(t => t.id === themeId)) themeId = 'white';

    document.documentElement.setAttribute('data-theme', themeId);
    loadThemeCSS(themeId);
    saveTheme(themeId);

    const fonts = await listFonts(themeId);
    injectFontFaces(themeId, fonts);

    let chosen = null;
    if (fontFamily) chosen = fonts.find(f => f.family === fontFamily);
    if (!chosen && fonts.length) chosen = fonts[0];

    applyFontFamily(themeId, chosen ? chosen.family : null);
    saveFont(themeId, chosen ? chosen.family : null);

    window.dispatchEvent(new CustomEvent('pixeltube:themechange', {
      detail: { theme: themeId, font: chosen ? chosen.family : null },
    }));
  }

  // ----------------------------------------------------------
  // Pickers
  // ----------------------------------------------------------
  function buildThemePicker() {
    const backdrop = document.createElement('div');
    backdrop.className = 'theme-picker-backdrop';
    backdrop.innerHTML = `
      <div class="theme-picker-card">
        <h2 class="theme-picker-title">Choose your theme</h2>
        <p class="theme-picker-sub">Pick a look — you'll choose a font next.</p>
        <div class="theme-picker-grid">
          ${THEMES.map(t => `
            <button class="theme-option" data-theme-id="${t.id}">
              <span class="theme-option-icon">${t.icon}</span>
              <span class="theme-option-name">${t.name}</span>
              <span class="theme-option-desc">${t.desc}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;
    return backdrop;
  }

  function buildFontPicker(themeId, fonts) {
    const backdrop = document.createElement('div');
    backdrop.className = 'theme-picker-backdrop';
    const themeName = (THEMES.find(t => t.id === themeId) || {}).name || themeId;

    backdrop.innerHTML = `
      <div class="theme-picker-card">
        <h2 class="theme-picker-title">Pick a font</h2>
        <p class="theme-picker-sub">
          ${fonts.length} font${fonts.length === 1 ? '' : 's'} found for the <strong>${themeName}</strong> theme.
        </p>
        <div class="font-picker-grid">
          ${fonts.map(f => `
            <button class="font-option" data-font-family="${f.family}">
              <span class="font-option-preview" style="font-family:'${f.family}',system-ui,sans-serif">
                Aa Bb 123
              </span>
              <span class="font-option-name">${f.family}</span>
            </button>
          `).join('')}
        </div>
        <div class="font-picker-actions">
          <button class="btn btn-ghost" data-action="skip">Use theme default</button>
        </div>
      </div>
    `;
    return backdrop;
  }

  function showThemePicker() {
    return new Promise(resolve => {
      const modal = buildThemePicker();
      document.body.appendChild(modal);
      modal.querySelectorAll('.theme-option').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.remove();
          resolve(btn.getAttribute('data-theme-id'));
        });
      });
    });
  }

  function showFontPicker(themeId, fonts) {
    return new Promise(resolve => {
      const modal = buildFontPicker(themeId, fonts);
      document.body.appendChild(modal);
      modal.querySelectorAll('.font-option').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.remove();
          resolve(btn.getAttribute('data-font-family'));
        });
      });
      modal.querySelector('[data-action="skip"]').addEventListener('click', () => {
        modal.remove();
        resolve(null);
      });
    });
  }

  // ----------------------------------------------------------
  // Boot
  // ----------------------------------------------------------
  async function boot() {
    const savedTheme = getSavedTheme();

    if (savedTheme) {
      await apply(savedTheme, getSavedFont(savedTheme));
      return;
    }

    document.documentElement.setAttribute('data-theme', 'white');
    loadThemeCSS('white');

    await apply('white', null);
  }

  // ----------------------------------------------------------
  // Public API & Start
  // ----------------------------------------------------------
  window.PIXELTubeTheme = {
    set: async (themeId, fontFamily) => {
      const valid = THEMES.some(t => t.id === themeId);
      await apply(valid ? themeId : 'white', fontFamily || null);
    },
    get: () => {
      const theme = document.documentElement.getAttribute('data-theme') || 'white';
      return { theme, font: getSavedFont(theme) };
    },
    list: () => THEMES.slice(),
    listFonts: (themeId) => listFonts(themeId),
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();