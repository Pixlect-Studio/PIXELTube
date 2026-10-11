/* ============================================================
   PIXELTube — channel.js
   Channel page view + create/edit channel modal.
   ============================================================ */
import { esc, initial, avatarHTML, resizeImageFile, fmt, timeAgo, thumbHTML } from './helpers.js';

/* ============================================================
   CHANNEL PAGE
   ============================================================ */
export function viewChannel(ctx, cid) {
  const { state, videosSorted, cardHTML, shortCardHTML, emptyState, subsOf, isSubbed, PIXLECT } = ctx;
  const c = state.channels[cid];
  if (!c) return emptyState('🚫', 'Channel not found', '', `<a class="btn-ghost" href="#/">Go home</a>`);

  const list = videosSorted().filter(v => v.channelId === cid);
  const longs = list.filter(v => v.kind !== 'mini');
  const minis = list.filter(v => v.kind === 'mini');
  const subbed = isSubbed(cid);
  const isMine = PIXLECT.user && c.ownerUid === PIXLECT.user.uid;
  const bannerStyle = c.banner
    ? `background-image:url('${esc(c.banner)}')`
    : `background:linear-gradient(120deg,${esc(c.color)},#12121a 70%)`;

  return `
    <div class="banner" style="${bannerStyle}"></div>
    <div class="chan-head">
      ${avatarHTML(c, 'lg')}
      <div class="txt">
        <h1>${esc(c.name)}</h1>
        <div class="meta">
          ${esc(c.handle)} ·
          <span data-dyn="subcount" data-channel="${esc(cid)}">${fmt(subsOf(cid))} subscribers</span> ·
          ${list.length} video${list.length === 1 ? '' : 's'}
        </div>
      </div>
      ${isMine
        ? `<button class="btn-secondary" id="editChBtn" type="button">Edit channel</button>`
        : `<button class="btn-sub ${subbed ? 'subbed' : ''}" data-action="sub" data-channel="${esc(cid)}" data-dyn="sub" type="button">${subbed ? 'Subscribed' : 'Subscribe'}</button>`}
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
   CREATE CHANNEL MODAL
   ============================================================ */
export function promptCreateChannel(ctx) {
  console.log('[channel.js] promptCreateChannel called');

  if (!ctx) {
    console.error('[channel.js] promptCreateChannel: ctx is missing!');
    return;
  }
  const { PIXLECT, openModal, createOrUpdateChannel, toast, renderTopbar, renderSidebar, render } = ctx;

  if (!PIXLECT || !PIXLECT.user) {
    console.log('[channel.js] no PIXLECT user → invoking sign-in');
    ctx.pixlectSignIn();
    return;
  }

  console.log('[channel.js] opening create modal for', PIXLECT.user.username);

  openModal(`
    <button class="close" type="button" onclick="document.getElementById('modalRoot').innerHTML=''">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </button>
    <h2>Create your PIXELChannel</h2>
    <p class="lede">Pick a channel name, handle, and profile picture. This is how viewers will find you on PIXELTube.</p>

    <div class="avatar-preview">
      <div class="av" id="chAvPreview">${esc(initial(PIXLECT.user.username))}</div>
      <div class="meta">
        <strong>${esc(PIXLECT.user.username)}</strong>
        <small>Your channel identity</small>
      </div>
    </div>

    <div class="field">
      <label for="chName">Channel name *</label>
      <input id="chName" type="text" maxlength="60" placeholder="e.g. Pixel Studios" value="${esc(PIXLECT.user.username)}" />
    </div>
    <div class="field">
      <label for="chHandle">Handle</label>
      <input id="chHandle" type="text" maxlength="30" placeholder="@pixelstudios" value="@${esc(PIXLECT.user.username)}" />
    </div>
    <div class="field">
      <label>Profile picture</label>
      <div class="source-tabs">
        <button type="button" class="source-tab active" data-chav="emoji">😀 Emoji</button>
        <button type="button" class="source-tab" data-chav="upload">🖼️ Upload</button>
        <button type="button" class="source-tab" data-chav="url">🔗 URL</button>
      </div>
      <div id="chAvPaneEmoji">
        <div class="info-note">Your PIXLECT emoji will be used. You can change it later.</div>
      </div>
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

  console.log('[channel.js] modal HTML injected. #chCreateBtn exists?', !!document.getElementById('chCreateBtn'));

  wireChannelModal(ctx, 'create');

  console.log('[channel.js] modal wired. #chCreateBtn.onclick assigned?', !!document.getElementById('chCreateBtn')?.onclick);
}

/* ============================================================
   EDIT CHANNEL MODAL
   ============================================================ */
export function promptEditChannel(ctx) {
  console.log('[channel.js] promptEditChannel called');

  if (!ctx) {
    console.error('[channel.js] promptEditChannel: ctx is missing!');
    return;
  }
  const { PIXLECT, myChannel, openModal, createOrUpdateChannel, toast,
          renderTopbar, renderSidebar, render } = ctx;

  if (!PIXLECT || !PIXLECT.user) {
    console.log('[channel.js] no PIXLECT user → invoking sign-in');
    ctx.pixlectSignIn();
    return;
  }

  const ch = myChannel();
  if (!ch) {
    console.log('[channel.js] no channel yet → falling back to create');
    return promptCreateChannel(ctx);
  }

  console.log('[channel.js] opening edit modal for', ch.name);

  openModal(`
    <button class="close" type="button" onclick="document.getElementById('modalRoot').innerHTML=''">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>
    </button>
    <h2>Edit your PIXELChannel</h2>
    <p class="lede">Update your channel name, handle, and profile picture.</p>

    <div class="avatar-preview">
      <div class="av" id="chAvPreview">${ch.avatar ? `<img src="${esc(ch.avatar)}" alt="">` : esc(initial(ch.name))}</div>
      <div class="meta">
        <strong>${esc(ch.name)}</strong>
        <small>${esc(ch.handle)}</small>
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
      <div id="chAvPaneKeep">
        <div class="info-note">Current picture will be kept.</div>
      </div>
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

    <div class="form-actions">
      <button type="button" class="btn-secondary" id="chDeleteBtn" style="color:var(--accent)">Delete channel</button>
      <button type="button" class="btn-secondary" onclick="document.getElementById('modalRoot').innerHTML=''">Cancel</button>
      <button type="button" class="btn-primary" id="chSaveBtn">Save</button>
    </div>
  `);

  wireChannelModal(ctx, 'edit');
}

/* ============================================================
   SHARED MODAL WIRING
   ============================================================ */
function wireChannelModal(ctx, mode) {
  console.log('[channel.js] wireChannelModal mode =', mode);

  const { PIXLECT, openModal, closeModal, createOrUpdateChannel, toast,
          renderTopbar, renderSidebar, render, state, myChannelId, myChannel } = ctx;

  const ch = mode === 'edit' ? myChannel() : null;
  let chAvMode = mode === 'edit' ? 'keep' : 'emoji';
  let chAvData = '';

  const avPreview = document.getElementById('chAvPreview');
  const nameInput = document.getElementById('chName');
  const handleInput = document.getElementById('chHandle');

  if (!avPreview || !nameInput || !handleInput) {
    console.error('[channel.js] wireChannelModal: required elements missing',
      { avPreview: !!avPreview, nameInput: !!nameInput, handleInput: !!handleInput });
    return;
  }

  const updateAvPreview = () => {
    if (chAvMode === 'emoji' || (chAvMode === 'keep' && !ch?.avatar) || chAvMode === 'remove') {
      avPreview.innerHTML = esc(initial(nameInput.value || (ch?.name || PIXLECT.user.username)));
      avPreview.style.background = PIXLECT.user.icon?.bg || '#7c4dff';
    } else if (chAvMode === 'keep' && ch?.avatar) {
      avPreview.innerHTML = `<img src="${esc(ch.avatar)}" alt="">`;
    } else {
      avPreview.innerHTML = chAvData
        ? `<img src="${esc(chAvData)}" alt="">`
        : esc(initial(nameInput.value || 'C'));
    }
  };

  // Avatar source tabs
  const tabs = document.querySelectorAll('[data-chav]');
  console.log('[channel.js] wiring', tabs.length, 'avatar tabs');
  tabs.forEach(t => t.addEventListener('click', () => {
    tabs.forEach(x => x.classList.remove('active'));
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

  // Avatar file upload
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

  // Avatar URL
  const urlInput = document.getElementById('chAvUrl');
  if (urlInput) urlInput.addEventListener('input', (e) => {
    chAvData = e.target.value.trim();
    updateAvPreview();
  });

  nameInput.addEventListener('input', updateAvPreview);

  // Save button — this is the one that matters
  const saveBtn = document.getElementById('chCreateBtn') || document.getElementById('chSaveBtn');
  console.log('[channel.js] saveBtn found?', !!saveBtn, 'id =', saveBtn?.id);

  if (saveBtn) {
    saveBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      console.log('[channel.js] save button CLICKED');

      const name = document.getElementById('chName').value.trim();
      const handle = document.getElementById('chHandle').value.trim();
      console.log('[channel.js] name =', JSON.stringify(name), 'handle =', JSON.stringify(handle));

      if (!name) { toast('Channel name is required'); return; }

      const payload = { name, handle };
      if (chAvMode === 'remove') payload.avatar = '';
      else if (chAvMode === 'upload' || chAvMode === 'url') payload.avatar = chAvData;

      console.log('[channel.js] payload =', payload);
      console.log('[channel.js] about to call createOrUpdateChannel');

      try {
        await createOrUpdateChannel(payload);
        console.log('[channel.js] createOrUpdateChannel resolved');
      } catch (err) {
        console.error('[channel.js] createOrUpdateChannel threw:', err);
        toast('Could not save channel: ' + (err?.message || err));
        return;
      }

      closeModal();
      toast(mode === 'create' ? 'PIXELChannel created 🎉' : 'Channel updated');
      renderTopbar();
      renderSidebar();
      render(true);
      console.log('[channel.js] modal closed and UI re-rendered');
    });
  } else {
    console.error('[channel.js] saveBtn NOT FOUND — buttons cannot be wired');
  }

  // Delete button (edit mode only)
  const delBtn = document.getElementById('chDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', async () => {
    if (!confirm('Delete your PIXELChannel? Videos stay but lose their channel. This cannot be undone.')) return;
    const cid = myChannelId();
    console.log('[channel.js] deleting channel', cid);

    if (state.mode === 'firebase' && ctx.db) {
      try { await ctx.remove(ctx.ref(ctx.db, `pixeltube/channels/${cid}`)); }
      catch (e) { console.warn('[channel.js] delete failed', e); }
    } else if (ctx.localDB) {
      delete ctx.localDB.channels[cid];
      ctx.persistLocal();
      ctx.applyData(ctx.localDB);
    }
    closeModal();
    toast('Channel deleted');
    renderTopbar();
    renderSidebar();
    render(true);
  });

  console.log('[channel.js] wireChannelModal complete');
}