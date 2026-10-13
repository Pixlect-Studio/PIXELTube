/* ============================================================
   PIXELTube — video_large.js
   Watch page for Longs at #/watch/{vid}.
   Includes like, dislike, subscribe, save-to-playlist, share,
   report, admin/owner delete, comments, and up-next sidebar.
   ============================================================ */
import { esc, fmt, timeAgo, avatarHTML, thumbHTML, initial } from './helpers.js';

/* ============================================================
   WATCH PAGE
   ============================================================ */
export function viewWatch(ctx, vid) {
  const {
    state, chanOf,
    isLiked, isDisliked, isSubbed,
    subsOf, likesOf, dislikesOf, viewsOf,
    videosSorted, playlistsOfUser,
    emptyState, PIXLECT, myChannel, isAdmin
  } = ctx;

  const v = state.videos[vid];
  if (!v) {
    return emptyState('🚫', 'Video not found', 'It may have been removed.',
      `<a class="btn-ghost" href="#/">Go to Feed</a>`);
  }

  const c = chanOf(vid);
  const liked     = isLiked(vid);
  const disliked  = isDisliked(vid);
  const subbed    = isSubbed(c.id);
  const isMine    = PIXLECT.user && v.createdBy === PIXLECT.user.uid;
  const canDelete = isMine || isAdmin();
  const canReport = PIXLECT.user && !isMine;

  /* ---- Up next ---- */
  const upNext = videosSorted()
    .filter(x => x.id !== vid)
    .sort((a, b) => (b.channelId === c.id) - (a.channelId === c.id))
    .slice(0, 10);

  /* ---- Comment form icon ---- */
  const userIcon = PIXLECT.user
    ? (myChannel()?.avatar
        ? `<span class="pic"><img src="${esc(myChannel().avatar)}" alt=""></span>`
        : `<span class="pic" style="background:${esc(myChannel()?.color || PIXLECT.user.icon?.bg || '#38bdf8')}">${esc(myChannel() ? initial(myChannel().name) : (PIXLECT.user.icon?.emoji || '👤'))}</span>`)
    : `<span class="pic" style="background:#2a2a36">👤</span>`;

  const commentForm = PIXLECT.user
    ? `<form class="comment-form" id="commentForm">
         ${userIcon}
         <div class="input-wrap">
           <textarea id="commentText" placeholder="Add a comment…" maxlength="2000"></textarea>
           <div class="actions">
             <button type="button" class="btn-secondary" id="commentCancel">Cancel</button>
             <button type="submit" class="btn-primary" id="commentSubmit" disabled>Comment</button>
           </div>
         </div>
       </form>`
    : `<div class="no-comments">Sign in with PIXLECT to join the conversation.</div>`;

  /* ---- Playlist save menu ---- */
  const myPls = playlistsOfUser();
  const plMenu = myPls.length
    ? `<div style="position:relative">
         <button class="pill" id="savePlBtn" type="button">
           <svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
           Save
         </button>
         <div id="savePlMenu" style="display:none;position:absolute;top:calc(100% + 8px);right:0;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:6px;min-width:220px;box-shadow:0 18px 50px rgba(0,0,0,.7);z-index:90">
           ${myPls.map(pl => `
             <button data-action="pl-add" data-pid="${esc(pl.id)}" data-vid="${esc(vid)}" type="button"
                     style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--text)">
               <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" opacity="0.7"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
               ${esc(pl.name)}
             </button>`).join('')}
           <div style="height:1px;background:var(--line);margin:6px 4px"></div>
           <button id="newPlBtn" type="button"
                   style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:9px 12px;border-radius:8px;font-size:13.5px;font-weight:600;color:var(--text)">
             <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" opacity="0.7"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z"/></svg>
             New playlist
           </button>
         </div>
       </div>`
    : `<button class="pill" id="newPlBtn" type="button">
         <svg viewBox="0 0 24 24"><path d="M3 6h13v2H3zm0 5h13v2H3zm0 5h9v2H3zm14-1v6l5-3z"/></svg>
         Save
       </button>`;

  /* ---- Report (only if signed in and not the owner) ---- */
  const reportBtn = canReport
    ? `<button class="pill" data-action="report-video" data-video="${esc(vid)}" type="button">
         <svg viewBox="0 0 24 24"><path d="M12 2L1 21h22zM13 18h-2v-2h2zm0-4h-2V9h2z"/></svg>
         Report
       </button>`
    : '';

  /* ---- Delete (owner or admin) ---- */
  const deleteBtn = canDelete
    ? `<button class="pill" data-action="del-video" data-video="${esc(vid)}" type="button" style="color:var(--accent)">
         <svg viewBox="0 0 24 24"><path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6zM19 4h-3.5l-1-1h-5l-1 1H5v2h14z"/></svg>
         Delete
       </button>` : '';

  /* ---- Admin badge next to channel name ---- */
  const adminTag = isAdmin()
    ? `<span style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;font-size:10.5px;font-weight:800;letter-spacing:.5px;color:var(--warn);background:rgba(251,191,36,.12);padding:3px 8px;border-radius:99px;border:1px solid rgba(251,191,36,.35)">ADMIN</span>`
    : '';

  /* ---- Emergency storage note in stats line ---- */
  const emergencyTag = (v.srcBackend === 'backup' || v.srcBackend === 'url-backup')
    ? ' · <span style="color:var(--warn)">emergency storage</span>'
    : '';

  return `
  <div class="watch">
    <div>
      <div class="player">
        <div class="loading">Loading video…</div>
        <video data-vid="${esc(vid)}" controls autoplay playsinline poster="${esc(v.thumb || '')}"></video>
      </div>

      <h1 class="w-title">${esc(v.title)}</h1>

      <div class="w-row">
        <div class="w-chan">
          ${avatarHTML(c, 'lg')}
          <div style="min-width:0">
            <a class="nm" href="#/channel/${esc(c.id)}">${esc(c.name)}</a>${adminTag}
            <div class="sb" data-dyn="subcount" data-channel="${esc(c.id)}">${fmt(subsOf(c.id))} subscribers</div>
          </div>
        </div>

        <button class="btn-sub ${subbed ? 'subbed' : ''}" data-action="sub"
                data-channel="${esc(c.id)}" data-dyn="sub" type="button">
          ${subbed ? 'Subscribed' : 'Subscribe'}
        </button>

        <button class="pill ${liked ? 'active' : ''}" data-action="like"
                data-video="${esc(vid)}" data-dyn="like" type="button">
          <svg viewBox="0 0 24 24"><path d="M2 20h3V9H2zm19.8-9.4c0-.9-.7-1.6-1.6-1.6h-5l.8-3.9.03-.3c0-.3-.1-.6-.3-.8L14.9 3 9.4 8.6c-.3.2-.4.6-.4.9V18c0 .9.7 1.6 1.6 1.6h7.2c.7 0 1.2-.4 1.4-1l2.4-5.7c.1-.2.1-.4.1-.6z"/></svg>
          <span class="lbl">${fmt(likesOf(vid))}</span>
        </button>

        <button class="pill ${disliked ? 'active' : ''}" data-action="dislike"
                data-video="${esc(vid)}" data-dyn="dislike" type="button">
          <svg viewBox="0 0 24 24"><path d="M2 4h3v11H2zm19.8 9.4c0 .9-.7 1.6-1.6 1.6h-5l.8 3.9.03.3c0 .3-.1.6-.3.8L14.9 21l-5.5-5.6c-.3-.2-.4-.6-.4-.9V6c0-.9.7-1.6 1.6-1.6h7.2c.7 0 1.2.4 1.4 1l2.4 5.7c.1.2.1.4.1.6z"/></svg>
          <span class="lbl">${fmt(dislikesOf(vid))}</span>
        </button>

        ${plMenu}

        <button class="pill" data-action="share" data-video="${esc(vid)}" type="button">
          <svg viewBox="0 0 24 24"><path d="M14 9V5l7 7-7 7v-4.1C9.5 12.9 5.6 14.4 3 18c.5-4.5 2.9-8 11-9z"/></svg>
          Share
        </button>

        ${reportBtn}
        ${deleteBtn}
      </div>

      <div class="desc">
        <span class="stats">
          <span data-dyn="views" data-video="${esc(vid)}">${fmt(viewsOf(vid))} views</span>
          · ${esc(timeAgo(v.createdAt))}
          · ${fmt(likesOf(vid))} likes
          · ${fmt(dislikesOf(vid))} dislikes
          · ${v.kind === 'mini' ? 'Mini' : 'Long'}${emergencyTag}
        </span>
        ${esc(v.desc || '')}
      </div>

      <section class="comments">
        <h2>Comments</h2>
        ${commentForm}
        <div class="comment-list" id="commentList">
          <div class="no-comments">Loading comments…</div>
        </div>
      </section>
    </div>

    <aside class="upnext">
      <h2>Up next</h2>
      ${upNext.length ? upNext.map(x => {
        const xc = chanOf(x.id);
        return `<a class="mini-card" href="#/watch/${esc(x.id)}">
          <div class="t">${thumbHTML(x)}<span class="dur">${esc(x.dur)}</span></div>
          <div style="min-width:0">
            <h4>${esc(x.title)}</h4>
            <div class="sub">${esc(xc.name)}</div>
            <div class="sub">${fmt(x.views)} views · ${esc(timeAgo(x.createdAt))}</div>
          </div>
        </a>`;
      }).join('') : `<div class="no-comments">No other videos yet.</div>`}
    </aside>
  </div>`;
}

/* ============================================================
   COMMENT FORM + PLAYLIST SAVE MENU WIRING
   Called from main.js right after viewWatch renders.
   ============================================================ */
export function setupCommentForm(ctx, vid) {
  const { createPlaylist, addToPlaylist, toast, addComment } = ctx;

  /* --- Comment box --- */
  const form = document.getElementById('commentForm');
  if (form) {
    const ta      = document.getElementById('commentText');
    const submit  = document.getElementById('commentSubmit');
    const cancel  = document.getElementById('commentCancel');

    ta.addEventListener('input', () => {
      submit.disabled = !ta.value.trim();
    });
    cancel.addEventListener('click', () => {
      ta.value = '';
      submit.disabled = true;
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      submit.disabled = true;
      submit.textContent = 'Posting…';
      await addComment(vid, text);
      ta.value = '';
      submit.textContent = 'Comment';
    });
  }

  /* --- Playlist save dropdown --- */
  const saveBtn  = document.getElementById('savePlBtn');
  const saveMenu = document.getElementById('savePlMenu');
  if (saveBtn && saveMenu) {
    saveBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      saveMenu.style.display = saveMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', () => { saveMenu.style.display = 'none'; });
  }

  /* --- New playlist button (works whether the dropdown exists or not) --- */
  const newPlBtn = document.getElementById('newPlBtn');
  if (newPlBtn) {
    newPlBtn.addEventListener('click', () => {
      const name = prompt('Playlist name:');
      if (!name) return;
      createPlaylist(name).then((pid) => {
        if (!pid) return;
        addToPlaylist(pid, vid);
        toast('Saved to "' + name + '"');
        if (saveMenu) saveMenu.style.display = 'none';
      });
    });
  }
}