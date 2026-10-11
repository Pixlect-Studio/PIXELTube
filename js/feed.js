/* Home, Minis shelf, Subs, Liked, Playlists — the browse surfaces. */
import { esc, fmt, timeAgo, avatarHTML, thumbHTML, initial } from './helpers.js';

export function viewHome(ctx) {
  const { state, chanOf, videosSorted, longsSorted, minisSorted, cardHTML, shortCardHTML, emptyState, hasChannel, PIXLECT } = ctx;

  const all = videosSorted();
  let longs = longsSorted();
  const minis = minisSorted();

  if (state.search) {
    const q = state.search.toLowerCase();
    const filtered = all.filter(v =>
      v.title.toLowerCase().includes(q) ||
      chanOf(v.id).name.toLowerCase().includes(q));
    if (!filtered.length) {
      return emptyState('🔍', `No results for "${state.search}"`, 'Try a different search term.', '');
    }
    return `
      <div class="page-head"><h1>Results</h1><p>${filtered.length} video${filtered.length === 1 ? '' : 's'}</p></div>
      <div class="grid">${filtered.map(cardHTML).join('')}</div>`;
  }

  if (!all.length) {
    return emptyState('🎬', 'No videos yet',
      'PIXELTube is empty. Be the first to upload a video and start building the catalog.',
      PIXLECT.user
        ? (hasChannel()
            ? `<a class="btn-ghost" href="#/create">Upload a video</a>`
            : `<button class="btn-primary" id="emptyCreateChannel">Create your PIXELChannel</button>`)
        : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))">Sign in with PIXLECT</button>`);
  }

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

export function viewSubs(ctx) {
  const { state, videosSorted, cardHTML, emptyState, PIXLECT } = ctx;
  const ids = Object.keys(state.subs);
  if (!ids.length) {
    return emptyState('📺', 'No subscriptions yet',
      PIXLECT.user
        ? 'Subscribe to channels and their newest videos show up here.'
        : 'Sign in with PIXLECT, then subscribe to channels.',
      PIXLECT.user ? '' : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))">Sign in with PIXLECT</button>`);
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

export function viewLiked(ctx) {
  const { state, videosSorted, cardHTML, emptyState, PIXLECT } = ctx;
  const ids = Object.keys(state.likes);
  if (!ids.length) {
    return emptyState('👍', 'No liked videos',
      PIXLECT.user ? 'Videos you like are saved here.' : 'Sign in with PIXLECT to save your likes.',
      PIXLECT.user ? '' : `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))">Sign in with PIXLECT</button>`);
  }
  const list = videosSorted().filter(v => state.likes[v.id]);
  return `
    <div class="page-head">
      <h1>Liked videos</h1>
      <p>${list.length} video${list.length === 1 ? '' : 's'}</p>
    </div>
    <div class="grid">${list.map(cardHTML).join('')}</div>`;
}

export function viewPlaylists(ctx) {
  const { playlistsOfUser, playlistVideos, esc, emptyState, PIXLECT } = ctx;
  if (!PIXLECT.user) {
    return emptyState('🎵', 'Sign in to use playlists',
      'Playlists let you group videos and watch them in sequence.',
      `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))">Sign in with PIXLECT</button>`);
  }
  const pls = playlistsOfUser();
  return `
    <div class="page-head">
      <h1>Your playlists</h1>
      <p>${pls.length} playlist${pls.length === 1 ? '' : 's'}</p>
      <button class="btn-primary" id="newPlaylistBtn" style="margin-left:auto">+ New playlist</button>
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
      ${isOwner ? `<button class="btn-secondary" id="plDeleteBtn" style="color:var(--accent)">Delete playlist</button>` : ''}
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
              ${isOwner ? `<button class="remove" data-action="pl-remove" data-pid="${esc(pid)}" data-vid="${esc(v.id)}">Remove</button>` : ''}
            </div>`;
          }).join('')}
        </div>`
      : emptyState('📭', 'This playlist is empty', isOwner ? 'Add videos from any watch page.' : '', '')}
  `;
}