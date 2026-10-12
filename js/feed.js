/* ============================================================
   PIXELTube — feed.js
   Home, personalized shelf, search, Subs, Liked, Playlists.
   ============================================================ */
import { esc, fmt, timeAgo, avatarHTML, thumbHTML, initial } from './helpers.js';

/* ============================================================
   SEARCH HISTORY — persisted in localStorage
   Each entry: { q, ts }
   ============================================================ */
const HISTORY_KEY = 'pixeltube_search_history';
const HISTORY_MAX = 20;

function getSearchHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function pushSearchHistory(q) {
  q = String(q || '').trim().toLowerCase();
  if (!q || q.length < 2) return;
  const hist = getSearchHistory().filter(h => h.q !== q);
  hist.unshift({ q, ts: Date.now() });
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(hist.slice(0, HISTORY_MAX))); } catch (_) {}
}
function clearSearchHistory() {
  try { localStorage.removeItem(HISTORY_KEY); } catch (_) {}
}

/* Weighted tokens from recent history — the more recent, the heavier. */
function recentTokens() {
  const hist = getSearchHistory();
  const map = new Map();
  hist.forEach((h, i) => {
    const weight = Math.max(1, HISTORY_MAX - i);
    h.q.split(/\s+/).filter(Boolean).forEach(tok => {
      if (tok.length < 2) return;
      map.set(tok, (map.get(tok) || 0) + weight);
    });
  });
  return map;
}

/* Score a video against a set of tokens (used for personalized shelf). */
function scoreVideo(v, tokens, chanOf) {
  const title = (v.title || '').toLowerCase();
  const desc  = (v.desc || '').toLowerCase();
  const chan  = (chanOf(v.id).name || '').toLowerCase();
  let score = 0;
  tokens.forEach((w, tok) => {
    if (title.includes(tok)) score += 6 * w;
    if (desc.includes(tok))  score += 3 * w;
    if (chan.includes(tok))  score += 4 * w;
  });
  // Small boost for recency so the shelf doesn't look identical forever
  const ageDays = (Date.now() - (v.createdAt || 0)) / 86400000;
  score += Math.max(0, 3 - ageDays * 0.1);
  return score;
}

/* ============================================================
   SEARCH — matches title, description, and channel name
   Returns { videos, channels }
   ============================================================ */
function searchAll(query, ctx) {
  const { state, chanOf, videosSorted } = ctx;
  const q = query.trim().toLowerCase();
  if (!q) return { videos: [], channels: [] };

  const tokens = q.split(/\s+/).filter(Boolean);

  const matchesText = (txt) => {
    if (!txt) return false;
    const t = String(txt).toLowerCase();
    return tokens.every(tok => t.includes(tok));
  };

  const videos = videosSorted().filter(v => {
    const c = chanOf(v.id);
    return matchesText(v.title) || matchesText(v.desc) || matchesText(c.name);
  });

  const channels = Object.values(state.channels).filter(c => {
    return matchesText(c.name) || matchesText(c.handle);
  });

  // Rank channels by subscriber count
  channels.sort((a, b) => (b.subs || 0) - (a.subs || 0));

  // Rank videos by a simple relevance score
  const score = (v) => {
    const c = chanOf(v.id);
    let s = 0;
    const title = (v.title || '').toLowerCase();
    const desc  = (v.desc || '').toLowerCase();
    const chan  = (c.name || '').toLowerCase();
    tokens.forEach(tok => {
      if (title.startsWith(tok))      s += 15;
      else if (title.includes(tok))   s += 10;
      if (chan.includes(tok))         s += 6;
      if (desc.includes(tok))         s += 3;
    });
    s += Math.min(5, (Number(v.views) || 0) / 1000);
    return s;
  };
  videos.sort((a, b) => score(b) - score(a));

  return { videos, channels };
}

/* ============================================================
   CHANNEL SEARCH RESULT CARD
   ============================================================ */
function channelCardHTML(c, ctx) {
  const { subsOf, isSubbed } = ctx;
  const subbed = isSubbed(c.id);
  return `
    <a class="chan-card" href="#/channel/${esc(c.id)}">
      ${avatarHTML(c, 'lg')}
      <div class="chan-card-info">
        <h3>${esc(c.name)}</h3>
        <div class="sub">
          ${esc(c.handle || '')} · ${fmt(subsOf(c.id))} subscriber${subsOf(c.id) === 1 ? '' : 's'}
          ${subbed ? ' · <span style="color:var(--accent)">Subscribed</span>' : ''}
        </div>
      </div>
    </a>`;
}

/* ============================================================
   HOME PAGE
   ============================================================ */
export function viewHome(ctx) {
  const { state, chanOf, videosSorted, longsSorted, minisSorted,
          cardHTML, shortCardHTML, emptyState, hasChannel, PIXLECT } = ctx;

  const all = videosSorted();
  const longs = longsSorted();
  const minis = minisSorted();

  /* ---- Search mode ---- */
  if (state.search) {
    const { videos, channels } = searchAll(state.search, ctx);

    if (!videos.length && !channels.length) {
      return emptyState('🔍', `No results for "${state.search}"`,
        'Try a different search term, or check your spelling.', '');
    }

    const channelsBlock = channels.length ? `
      <div class="page-head" style="padding-top:14px">
        <h2 style="font-size:16px;font-weight:800">Channels</h2>
        <p>${channels.length} result${channels.length === 1 ? '' : 's'}</p>
      </div>
      <div class="chan-grid">${channels.map(c => channelCardHTML(c, ctx)).join('')}</div>
    ` : '';

    const videosBlock = videos.length ? `
      <div class="page-head" style="padding-top:14px">
        <h2 style="font-size:16px;font-weight:800">Videos</h2>
        <p>${videos.length} result${videos.length === 1 ? '' : 's'}</p>
      </div>
      <div class="grid">${videos.map(cardHTML).join('')}</div>
    ` : '';

    return `
      <div class="page-head">
        <h1>Results for "${esc(state.search)}"</h1>
        <p>${channels.length} channel${channels.length === 1 ? '' : 's'} · ${videos.length} video${videos.length === 1 ? '' : 's'}</p>
      </div>
      ${channelsBlock}
      ${videosBlock}
    `;
  }

  /* ---- Empty app ---- */
  if (!all.length) {
    return emptyState('🎬', 'No videos yet',
      'PIXELTube is empty. Be the first to upload a video and start building the catalog.',
      PIXLECT.user
        ? (hasChannel()
            ? `<a class="btn-ghost" href="#/create">Upload a video</a>`
            : `<button class="btn-primary" id="emptyCreateChannel" type="button">Create your PIXELChannel</button>`)
        : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }

  /* ---- Personalized shelf (based on search history) ---- */
  const tokens = recentTokens();
  let forYou = [];
  if (tokens.size > 0) {
    const scored = all
      .map(v => ({ v, s: scoreVideo(v, tokens, chanOf) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 12)
      .map(x => x.v);
    forYou = scored;
  }

  const forYouBlock = forYou.length ? `
    <section class="for-you-shelf">
      <div class="shelf-head">
        <div class="icon"><svg viewBox="0 0 24 24"><path d="M12 2l2.4 7.4H22l-6 4.6 2.3 7.4-6.3-4.6L5.7 21l2.3-7.4-6-4.6h7.6z"/></svg></div>
        <h2>For you</h2>
        <button class="clear-hist" id="clearHistoryBtn" type="button">Clear history</button>
      </div>
      <div class="for-you-rail">
        ${forYou.map(v => `
          <a class="fy-card" href="#/watch/${esc(v.id)}">
            <div class="t">${thumbHTML(v)}<span class="dur">${esc(v.dur)}</span></div>
            <h4>${esc(v.title)}</h4>
            <div class="sub">${esc(chanOf(v.id).name)} · ${fmt(v.views)} views</div>
          </a>
        `).join('')}
      </div>
    </section>` : '';

  /* ---- Shorts shelf ---- */
  const shortsShelf = minis.length ? `
    <section class="shorts-shelf">
      <div class="shelf-head">
        <div class="icon"><svg viewBox="0 0 24 24"><path d="M13 2L4.5 13H11l-1 9L18.5 11H12z"/></svg></div>
        <h2>Minis</h2>
        <a href="#/minis" style="margin-left:auto;font-size:13px;color:var(--muted);font-weight:700">View all →</a>
      </div>
      <div class="shorts-rail">${minis.slice(0, 12).map(shortCardHTML).join('')}</div>
    </section>` : '';

  return `
    ${forYouBlock}
    ${shortsShelf}
    <div class="page-head">
      <h1>Home</h1>
      <p>${longs.length} video${longs.length === 1 ? '' : 's'}</p>
    </div>
    ${longs.length
      ? `<div class="grid">${longs.map(cardHTML).join('')}</div>`
      : `<div class="empty" style="padding:50px 24px"><p style="margin:0">No Longs yet — the Minis are above ☝️</p></div>`}
  `;
}

/* ============================================================
   SUBSCRIPTIONS
   ============================================================ */
export function viewSubs(ctx) {
  const { state, videosSorted, cardHTML, emptyState, PIXLECT } = ctx;
  const ids = Object.keys(state.subs);
  if (!ids.length) {
    return emptyState('📺', 'No subscriptions yet',
      PIXLECT.user
        ? 'Subscribe to channels and their newest videos show up here.'
        : 'Sign in with PIXLECT, then subscribe to channels.',
      PIXLECT.user ? '' : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }
  const list = videosSorted().filter(v => state.subs[v.channelId]);
  return `
    <div class="page-head">
      <h1>Subscriptions</h1>
      <p>${ids.length} channel${ids.length === 1 ? '' : 's'} · ${list.length} video${list.length === 1 ? '' : 's'}</p>
    </div>
    ${list.length
      ? `<div class="grid">${list.map(cardHTML).join('')}</div>`
      : emptyState('📭', 'Nothing new yet', 'Channels you subscribe to haven\'t uploaded anything.', '')}`;
}

/* ============================================================
   LIKED
   ============================================================ */
export function viewLiked(ctx) {
  const { state, videosSorted, cardHTML, emptyState, PIXLECT } = ctx;
  const ids = Object.keys(state.likes);
  if (!ids.length) {
    return emptyState('👍', 'No liked videos',
      PIXLECT.user ? 'Videos you like are saved here.' : 'Sign in with PIXLECT to save your likes.',
      PIXLECT.user ? '' : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }
  const list = videosSorted().filter(v => state.likes[v.id]);
  return `
    <div class="page-head">
      <h1>Liked videos</h1>
      <p>${list.length} video${list.length === 1 ? '' : 's'}</p>
    </div>
    <div class="grid">${list.map(cardHTML).join('')}</div>`;
}

/* ============================================================
   PLAYLISTS
   ============================================================ */
export function viewPlaylists(ctx) {
  const { playlistsOfUser, playlistVideos, esc, emptyState, PIXLECT } = ctx;
  if (!PIXLECT.user) {
    return emptyState('🎵', 'Sign in to use playlists',
      'Playlists let you group videos and watch them in sequence.',
      `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }
  const pls = playlistsOfUser();
  return `
    <div class="page-head">
      <h1>Your playlists</h1>
      <p>${pls.length} playlist${pls.length === 1 ? '' : 's'}</p>
      <button class="btn-primary" id="newPlaylistBtn" type="button" style="margin-left:auto">+ New playlist</button>
    </div>
    ${pls.length
      ? `<div class="grid">${pls.map(pl => {
          const vids = playlistVideos(pl.id);
          return `<a class="card" href="#/playlist/${esc(pl.id)}">
            <div class="thumb" style="background:linear-gradient(135deg,var(--accent),var(--accent2));display:grid;place-items:center">
              <svg viewBox="0 0 24 24" width="52" height="52" fill="rgba(255,255,255,.9)"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
              <span class="dur">${vids.length} video${vids.length === 1 ? '' : 's'}</span>
            </div>
            <div class="info">
              <div style="min-width:0">
                <h3>${esc(pl.name)}</h3>
                <div class="sub">${vids.length ? 'Updated ' + esc(timeAgo(vids[0].createdAt)) : 'Empty playlist'}</div>
              </div>
            </div>
          </a>`;
        }).join('')}</div>`
      : emptyState('🎵', 'No playlists yet', 'Create your first playlist to organize videos.', '')}`;
}

/* ============================================================
   PLAYLIST DETAIL
   ============================================================ */
export function viewPlaylist(ctx) {
  const { state, route, playlistVideos, chanOf, esc, fmt, thumbHTML, emptyState, PIXLECT } = ctx;
  const pid = route[1];
  const pl = state.playlists[pid];
  if (!pl) return emptyState('🚫', 'Playlist not found', '', `<a class="btn-ghost" href="#/playlists">Back to playlists</a>`);
  const vids = playlistVideos(pid);
  const isOwner = PIXLECT.user && pl.ownerUid === PIXLECT.user.uid;

  return `
    <div class="playlist-header">
      <div class="playlist-cover">
        <svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
      </div>
      <div class="txt">
        <h1>${esc(pl.name)}</h1>
        <div class="meta">${esc(pl.ownerName || 'user')} · ${vids.length} video${vids.length === 1 ? '' : 's'}</div>
      </div>
      ${isOwner ? `<button class="btn-secondary" id="plDeleteBtn" type="button" style="color:var(--accent)">Delete playlist</button>` : ''}
    </div>
    ${vids.length
      ? `<div class="playlist-videos">
          ${vids.map((v, i) => {
            const c = chanOf(v.id);
            return `<div class="pl-item" data-pl-item="${esc(v.id)}">
              <div class="idx">${i + 1}</div>
              <a class="t" href="#/watch/${esc(v.id)}">${thumbHTML(v)}<span class="dur">${esc(v.dur)}</span></a>
              <div class="info">
                <a href="#/watch/${esc(v.id)}"><h4>${esc(v.title)}</h4></a>
                <div class="sub">${esc(c.name)} · ${fmt(v.views)} views</div>
              </div>
              ${isOwner ? `<button class="remove" data-action="pl-remove" data-pid="${esc(pid)}" data-vid="${esc(v.id)}" type="button">Remove</button>` : ''}
            </div>`;
          }).join('')}
        </div>`
      : emptyState('📭', 'This playlist is empty', isOwner ? 'Add videos from any watch page.' : '', '')}
  `;
}

/* ============================================================
   PUBLIC: hook into the search input
   ============================================================ */
export function wireSearchInput(ctx) {
  const { state, render } = ctx;
  const input = document.getElementById('searchInput');
  if (!input) return;

  let debounce = null;

  input.addEventListener('input', (e) => {
    state.search = e.target.value;
    if (state.route[0] !== 'home' && state.search.trim()) {
      location.hash = '#/';
    } else {
      render(true);
    }
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = state.search.trim();
      if (q.length >= 2) pushSearchHistory(q);
    }, 900);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = state.search.trim();
      if (q.length >= 2) pushSearchHistory(q);
    }
  });
}

/* ============================================================
   PUBLIC: hook the "Clear history" button on the For-you shelf
   ============================================================ */
export function wireClearHistory(ctx) {
  document.addEventListener('click', (e) => {
    if (e.target.id === 'clearHistoryBtn') {
      clearSearchHistory();
      ctx.toast('Search history cleared');
      ctx.render(true);
    }
  });
}