/* ============================================================
   PIXELTube — video_mini.js
   Vertical TikTok-style Mini viewer + paginated Minis feed.
   Audio is on by default. Feed loads 5 at a time as you scroll.
   Includes like, dislike, subscribe, share, report, and admin delete.
   ============================================================ */
import { esc, fmt, avatarHTML, thumbHTML } from './helpers.js';

/* How many Minis to render per batch. */
const MINI_BATCH = 5;

/* Pagination state — reset on every fresh render of #/minis. */
let loadedCount = 0;
let loadingBatch = false;
let scrollListenerAttached = false;

/* ============================================================
   MINI VIEWER — one Mini per screen at #/mini/{vid}
   ============================================================ */
export function viewMiniViewer(ctx, currentVid) {
  const { minisSorted, chanOf, emptyState, PIXLECT, isAdmin } = ctx;
  const list = minisSorted();
  if (!list.length) {
    return emptyState('⚡', 'Mini not found', 'It may have been removed.',
      `<a class="btn-ghost" href="#/minis">Back to Minis</a>`);
  }

  return list.map(v => miniSectionHTML(v, ctx, { viewerMode: true })).join('');
}

/* ============================================================
   MINIS FEED — #/minis
   Loads first batch immediately, appends more as you scroll.
   ============================================================ */
export function viewMinis(ctx) {
  const { minisSorted, emptyState, hasChannel, PIXLECT } = ctx;
  const list = minisSorted();

  /* Reset pagination on a fresh render */
  loadedCount = 0;
  loadingBatch = false;

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
            : `<button class="btn-primary" id="emptyCreateChannel" type="button">Create your PIXELChannel</button>`)
        : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }

  const initial = list.slice(0, MINI_BATCH);
  loadedCount = initial.length;

  const sections = initial.map(v => miniSectionHTML(v, ctx)).join('');
  const hasMore = list.length > loadedCount;
  const sentinel = hasMore ? `<div id="minisSentinel" style="height:1px"></div>` : '';

  /* Attach the scroll loader after the DOM is in place */
  queueMicrotask(() => attachMinisLoader(ctx));

  return sections + sentinel;
}

/* ============================================================
   MINI SECTION HTML — one <section class="mini">
   Used both for the initial batch and each appended batch.
   ============================================================ */
function miniSectionHTML(v, ctx, opts = {}) {
  const { chanOf, PIXLECT, isAdmin } = ctx;
  const viewerMode = !!opts.viewerMode;
  const c = chanOf(v.id);

  const isMine = PIXLECT.user && v.createdBy === PIXLECT.user.uid;
  const canDelete = isMine || isAdmin();

  /* Don't let users report their own videos */
  const canReport = PIXLECT.user && !isMine;

  return `
    <section class="mini" data-mini="${esc(v.id)}" ${viewerMode ? `id="mini-${esc(v.id)}"` : ''}>
      <div class="mini-inner">
        <video data-vid="${esc(v.id)}" loop playsinline
               preload="metadata" poster="${esc(v.thumb || '')}"></video>
        <div class="shade"></div>
        <button class="mute-btn" data-action="mute" type="button">🔊</button>
        ${viewerMode ? `<a class="mini-close" href="#/minis" title="Back to Minis">✕</a>` : ''}

        <div class="rail">
          <button class="rail-btn" data-action="like" data-video="${esc(v.id)}"
                  data-dyn="like" title="Like" type="button">
            <span class="circ">
              <svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg>
            </span>
            <span class="lbl">${fmt(v.likes)}</span>
          </button>

          <button class="rail-btn" data-action="dislike" data-video="${esc(v.id)}"
                  data-dyn="dislike" title="Dislike" type="button">
            <span class="circ">
              <svg viewBox="0 0 24 24"><path d="M2 4h3v11H2zm19.8 9.4c0 .9-.7 1.6-1.6 1.6h-5l.8 3.9.03.3c0 .3-.1.6-.3.8L14.9 21l-5.5-5.6c-.3-.2-.4-.6-.4-.9V6c0-.9.7-1.6 1.6-1.6h7.2c.7 0 1.2.4 1.4 1l2.4 5.7c.1.2.1.4.1.6z"/></svg>
            </span>
            <span class="lbl">${fmt(v.dislikes)}</span>
          </button>

          <button class="rail-btn" data-action="sub" data-channel="${esc(c.id)}"
                  data-dyn="sub" title="Subscribe" type="button">
            <span class="circ">
              <svg viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5zm0 2c-4 0-8 2-8 4.5V21h16v-2.5C20 16 16 14 12 14z"/></svg>
            </span>
          </button>

          <button class="rail-btn" data-action="share" data-video="${esc(v.id)}"
                  title="Share" type="button">
            <span class="circ">
              <svg viewBox="0 0 24 24"><path d="M14 9V5l7 7-7 7v-4.1C9.5 12.9 5.6 14.4 3 18c.5-4.5 2.9-8 11-9z"/></svg>
            </span>
          </button>

          ${canReport ? `
          <button class="rail-btn" data-action="report-video" data-video="${esc(v.id)}"
                  title="Report" type="button">
            <span class="circ">
              <svg viewBox="0 0 24 24"><path d="M12 2L1 21h22zM13 18h-2v-2h2zm0-4h-2V9h2z"/></svg>
            </span>
            <span class="lbl">Report</span>
          </button>` : ''}

          ${canDelete ? `
          <button class="rail-btn" data-action="del-video" data-video="${esc(v.id)}"
                  title="Delete" type="button" style="color:var(--accent)">
            <span class="circ">
              <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
            </span>
            <span class="lbl">Delete</span>
          </button>` : ''}
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
}

/* ============================================================
   PAGINATION — appends next batch on scroll
   ============================================================ */
function attachMinisLoader(ctx) {
  const main = document.querySelector('.main');
  if (!main) return;

  if (scrollListenerAttached) {
    main.removeEventListener('scroll', scrollListenerAttached);
  }

  const onScroll = () => {
    if (loadingBatch) return;

    const list = ctx.minisSorted();
    if (loadedCount >= list.length) return;

    /* Trigger when within ~2 screens of the bottom */
    const remaining = main.scrollHeight - main.scrollTop - main.clientHeight;
    if (remaining > main.clientHeight * 2) return;

    loadingBatch = true;

    const nextBatch = list.slice(loadedCount, loadedCount + MINI_BATCH);
    const sentinel = document.getElementById('minisSentinel');
    if (!sentinel) { loadingBatch = false; return; }

    const html = nextBatch.map(v => miniSectionHTML(v, ctx)).join('');
    sentinel.insertAdjacentHTML('beforebegin', html);

    loadedCount += nextBatch.length;

    if (loadedCount >= list.length) {
      sentinel.remove();
      main.removeEventListener('scroll', onScroll);
      scrollListenerAttached = false;
    }

    /* Resolve video sources and start observing the new sections */
    ctx.hydrateVideosInView(document);
    setupMinis(ctx);

    loadingBatch = false;
  };

  main.addEventListener('scroll', onScroll, { passive: true });
  scrollListenerAttached = onScroll;

  /* Fire once in case the first batch doesn't fill the screen */
  onScroll();
}

/* ============================================================
   AUTOPLAY — play whichever Mini is in view, pause the rest
   Audio is ON by default. Falls back to muted if blocked.
   ============================================================ */
export function setupMinis(ctx) {
  const { registerView } = ctx;
  if (window.__miniObserver) window.__miniObserver.disconnect();

  const vids = document.querySelectorAll('.mini video');
  if (!vids.length) return;

  window.__miniObserver = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      const v = en.target;
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        v.play().catch(() => {
          /* Browser blocked sound — mute and retry */
          v.muted = true;
          const btn = v.parentElement.querySelector('.mute-btn');
          if (btn) btn.textContent = '🔇';
          v.play().catch(() => {});
        });
        if (v.dataset.vid) registerView(v.dataset.vid);
      } else {
        v.pause();
      }
    });
  }, { threshold: [0, 0.6, 1] });

  vids.forEach(v => window.__miniObserver.observe(v));
}

/* ============================================================
   RESET — called by main.js on every route change
   ============================================================ */
export function resetMinisPagination() {
  loadedCount = 0;
  loadingBatch = false;
  if (scrollListenerAttached) {
    const main = document.querySelector('.main');
    if (main) main.removeEventListener('scroll', scrollListenerAttached);
    scrollListenerAttached = false;
  }
}