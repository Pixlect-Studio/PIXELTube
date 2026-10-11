/* Vertical TikTok-style Mini viewer + the standalone Minis feed. */
import { esc, fmt, avatarHTML, thumbHTML } from './helpers.js';

export function viewMiniViewer(ctx, currentVid) {
  const { minisSorted, chanOf, emptyState } = ctx;
  const list = minisSorted();
  if (!list.length) {
    return emptyState('⚡', 'Mini not found', 'It may have been removed.',
      `<a class="btn-ghost" href="#/minis">Back to Minis</a>`);
  }
  const exists = list.some(v => v.id === currentVid);
  const startAt = exists ? currentVid : list[0].id;

  return list.map(v => {
    const c = chanOf(v.id);
    return `
    <section class="mini" data-mini="${esc(v.id)}" id="mini-${esc(v.id)}">
      <div class="mini-inner">
        <video data-vid="${esc(v.id)}" loop muted playsinline preload="metadata" poster="${esc(v.thumb || '')}"></video>
        <div class="shade"></div>
        <button class="mute-btn" data-action="mute">🔇</button>
        <a class="mini-close" href="#/minis" title="Back to Minis">✕</a>
        <div class="rail">
          <button class="rail-btn" data-action="like" data-video="${esc(v.id)}" data-dyn="like">
            <span class="circ"><svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg></span>
            <span class="lbl">${fmt(v.likes)}</span>
          </button>
          <button class="rail-btn" data-action="sub" data-channel="${esc(c.id)}" data-dyn="sub" title="Subscribe">
            <span class="circ"><svg viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 4.5V21h16v-2.5C20 16 16 14 12 14z"/></svg></span>
          </button>
          <button class="rail-btn" data-action="share" data-video="${esc(v.id)}" title="Share">
            <span class="circ"><svg viewBox="0 0 24 24"><path d="M14 9V5l7 7-7 7v-4.1C9.5 12.9 5.6 14.4 3 18c.5-4.5 2.9-8 11-9z"/></svg></span>
          </button>
        </div>
        <div class="bottom">
          <div class="ch">
            ${avatarHTML(c, 'sm')}
            <a class="nm" href="#/channel/${esc(c.id)}">${esc(c.name)}</a>
          </div>
          <h3>${esc(v.title)}</h3>
          <div class="views" data-dyn="views" data-video="${esc(v.id)}">${fmt(v.views)} views</div>
        </div>
      </div>
    </section>`;
  }).join('');
}

export function viewMinis(ctx) {
  const { minisSorted, chanOf, esc, fmt, avatarHTML, emptyState, hasChannel, PIXLECT } = ctx;
  const list = minisSorted();
  if (!list.length) {
    return emptyState('⚡', 'No Minis yet',
      PIXLECT.user
        ? (hasChannel()
            ? 'Upload a Mini — a short vertical video — to fill this feed.'
            : 'Create your PIXELChannel to start uploading Minis.')
        : 'Sign in with PIXLECT to upload Minis.',
      PIXLECT.user
        ? (hasChannel()
            ? `<a class="btn-ghost" href="#/create">Upload a Mini</a>`
            : `<button class="btn-primary" id="emptyCreateChannel">Create your PIXELChannel</button>`)
        : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))">Sign in with PIXLECT</button>`);
  }
  return list.map(v => {
    const c = chanOf(v.id);
    return `
    <section class="mini" data-mini="${esc(v.id)}">
      <div class="mini-inner">
        <video data-vid="${esc(v.id)}" loop muted playsinline preload="metadata" poster="${esc(v.thumb || '')}"></video>
        <div class="shade"></div>
        <button class="mute-btn" data-action="mute">🔇</button>
        <div class="rail">
          <button class="rail-btn" data-action="like" data-video="${esc(v.id)}" data-dyn="like">
            <span class="circ"><svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg></span>
            <span class="lbl">${fmt(v.likes)}</span>
          </button>
          <button class="rail-btn" data-action="sub" data-channel="${esc(c.id)}" data-dyn="sub" title="Subscribe">
            <span class="circ"><svg viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 4.5V21h16v-2.5C20 16 16 14 12 14z"/></svg></span>
          </button>
        </div>
        <div class="bottom">
          <div class="ch">
            ${avatarHTML(c, 'sm')}
            <a class="nm" href="#/channel/${esc(c.id)}">${esc(c.name)}</a>
          </div>
          <h3>${esc(v.title)}</h3>
          <div class="views" data-dyn="views" data-video="${esc(v.id)}">${fmt(v.views)} views</div>
        </div>
      </div>
    </section>`;
  }).join('');
}

export function setupMinis(ctx) {
  const { registerView } = ctx;
  if (window.__miniObserver) window.__miniObserver.disconnect();
  const vids = document.querySelectorAll('.mini video');
  if (!vids.length) return;
  window.__miniObserver = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const v = en.target;
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        v.play().catch(() => {});
        if (v.dataset.vid) registerView(v.dataset.vid);
      } else {
        v.pause();
      }
    });
  }, { threshold: [0, 0.6, 1] });
  vids.forEach(v => window.__miniObserver.observe(v));
}