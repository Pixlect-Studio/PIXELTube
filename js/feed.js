/* ============================================================
   PIXELTube — feed.js
   Feed (search-history-ranked), Search, Subs, Liked, Playlists.
   ============================================================ */
import {
  esc, fmt, timeAgo, avatarHTML, thumbHTML, initial,
  getSearchHistory, pushSearchHistory, clearSearchHistory, hasSearchHistory
} from './helpers.js';

/* ============================================================
   TOKEN RANKING — used by Feed and search scoring
   ============================================================ */
const HISTORY_MAX = 20;

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
  const ageDays = (Date.now() - (v.createdAt || 0)) / 86400000;
  score += Math.max(0, 3 - ageDays * 0.1);
  return score;
}

/* ============================================================
   SEARCH — matches title, desc, channel name/handle
   ============================================================ */
function searchAll(query, ctx) {
  const { state, chanOf, videosSorted, subsOf } = ctx;
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
  channels.sort((a, b) => subsOf(b.id) - subsOf(a.id));

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
   CHANNEL CARD — used in search results
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
   FEED — replaces the old Home grid
   Shows only videos matching your search history.
   Empty state if you've never searched.
   ============================================================ */
export function viewFeed(ctx) {
  const { state, chanOf, videosSorted, cardHTML, shortCardHTML,
          emptyState, hasChannel, PIXLECT } = ctx;

  /* ---- Search mode ---- */
  if (state.search && state.search.trim()) {
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

  /* ---- No search history → empty state ---- */
  if (!hasSearchHistory()) {
    return `
      <div class="empty" style="padding:120px 24px">
        <div class="big" style="font-size:56px">🔍</div>
        <h2 style="font-size:22px;margin-bottom:10px">Search To Find Videos Here</h2>
        <p style="max-width:420px">
          The Feed is built from what you search for. Try searching for
          <b style="color:var(--text)">Minecraft</b>,
          <b style="color:var(--text)">music</b>, or
          <b style="color:var(--text)">vlog</b> —
          then come back here and you'll see videos matching your interests.
        </p>
      </div>`;
  }

  /* ---- Rank by search history tokens ---- */
  const tokens = recentTokens();
  const scored = videosSorted()
    .map(v => ({ v, s: scoreVideo(v, tokens, chanOf) }))
    .filter(x => x.s > 0)
    .sort((a, b) => b.s - a.s);

  /* Tokens exist but no video matched them */
  if (!scored.length) {
    const latest = getSearchHistory()[0]?.q || '';
    return `
      <div class="empty" style="padding:120px 24px">
        <div class="big" style="font-size:56px">🎬</div>
        <h2 style="font-size:22px;margin-bottom:10px">No videos match yet</h2>
        <p style="max-width:420px">
          We found your recent search${latest ? ` for <b style="color:var(--text)">"${esc(latest)}"</b>` : ''},
          but nobody has uploaded anything matching it yet.
          Try another search, or upload the first one yourself.
        </p>
        ${PIXLECT.user
          ? (hasChannel()
              ? `<a class="btn-ghost" href="#/create" style="margin-top:8px">Upload a video</a>`
              : `<button class="btn-primary" id="emptyCreateChannel" type="button" style="margin-top:8px">Create your PIXELChannel</button>`)
          : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button" style="margin-top:8px">Sign in with PIXLECT</button>`}
      </div>`;
  }

  /* ---- Show the top matches ---- */
  const topVideos = scored.slice(0, 40).map(x => x.v);
  const longs = topVideos.filter(v => v.kind !== 'mini');
  const minis = topVideos.filter(v => v.kind === 'mini');
  const totalMatched = scored.length;

  const longsBlock = longs.length
    ? `<div class="grid">${longs.map(cardHTML).join('')}</div>`
    : '';

  const minisShelf = minis.length ? `
    <section class="shorts-shelf">
      <div class="shelf-head">
        <div class="icon"><svg viewBox="0 0 24 24"><path d="M13 2L4.5 13H11l-1 9L18.5 11H12z"/></svg></div>
        <h2>Minis for you</h2>
        <a href="#/minis" style="margin-left:auto;font-size:13px;color:var(--muted);font-weight:700">View all →</a>
      </div>
      <div class="shorts-rail">${minis.slice(0, 12).map(shortCardHTML).join('')}</div>
    </section>` : '';

  return `
    <div class="page-head">
      <h1>Feed</h1>
      <p>${totalMatched} video${totalMatched === 1 ? '' : 's'} based on your searches</p>
      <button id="clearHistoryBtn" type="button"
              style="margin-left:auto;font-size:12.5px;color:var(--muted);font-weight:700;padding:6px 12px;border-radius:99px;border:1px solid var(--line);transition:.15s">
        Clear search history
      </button>
    </div>
    ${minisShelf}
    ${longsBlock}
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
  const { playlistsOfUser, playlistVideos, esc, timeAgo, emptyState, PIXLECT } = ctx;
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
  const { state, route, playlistVideos, chanOf, esc, fmt,
          thumbHTML, emptyState, PIXLECT } = ctx;
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
   SEARCH INPUT WIRING
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
   CLEAR HISTORY BUTTON
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