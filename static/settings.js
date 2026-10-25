(function () {
  'use strict';

  const STORAGE_KEY = 'pixeltube:profile-settings:v1';
  const DEFAULTS = { name: '', channel: '', accent: '#0c1062' };
  const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;

  function get() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return {
        name: typeof saved.name === 'string' ? saved.name : DEFAULTS.name,
        channel: typeof saved.channel === 'string' ? saved.channel : DEFAULTS.channel,
        accent: COLOR_PATTERN.test(saved.accent || '') ? saved.accent : DEFAULTS.accent,
      };
    } catch (error) {
      console.error('Could not load PIXELTube profile settings:', error);
      return { ...DEFAULTS };
    }
  }

  function applyAccent() {
    const { accent } = get();
    document.documentElement.style.setProperty('--brand', accent);
    document.documentElement.style.setProperty('--brand-hover', `color-mix(in srgb, ${accent} 82%, #000)`);
    document.documentElement.style.setProperty('--accent', accent);
  }

  function save(values) {
    const name = String(values.name || '').trim();
    const channel = String(values.channel || '').trim();
    const accent = String(values.accent || '').trim();
    if (name.length > 50) throw new Error('Display name must be 50 characters or fewer.');
    if (channel.length > 50) throw new Error('Channel name must be 50 characters or fewer.');
    if (!COLOR_PATTERN.test(accent)) throw new Error('Choose a valid 6-digit accent color.');

    const profile = { name, channel, accent };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
    } catch (error) {
      throw new Error(`Could not save settings in this browser: ${error.message}`);
    }
    applyAccent();
    window.dispatchEvent(new CustomEvent('pixeltube:profilesettingschange', { detail: profile }));
    return profile;
  }

  window.PIXELTubeSettings = { get, save, applyAccent };
  applyAccent();
  window.addEventListener('pixeltube:themechange', applyAccent);
})();
