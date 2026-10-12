/* ============================================================
   PIXELTube — channel.js
   Channel page view + create/edit modals + delete extra channels.
   ============================================================ */
import { esc, initial, avatarHTML, resizeImageFile, fmt, timeAgo, thumbHTML } from './helpers.js';

/* ============================================================
   CHANNEL PAGE VIEW
   ============================================================ */
export function viewChannel(ctx, cid) {
  const { state, videosSorted, cardHTML, shortCardHTML, emptyState, subsOf, isSubbed, PIXLECT, myChannels } = ctx;
  const c = state.channels[cid];
  if (!c) return emptyState('🚫', 'Channel not found', '', `<a class="btn-ghost" href="#/">Go home</a>`);

  const list = videosSorted().filter(v => v.channelId === cid);
  const longs = list.filter(v => v.kind !== 'mini');
  const minis = list.filter(v => v.kind === 'mini');
  const subbed = isSubbed(cid);

  const myIds = (myChannels() || []).map(x => x.id);
  const isMine = PIXLECT.user && c.ownerUid === PIXLECT.user.uid && myIds.includes(cid);
  const isPrimary = PIXLECT.user && cid === ('pl_' + PIXLECT.user.uid);
  const isActive = PIXLECT.user && state.activeChannelId === cid;

  const bannerStyle = c.banner
    ? `background-image:url('${esc(c.banner)}')`
    : `background:linear-gradient(120deg,${esc(c.color)},#12121a 70%)`;

  const ownerActions = isMine
    ? `<div style="display:flex;gap:8px;flex-wrap:wrap">
         ${!isActive ? `<button class="btn-primary" id="makeActiveBtn" data-cid="${esc(cid)}" type="button" style="font-size:13px;padding:9px 16px">Set as active</button>` : ''}
         <button class="btn-secondary" id="editChBtn" type="button" style="font-size:13px;padding:9px 16px">Edit channel</button>
         ${!isPrimary ? `<button class="btn-secondary" id="deleteChBtn" data-cid="${esc(cid)}" type="button" style="font-size:13px;padding:9px 16px;color:var(--accent)">Delete</button>` : ''}
       </div>`
    : `<button class="btn-sub ${subbed ? 'subbed' : ''}" data-action="sub" data-channel="${esc(cid)}" data-dyn="sub" type="button">${subbed ? 'Subscribed' : 'Subscribe'}</button>`;

  return `
    <div class="banner" style="${bannerStyle}"></div>
    <div class="chan-head">
      ${avatarHTML(c, 'lg')}
      <div class="txt">
        <h1>${esc(c.name)}${isPrimary ? ' <span style="font-size:12px;font-weight:800;color:var(--accent);letter-spacing:.6px;vertical-align:middle">PRIMARY</span>' : ''}</h1>
        <div class="meta">
          ${esc(c.handle)} ·
          <span data-dyn="subcount" data-channel="${esc(cid)}">${fmt(subsOf(cid))} subscribers</span> ·
          ${list.length} video${list.length === 1 ? '' : 's'}
        </div>
      </div>
      ${ownerActions}
    </div>
    ${minis.length ? `
      <section class="shorts-shelf">
        <div class="shelf-head">
          <div class="icon"><svg viewBox="0 0 24 24"><path d="M13 2L4.5 13H11l-1 9L18.5 11H12z"/></svg></div>
          <h2>Minis</h2>
        </div>
        <div class="shorts-rail">${minis.map(shortCardHTML).join('')}</div>
      </section>` : ''}
    ${longs.length
      ? `<div class="grid">${longs.map(cardHTML).join('')}</div>`
      : (minis.length ? '' : emptyState('📭', 'No videos on this channel yet', 'When they upload, they\'ll appear here.', ''))}
  `;
}

/* ============================================================
   CREATE CHANNEL MODAL — used when user has no channels at all
   ============================================================ */
export function promptCreateChannel(ctx) {
  const { PIXLECT, openModal, toast, saveChannel, primaryChannelId, addChannelToIndex, setActiveChannel,
          renderTopbar, renderSidebar, render, state, db, ref, set } = ctx;

  if (!PIXLECT.user) { ctx.pixlectSignIn(); return; }

  openModal(`
    <button class="close" type="button" onclick="document.getElementById('modalRoot').innerHTML=''">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </button>
    <h2>Create your PIXELChannel</h2>
    <p class="lede">This will be your primary channel. You can add up to 5 more from your profile menu later.</p>

    <div class="avatar-preview">
      <div class="av" id="chAvPreview">${esc(initial(PIXLECT.user.username))}</div>
      <div class="meta">
        <strong>${esc(PIXLECT.user.username)}</strong>
        <small>Your primary channel</small>
      </div>
    </div>

    <div class="field">
      <label for="chName">Channel name *</label>
      <input id="chName" type="text" maxlength="60" value="${esc(PIXLECT.user.username)}" />
    </div>
    <div class="field">
      <label for="chHandle">Handle</label>
      <input id="chHandle" type="text" maxlength="30" value="@${esc(PIXLECT.user.username)}" />
    </div>
    <div class="field">
      <label>Profile picture</label>
      <div class="source-tabs">
        <button type="button" class="source-tab active" data-chav="emoji">😀 Emoji</button>
        <button type="button" class="source-tab" data-chav="upload">🖼️ Upload</button>
        <button type="button" class="source-tab" data-chav="url">🔗 URL</button>
      </div>
      <div id="chAvPaneEmoji"><div class="info-note">Your PIXLECT emoji will be used.</div></div>
      <div id="chAvPaneUpload" style="display:none">
        <div class="dropzone" id="chAvDrop">
          <input type="file" id="chAvFile" accept="image/*" />
          <div class="dz-icon">🖼️</div>
          <div class="dz-title">Click to choose an image</div>
          <div class="dz-sub">JPG, PNG, WebP</div>
        </div>
      </div>
      <div id="chAvPaneUrl" style="display:none">
        <input id="chAvUrl" type="url" placeholder="https://example.com/avatar.jpg" />
      </div>
    </div>

    <div class="form-actions">
      <button type="button" class="btn-secondary" onclick="document.getElementById('modalRoot').innerHTML=''">Cancel</button>
      <button type="button" class="btn-primary" id="chCreateBtn">Create PIXELChannel</button>
    </div>
  `);

  const P = primaryChannelId();
  let chAvMode = 'emoji';
  let chAvData = '';

  const avPreview = document.getElementById('chAvPreview');
  const nameInput = document.getElementById('chName');
  const handleInput = document.getElementById('chHandle');

  const updateAvPreview = () => {
    if (chAvMode === 'emoji' || !chAvData) {
      avPreview.innerHTML = esc(initial(nameInput.value || PIXLECT.user.username));
      avPreview.style.background = PIXLECT.user.icon?.bg || '#38bdf8';
    } else {
      avPreview.innerHTML = `<img src="${esc(chAvData)}" alt="">`;
    }
  };

  document.querySelectorAll('[data-chav]').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('[data-chav]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    chAvMode = t.dataset.chav;
    document.getElementById('chAvPaneEmoji').style.display   = chAvMode === 'emoji'  ? '' : 'none';
    document.getElementById('chAvPaneUpload').style.display  = chAvMode === 'upload' ? '' : 'none';
    document.getElementById('chAvPaneUrl').style.display     = chAvMode === 'url'    ? '' : 'none';
    if (chAvMode !== 'upload' && chAvMode !== 'url') chAvData = '';
    updateAvPreview();
  }));

  const drop = document.getElementById('chAvDrop');
  const file = document.getElementById('chAvFile');
  if (drop && file) {
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      chAvData = await resizeImageFile(f, 240);
      updateAvPreview();
    });
  }
  const url = document.getElementById('chAvUrl');
  if (url) url.addEventListener('input', (e) => {
    chAvData = e.target.value.trim();
    updateAvPreview();
  });
  nameInput.addEventListener('input', updateAvPreview);

  document.getElementById('chCreateBtn').onclick = async () => {
    const name = nameInput.value.trim();
    const handle = handleInput.value.trim();
    if (!name) { toast('Channel name is required'); return; }
    const avatar = chAvMode === 'emoji' ? '' : chAvData;
    await saveChannel(P, { name, handle, avatar });
    await addChannelToIndex(P);
    await setActiveChannel(P);
    ctx.closeModal();
    toast('PIXELChannel created 🎉');
    renderTopbar();
    renderSidebar();
    render(true);
  };
}

/* ============================================================
   EDIT CHANNEL MODAL — always edits the ACTIVE channel
   ============================================================ */
export function promptEditChannel(ctx) {
  const {
    PIXLECT, myChannel, openModal, closeModal, saveChannel, deleteChannel,
    primaryChannelId, toast, renderTopbar, renderSidebar, render
  } = ctx;

  if (!PIXLECT.user) { ctx.pixlectSignIn(); return; }

  const ch = myChannel();
  if (!ch) { promptCreateChannel(ctx); return; }

  const isPrimary = ch.id === primaryChannelId();
  const videoCount = Object.values(ctx.state.videos).filter(v => v.channelId === ch.id).length;
  const canDelete = !isPrimary && videoCount === 0;

  openModal(`
    <button class="close" type="button" onclick="document.getElementById('modalRoot').innerHTML=''">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </button>
    <h2>Edit ${isPrimary ? 'your primary channel' : 'channel'}</h2>
    <p class="lede">${isPrimary
      ? 'This is your primary channel. Its handle mirrors your PIXLECT username.'
      : 'Update the name, handle, and picture for this channel.'}</p>

    <div class="avatar-preview">
      <div class="av" id="chAvPreview">${ch.avatar ? `<img src="${esc(ch.avatar)}" alt="">` : esc(initial(ch.name))}</div>
      <div class="meta">
        <strong>${esc(ch.name)}</strong>
        <small>${esc(ch.handle)}${isPrimary ? ' · PRIMARY' : ''}</small>
      </div>
    </div>

    <div class="field">
      <label for="chName">Channel name *</label>
      <input id="chName" type="text" maxlength="60" value="${esc(ch.name)}" />
    </div>
    <div class="field">
      <label for="chHandle">Handle</label>
      <input id="chHandle" type="text" maxlength="30" value="${esc(ch.handle)}" />
    </div>
    <div class="field">
      <label>Profile picture</label>
      <div class="source-tabs">
        <button type="button" class="source-tab active" data-chav="keep">Keep</button>
        <button type="button" class="source-tab" data-chav="upload">🖼️ Upload</button>
        <button type="button" class="source-tab" data-chav="url">🔗 URL</button>
        <button type="button" class="source-tab" data-chav="remove">Remove</button>
      </div>
      <div id="chAvPaneKeep"><div class="info-note">Current picture will be kept.</div></div>
      <div id="chAvPaneUpload" style="display:none">
        <div class="dropzone" id="chAvDrop">
          <input type="file" id="chAvFile" accept="image/*" />
          <div class="dz-icon">🖼️</div>
          <div class="dz-title">Click to choose an image</div>
        </div>
      </div>
      <div id="chAvPaneUrl" style="display:none">
        <input id="chAvUrl" type="url" placeholder="https://example.com/avatar.jpg" />
      </div>
      <div id="chAvPaneRemove" style="display:none">
        <div class="info-note">Picture will be cleared — a colored initial will be shown instead.</div>
      </div>
    </div>

    ${!isPrimary ? `
      <div class="info-note" style="margin-bottom:14px">
        ${videoCount === 0
          ? 'This channel has no videos. You can safely delete it.'
          : `This channel has <b>${videoCount}</b> video${videoCount === 1 ? '' : 's'}. Delete or move them before removing the channel.`}
      </div>` : ''}

    <div class="form-actions">
      ${canDelete ? `<button type="button" class="btn-secondary" id="chDeleteBtn" style="color:var(--accent);margin-right:auto">Delete channel</button>` : ''}
      <button type="button" class="btn-secondary" onclick="document.getElementById('modalRoot').innerHTML=''">Cancel</button>
      <button type="button" class="btn-primary" id="chSaveBtn">Save</button>
    </div>
  `);

  let chAvMode = 'keep';
  let chAvData = '';

  const avPreview = document.getElementById('chAvPreview');
  const nameInput = document.getElementById('chName');

  const updateAvPreview = () => {
    if (chAvMode === 'remove' || (chAvMode === 'keep' && !ch.avatar)) {
      avPreview.innerHTML = esc(initial(nameInput.value || ch.name));
      avPreview.style.background = 'linear-gradient(135deg,var(--accent),var(--accent2))';
    } else if (chAvMode === 'keep' && ch.avatar) {
      avPreview.innerHTML = `<img src="${esc(ch.avatar)}" alt="">`;
    } else {
      avPreview.innerHTML = chAvData
        ? `<img src="${esc(chAvData)}" alt="">`
        : esc(initial(nameInput.value || 'C'));
    }
  };

  document.querySelectorAll('[data-chav]').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('[data-chav]').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    chAvMode = t.dataset.chav;
    ['Emoji', 'Upload', 'Url', 'Keep', 'Remove'].forEach(p => {
      const el = document.getElementById('chAvPane' + p);
      if (el) el.style.display = 'none';
    });
    const cap = chAvMode.charAt(0).toUpperCase() + chAvMode.slice(1);
    const pane = document.getElementById('chAvPane' + cap);
    if (pane) pane.style.display = '';
    if (chAvMode === 'remove') chAvData = '';
    updateAvPreview();
  }));

  const drop = document.getElementById('chAvDrop');
  const file = document.getElementById('chAvFile');
  if (drop && file) {
    drop.addEventListener('click', () => file.click());
    file.addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      chAvData = await resizeImageFile(f, 240);
      updateAvPreview();
    });
  }
  const url = document.getElementById('chAvUrl');
  if (url) url.addEventListener('input', (e) => {
    chAvData = e.target.value.trim();
    updateAvPreview();
  });
  nameInput.addEventListener('input', updateAvPreview);

  document.getElementById('chSaveBtn').onclick = async () => {
    const name = nameInput.value.trim();
    const handle = document.getElementById('chHandle').value.trim();
    if (!name) { toast('Channel name is required'); return; }

    const payload = { name, handle };
    if (chAvMode === 'remove') payload.avatar = '';
    else if (chAvMode === 'upload' || chAvMode === 'url') payload.avatar = chAvData;

    try {
      await saveChannel(ch.id, payload);
      closeModal();
      toast('Channel updated');
      renderTopbar();
      renderSidebar();
      render(true);
    } catch (e) {
      // saveChannel already toasts; keep modal open
    }
  };

  const delBtn = document.getElementById('chDeleteBtn');
  if (delBtn) delBtn.onclick = async () => {
    if (!confirm('Delete this channel permanently? This cannot be undone.')) return;
    const ok = await deleteChannel(ch.id);
    if (ok) {
      closeModal();
      renderTopbar();
      renderSidebar();
      render(true);
    }
  };
}