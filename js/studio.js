/* ============================================================
   PIXELTube — studio.js
   Studio dashboard at #/studio with sub-pages:
     #/studio              Dashboard
     #/studio/content      Video list
     #/studio/analytics    Per-video stats (only real metrics)
     #/studio/comments     Recent comments on your videos
     #/studio/settings     Channel edit
   ============================================================ */
import { esc, fmt, timeAgo, avatarHTML, thumbHTML, initial } from './helpers.js';

/* ============================================================
   HELPERS
   ============================================================ */
function myStudioChannel(ctx) {
  /* The channel the studio is looking at = the active channel */
  return ctx.myChannel();
}
function myStudioVideos(ctx, cid) {
  return ctx.videosSorted().filter(v => v.channelId === cid);
}
function commentsOnVideos(ctx, vids) {
  const out = [];
  const map = ctx.state.comments || {};
  for (const v of vids) {
    const list = map[v.id] || {};
    for (const [cid, c] of Object.entries(list)) {
      out.push({ ...c, _id: cid, _vid: v.id, _videoTitle: v.title });
    }
  }
  return out.sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
function fmtMinutes(seconds) {
  if (!seconds) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/* ============================================================
   MAIN STUDIO VIEW — dispatches by route
   ============================================================ */
export function viewStudio(ctx, sub) {
  const { PIXLECT, emptyState } = ctx;

  if (!PIXLECT.user) {
    return emptyState('🔒', 'Sign in required',
      'The Studio is only available to signed-in PIXELTube creators.',
      `<button class="btn-primary" onclick="window.dispatchEvent(new Event('pixeltube:signin'))" type="button">Sign in with PIXLECT</button>`);
  }

  const ch = myStudioChannel(ctx);
  if (!ch) {
    return emptyState('🎬', 'Create a channel first',
      'You need a PIXELChannel to access the Studio.',
      `<button class="btn-primary" id="studioCreateChannel" type="button">Create PIXELChannel</button>`);
  }

  switch (sub) {
    case 'content':   return viewStudioContent(ctx, ch);
    case 'analytics': return viewStudioAnalytics(ctx, ch);
    case 'comments':  return viewStudioComments(ctx, ch);
    case 'settings':  return viewStudioSettings(ctx, ch);
    default:          return viewStudioDashboard(ctx, ch);
  }
}

/* ============================================================
   STUDIO SIDEBAR
   ============================================================ */
function studioSidebarHTML(ctx, ch, active) {
  const items = [
    { id: 'dashboard', label: 'Dashboard', href: '#/studio' },
    { id: 'content',   label: 'Content',   href: '#/studio/content' },
    { id: 'analytics', label: 'Analytics', href: '#/studio/analytics' },
    { id: 'comments',  label: 'Comments',  href: '#/studio/comments' },
    { id: 'settings',  label: 'Settings',  href: '#/studio/settings' },
    { id: 'create',    label: 'Create',    href: '#/create' }
  ];

  const avatarHTML_ = ch.avatar
    ? `<span class="pic"><img src="${esc(ch.avatar)}" alt=""></span>`
    : `<span class="pic" style="background:${esc(ch.color || '#38bdf8')}">${esc(initial(ch.name))}</span>`;

  return `
    <aside class="studio-sidebar">
      <div class="studio-channel">
        ${avatarHTML_}
        <div class="t">
          <strong>${esc(ch.name)}</strong>
          <small>${esc(ch.handle || '')}</small>
        </div>
      </div>

      <nav class="studio-nav">
        ${items.map(it => `
          <a class="studio-nav-item ${active === it.id ? 'active' : ''}" href="${it.href}">
            ${it.label}
          </a>
        `).join('')}
      </nav>

      <a class="studio-back" href="#/">← Back to PIXELTube</a>
    </aside>
  `;
}

/* Wrap the content area with the sidebar */
function studioWrap(ctx, ch, active, contentHTML) {
  return `
    <div class="studio-shell">
      ${studioSidebarHTML(ctx, ch, active)}
      <main class="studio-main">
        ${contentHTML}
      </main>
    </div>
  `;
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function viewStudioDashboard(ctx, ch) {
  const vids = myStudioVideos(ctx, ch.id);
  const totalViews = vids.reduce((s, v) => s + (Number(v.views) || 0), 0);
  const totalLikes = vids.reduce((s, v) => s + (Number(v.likes) || 0), 0);
  const totalDislikes = vids.reduce((s, v) => s + (Number(v.dislikes) || 0), 0);
  const subs = ctx.subsOf(ch.id);

  const latest = vids[0] || null;
  const recent = vids.slice(0, 5);

  const latestCard = latest ? `
    <section class="studio-card">
      <h3>Latest video</h3>
      <a class="studio-latest" href="#/watch/${esc(latest.id)}">
        <div class="studio-latest-thumb">${thumbHTML(latest)}</div>
        <div class="studio-latest-info">
          <h4>${esc(latest.title)}</h4>
          <div class="studio-latest-meta">${esc(timeAgo(latest.createdAt))} · ${fmt(latest.views)} views</div>
        </div>
      </a>
      <div class="studio-stats-row">
        <div class="studio-stat"><div class="n">${fmt(latest.views)}</div><div class="l">Views</div></div>
        <div class="studio-stat"><div class="n">${fmt(latest.likes)}</div><div class="l">Likes</div></div>
        <div class="studio-stat"><div class="n">${fmt(latest.dislikes)}</div><div class="l">Dislikes</div></div>
        <div class="studio-stat"><div class="n">${latest.kind === 'mini' ? 'Mini' : 'Long'}</div><div class="l">Type</div></div>
      </div>
    </section>` : `
    <section class="studio-card">
      <h3>Latest video</h3>
      <div class="studio-empty-card">
        No videos yet on this channel.
        <a class="btn-primary" href="#/create" style="margin-top:12px;display:inline-block">Upload your first video</a>
      </div>
    </section>`;

  const content = `
    <div class="studio-head">
      <h1>Channel dashboard</h1>
      <div class="studio-head-actions">
        <a class="btn-primary" href="#/create">Upload</a>
      </div>
    </div>

    <div class="studio-grid">
      ${latestCard}

      <section class="studio-card">
        <h3>Channel analytics</h3>
        <div class="studio-big-stat">
          <div class="n">${fmt(subs)}</div>
          <div class="l">Current subscribers</div>
        </div>
        <div class="studio-stats-row" style="margin-top:16px">
          <div class="studio-stat"><div class="n">${fmt(totalViews)}</div><div class="l">Total views</div></div>
          <div class="studio-stat"><div class="n">${fmt(totalLikes)}</div><div class="l">Total likes</div></div>
          <div class="studio-stat"><div class="n">${fmt(totalDislikes)}</div><div class="l">Total dislikes</div></div>
          <div class="studio-stat"><div class="n">${vids.length}</div><div class="l">Videos</div></div>
        </div>
        <a class="btn-secondary" href="#/studio/analytics" style="margin-top:16px;display:inline-block">View analytics</a>
      </section>
    </div>

    <section class="studio-card">
      <h3>Recent videos</h3>
      ${recent.length ? `
        <div class="studio-list">
          ${recent.map(v => `
            <a class="studio-list-row" href="#/watch/${esc(v.id)}">
              <div class="studio-list-thumb">${thumbHTML(v)}</div>
              <div class="studio-list-info">
                <div class="t">${esc(v.title)}</div>
                <div class="m">${v.kind === 'mini' ? 'Mini' : 'Long'} · ${esc(v.dur)} · ${esc(timeAgo(v.createdAt))}</div>
              </div>
              <div class="studio-list-stats">
                <span>${fmt(v.views)} views</span>
                <span>${fmt(v.likes)} likes</span>
              </div>
            </a>
          `).join('')}
        </div>` : `
        <div class="studio-empty-card">No videos to show.</div>`}
    </section>
  `;

  return studioWrap(ctx, ch, 'dashboard', content);
}

/* ============================================================
   CONTENT — list every video on this channel
   ============================================================ */
function viewStudioContent(ctx, ch) {
  const vids = myStudioVideos(ctx, ch.id);
  const isAdmin = ctx.isAdmin();

  const rows = vids.length ? vids.map(v => `
    <div class="studio-content-row">
      <a class="studio-content-thumb" href="#/watch/${esc(v.id)}">${thumbHTML(v)}</a>
      <div class="studio-content-info">
        <a href="#/watch/${esc(v.id)}"><div class="t">${esc(v.title)}</div></a>
        <div class="m">
          ${v.kind === 'mini' ? 'Mini' : 'Long'}
          · ${esc(v.dur)}
          · ${esc(timeAgo(v.createdAt))}
          ${v.srcBackend === 'backup' || v.srcBackend === 'url-backup'
            ? ' · <span style="color:var(--warn)">emergency storage</span>'
            : ''}
        </div>
        <div class="m">${fmt(v.views)} views · ${fmt(v.likes)} likes · ${fmt(v.dislikes)} dislikes</div>
      </div>
      <div class="studio-content-actions">
        <a class="btn-secondary" href="#/watch/${esc(v.id)}" target="_blank">View</a>
        <button class="btn-secondary" data-action="del-video" data-video="${esc(v.id)}" type="button" style="color:var(--accent)">Delete</button>
      </div>
    </div>
  `).join('') : `<div class="studio-empty-card">No videos on this channel yet. <a href="#/create" style="color:var(--accent)">Upload one</a>.</div>`;

  const content = `
    <div class="studio-head">
      <h1>Content</h1>
      <div class="studio-head-actions">
        <a class="btn-primary" href="#/create">Upload</a>
      </div>
    </div>

    <p class="studio-lede">${vids.length} video${vids.length === 1 ? '' : 's'} on <b>${esc(ch.name)}</b>.</p>

    <div class="studio-content-list">
      ${rows}
    </div>
  `;

  return studioWrap(ctx, ch, 'content', content);
}

/* ============================================================
   ANALYTICS — only the metrics we actually track
   ============================================================ */
function viewStudioAnalytics(ctx, ch) {
  const vids = myStudioVideos(ctx, ch.id);

  if (!vids.length) {
    const content = `
      <div class="studio-head"><h1>Analytics</h1></div>
      <div class="studio-empty-card">No data yet — upload a video to see analytics.</div>
    `;
    return studioWrap(ctx, ch, 'analytics', content);
  }

  const totalViews = vids.reduce((s, v) => s + (Number(v.views) || 0), 0);
  const totalLikes = vids.reduce((s, v) => s + (Number(v.likes) || 0), 0);
  const totalDislikes = vids.reduce((s, v) => s + (Number(v.dislikes) || 0), 0);
  const avgViews = Math.round(totalViews / vids.length);
  const likeRatio = totalLikes + totalDislikes > 0
    ? Math.round((totalLikes / (totalLikes + totalDislikes)) * 100)
    : 0;

  const sorted = vids.slice().sort((a, b) => (b.views || 0) - (a.views || 0));

  const content = `
    <div class="studio-head"><h1>Analytics</h1></div>

    <div class="studio-stats-row studio-stats-row-lg">
      <div class="studio-stat"><div class="n">${fmt(totalViews)}</div><div class="l">Total views</div></div>
      <div class="studio-stat"><div class="n">${fmt(avgViews)}</div><div class="l">Avg views per video</div></div>
      <div class="studio-stat"><div class="n">${fmt(totalLikes)}</div><div class="l">Total likes</div></div>
      <div class="studio-stat"><div class="n">${likeRatio}%</div><div class="l">Like ratio</div></div>
    </div>

    <section class="studio-card">
      <h3>Videos by views</h3>
      <div class="studio-analytics-list">
        ${sorted.map(v => {
          const maxViews = sorted[0]?.views || 1;
          const pct = Math.max(3, Math.round(((v.views || 0) / maxViews) * 100));
          return `
            <div class="studio-analytics-row">
              <div class="studio-analytics-thumb">
                <a href="#/watch/${esc(v.id)}">${thumbHTML(v)}</a>
              </div>
              <div class="studio-analytics-info">
                <a href="#/watch/${esc(v.id)}"><div class="t">${esc(v.title)}</div></a>
                <div class="m">${esc(timeAgo(v.createdAt))} · ${v.kind === 'mini' ? 'Mini' : 'Long'}</div>
                <div class="studio-bar"><div class="studio-bar-fill" style="width:${pct}%"></div></div>
                <div class="m">${fmt(v.views)} views · ${fmt(v.likes)} likes · ${fmt(v.dislikes)} dislikes</div>
              </div>
            </div>`;
        }).join('')}
      </div>
    </section>
  `;

  return studioWrap(ctx, ch, 'analytics', content);
}

/* ============================================================
   COMMENTS — recent comments across all your videos
   ============================================================ */
function viewStudioComments(ctx, ch) {
  const vids = myStudioVideos(ctx, ch.id);
  const all = commentsOnVideos(ctx, vids);

  const rows = all.length ? all.slice(0, 100).map(c => `
    <div class="studio-comment-row">
      <div class="studio-comment-pic">
        ${c.icon?.avatar
          ? `<img src="${esc(c.icon.avatar)}" alt="">`
          : `<span style="background:${esc(c.icon?.bg || '#38bdf8')}">${esc(c.icon?.emoji || '👤')}</span>`}
      </div>
      <div class="studio-comment-body">
        <div class="meta"><b>${esc(c.username || 'user')}</b> · ${esc(timeAgo(c.ts || Date.now()))}</div>
        <div class="text">${esc(c.text)}</div>
        <div class="meta">
          On <a href="#/watch/${esc(c._vid)}" style="color:var(--accent)">${esc(c._videoTitle)}</a>
        </div>
      </div>
    </div>
  `).join('') : `<div class="studio-empty-card">No comments on your videos yet.</div>`;

  const content = `
    <div class="studio-head"><h1>Comments</h1></div>
    <p class="studio-lede">${all.length} comment${all.length === 1 ? '' : 's'} across all your videos.</p>
    <section class="studio-card">
      ${rows}
    </section>
  `;

  return studioWrap(ctx, ch, 'comments', content);
}

/* ============================================================
   SETTINGS — channel edit
   ============================================================ */
function viewStudioSettings(ctx, ch) {
  const channels = ctx.myChannels();
  const activeId = ctx.state.activeChannelId;

  const switcher = channels.length > 1 ? `
    <section class="studio-card">
      <h3>Your channels</h3>
      <div style="display:flex;flex-direction:column;gap:6px;margin-top:12px">
        ${channels.map(c => {
          const isActive = c.id === activeId;
          return `<button class="studio-channel-row ${isActive ? 'active' : ''}"
                        data-action="switch-channel" data-cid="${esc(c.id)}" type="button">
            ${c.avatar
              ? `<span class="studio-channel-pic"><img src="${esc(c.avatar)}" alt=""></span>`
              : `<span class="studio-channel-pic" style="background:${esc(c.color || '#38bdf8')}">${esc(initial(c.name))}</span>`}
            <div style="flex:1;min-width:0;text-align:left">
              <div style="font-weight:700">${esc(c.name)}</div>
              <div style="font-size:12px;color:var(--muted)">${esc(c.handle || '')} · ${fmt(ctx.subsOf(c.id))} subs</div>
            </div>
            ${isActive ? '<span style="color:var(--accent);font-weight:800;font-size:12px">ACTIVE</span>' : ''}
          </button>`;
        }).join('')}
      </div>
    </section>` : '';

  const content = `
    <div class="studio-head"><h1>Settings</h1></div>

    ${switcher}

    <section class="studio-card">
      <h3>Channel details</h3>
      <div class="studio-settings-preview">
        ${ch.avatar
          ? `<span class="studio-channel-pic lg"><img src="${esc(ch.avatar)}" alt=""></span>`
          : `<span class="studio-channel-pic lg" style="background:${esc(ch.color || '#38bdf8')}">${esc(initial(ch.name))}</span>`}
        <div>
          <div style="font-size:18px;font-weight:800">${esc(ch.name)}</div>
          <div style="color:var(--muted);font-size:13px">${esc(ch.handle || '')} · ${fmt(ctx.subsOf(ch.id))} subscribers</div>
        </div>
      </div>
      <p class="studio-lede" style="margin-top:14px">
        To edit your channel's name, handle, avatar, or banner, click the button below.
      </p>
      <button class="btn-primary" id="editChBtn" type="button">Edit channel</button>
    </section>
  `;

  return studioWrap(ctx, ch, 'settings', content);
}