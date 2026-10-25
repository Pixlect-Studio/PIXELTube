/* Browser-local social features for demos only; this is not server authentication. */
(function () {
  'use strict';

  const STORAGE_KEY = 'pixeltube:demo-social:v1';
  const USER_ID_PATTERN = /^[a-z0-9_-]{1,128}$/i;
  const MODERATOR_IDS = new Set([
    'ikuwpu9yigv0yhtuzpxy2t9pdph2',
    'sbtsrrjaz5deh6o9bdvcjgifbvj2',
    'sqqbvrd7a1avxlln5xxkblvgprw1',
    'dss1y55ukrcceaxyloqi2yco4hl2',
    '67f9crkupauk0dmpaz3tygtfqsw2',
  ]);
  const REPORT_REASONS = new Set(['spam', 'harassment', 'harmful', 'copyright', 'other']);
  const REPORT_STATUSES = new Set(['pending', 'reviewed', 'dismissed']);

  function getIdentity(user) {
    if (!user) return null;
    const uuid = user.PIXELUserUUID
      || user.pixelUserUUID
      || user.pixel_user_uuid
      || user.user_uuid
      || user.PIXELUser?.UUID
      || user.pixelUser?.uuid
      || user.uuid
      || user.uid;
    if (typeof uuid !== 'string' || !USER_ID_PATTERN.test(uuid)) return null;
    return { uuid, name: String(user.username || user.displayName || 'PIXELUser') };
  }

  function readStore() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
    } catch (error) {
      throw new Error(`Local demo features require browser storage: ${error.message}`);
    }
    if (!raw) return { accounts: {}, reactions: {}, comments: {}, owners: {}, reports: [] };
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('Invalid social data');
      parsed.accounts ||= {};
      parsed.reactions ||= {};
      parsed.comments ||= {};
      parsed.owners ||= {};
      parsed.reports ||= [];
      return parsed;
    } catch (error) {
      throw new Error(`Could not read local demo data: ${error.message}`);
    }
  }

  function writeStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      window.dispatchEvent(new CustomEvent('pixeltube:demosocialchange'));
    } catch (error) {
      throw new Error(`Could not save local demo data: ${error.message}`);
    }
  }

  function requireIdentity(user) {
    const identity = getIdentity(user);
    if (!identity) throw new Error('Sign in with a PIXELUser UUID to use local demo features.');
    return identity;
  }

  function getAccountId(user) {
    if (!user) return null;
    const id = user.PIXELUserUUID
      || user.pixelUserUUID
      || user.pixel_user_uuid
      || user.user_uuid
      || user.PIXELUser?.UUID
      || user.pixelUser?.uuid
      || user.uuid;
    return typeof id === 'string' && USER_ID_PATTERN.test(id) ? id.toLowerCase() : null;
  }

  function isModerator(user) {
    const id = getAccountId(user);
    return Boolean(id && MODERATOR_IDS.has(id));
  }

  function reportVideo(user, videoId, videoTitle, reason, details) {
    const id = String(videoId || '').trim();
    const cleanReason = String(reason || '');
    const cleanDetails = String(details || '').trim();
    if (!id) throw new Error('This video could not be identified. Refresh and try again.');
    if (!REPORT_REASONS.has(cleanReason)) throw new Error('Choose a reason for reporting this video.');
    if (cleanDetails.length > 1000) throw new Error('Additional details must be 1,000 characters or fewer.');

    const store = readStore();
    if (store.reports.length >= 500) {
      throw new Error('The local demo report queue is full. Please contact a site administrator.');
    }

    const reporter = getIdentity(user);
    const report = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      videoId: id,
      videoTitle: String(videoTitle || 'Untitled').slice(0, 200),
      reason: cleanReason,
      details: cleanDetails,
      reporterUuid: reporter?.uuid || null,
      reporterName: reporter?.name || 'Guest',
      createdAt: new Date().toISOString(),
      status: 'pending',
      assignedTo: [...MODERATOR_IDS],
    };
    store.reports.unshift(report);
    for (const moderatorId of MODERATOR_IDS) {
      notify(store, moderatorId, `A video was reported: ${report.videoTitle} (${report.reason}).`);
    }
    writeStore(store);
    return report;
  }

  function getModeratorReports(user) {
    if (!isModerator(user)) throw new Error('This PIXLECT account is not on the local moderator list.');
    const moderatorId = getAccountId(user);
    const store = readStore();
    return store.reports
      .filter(report => report.assignedTo?.includes(moderatorId))
      .map(report => ({ ...report }));
  }

  function updateModeratorReport(user, reportId, status) {
    if (!isModerator(user)) throw new Error('This PIXLECT account is not on the local moderator list.');
    if (!REPORT_STATUSES.has(status) || status === 'pending') {
      throw new Error('Choose a valid moderation action.');
    }
    const store = readStore();
    const report = store.reports.find(item => item.id === reportId);
    if (!report) throw new Error('This report is no longer in the local queue.');
    report.status = status;
    report.reviewedAt = new Date().toISOString();
    report.reviewedBy = getAccountId(user);
    writeStore(store);
    return { ...report };
  }

  function getAccount(store, identity) {
    store.accounts[identity.uuid] ||= { subscriptions: [], history: [], notifications: [] };
    return store.accounts[identity.uuid];
  }

  function notify(store, uuid, text) {
    if (!uuid) return;
    const account = getAccount(store, { uuid });
    account.notifications.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text,
      createdAt: new Date().toISOString(),
      read: false,
    });
    account.notifications = account.notifications.slice(0, 100);
  }

  function setReaction(user, videoId, reaction) {
    const identity = requireIdentity(user);
    const store = readStore();
    const reactions = store.reactions[videoId] ||= {};
    if (reactions[identity.uuid] === reaction) delete reactions[identity.uuid];
    else reactions[identity.uuid] = reaction;
    const owner = store.owners[videoId];
    if (owner && owner.uuid !== identity.uuid) {
      notify(store, owner.uuid, `${identity.name} ${reaction === 'like' ? 'liked' : 'disliked'} your video.`);
    }
    writeStore(store);
    return reactions[identity.uuid] || null;
  }

  function addComment(user, videoId, text) {
    const identity = requireIdentity(user);
    const body = String(text || '').trim();
    if (!body) throw new Error('Write a comment before posting.');
    if (body.length > 2000) throw new Error('Comments must be 2,000 characters or fewer.');
    const store = readStore();
    const comment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      uuid: identity.uuid,
      username: identity.name,
      text: body,
      createdAt: new Date().toISOString(),
    };
    (store.comments[videoId] ||= []).unshift(comment);
    const owner = store.owners[videoId];
    if (owner && owner.uuid !== identity.uuid) notify(store, owner.uuid, `${identity.name} commented on your video.`);
    writeStore(store);
    return comment;
  }

  function toggleSubscription(user, creatorUuid) {
    const identity = requireIdentity(user);
    if (!USER_ID_PATTERN.test(creatorUuid || '')) throw new Error('This video has no PIXLECT creator ID.');
    if (identity.uuid === creatorUuid) throw new Error('You cannot subscribe to your own channel.');
    const store = readStore();
    const account = getAccount(store, identity);
    const index = account.subscriptions.indexOf(creatorUuid);
    const subscribed = index < 0;
    if (subscribed) account.subscriptions.push(creatorUuid);
    else account.subscriptions.splice(index, 1);
    if (subscribed) notify(store, creatorUuid, `${identity.name} subscribed to your channel.`);
    writeStore(store);
    return subscribed;
  }

  function registerVideoOwner(videoId, user) {
    const identity = getIdentity(user);
    if (!identity || !videoId) return;
    const store = readStore();
    store.owners[videoId] = identity;
    getAccount(store, identity);
    writeStore(store);
  }

  function getVideoOwner(video) {
    const store = readStore();
    const uuid = video.creator_uuid || video.creatorUUID || video.uploader_uuid
      || store.owners[video.id]?.uuid;
    if (typeof uuid !== 'string' || !USER_ID_PATTERN.test(uuid)) return null;
    return { uuid: uuid.toLowerCase(), name: video.creator_name || video.creatorName || store.owners[video.id]?.name || 'Creator' };
  }

  function recordView(user, videoId) {
    const identity = getIdentity(user);
    if (!identity) return;
    const store = readStore();
    const account = getAccount(store, identity);
    account.history = [videoId, ...account.history.filter(id => id !== videoId)].slice(0, 100);
    writeStore(store);
  }

  function getFeedIds(user, feed) {
    const identity = requireIdentity(user);
    const store = readStore();
    const account = getAccount(store, identity);
    if (feed === 'history') return account.history.slice();
    if (feed === 'liked') {
      return Object.keys(store.reactions).filter(id => store.reactions[id][identity.uuid] === 'like');
    }
    if (feed === 'subscriptions') {
      return Object.keys(store.owners).filter(id => account.subscriptions.includes(store.owners[id].uuid));
    }
    return [];
  }

  function getVideoSocial(user, video) {
    const identity = getIdentity(user);
    const store = readStore();
    const videoId = video.id;
    const reactions = Object.values(store.reactions[videoId] || {});
    const comments = store.comments[videoId] || [];
    const owner = getVideoOwner(video);
    return {
      reaction: identity ? store.reactions[videoId]?.[identity.uuid] || null : null,
      likes: reactions.filter(value => value === 'like').length,
      dislikes: reactions.filter(value => value === 'dislike').length,
      comments,
      creator: owner,
      subscribed: Boolean(identity && owner && store.accounts[identity.uuid]?.subscriptions.includes(owner.uuid)),
      canSubscribe: Boolean(identity && owner && identity.uuid !== owner.uuid),
    };
  }

  function getNotifications(user) {
    const identity = requireIdentity(user);
    const store = readStore();
    return getAccount(store, identity).notifications.slice();
  }

  function getSubscriberCount(creatorUuid) {
    const store = readStore();
    return Object.values(store.accounts).filter(account => account.subscriptions.includes(creatorUuid)).length;
  }

  function markNotificationsRead(user) {
    const identity = requireIdentity(user);
    const store = readStore();
    getAccount(store, identity).notifications.forEach(item => { item.read = true; });
    writeStore(store);
  }

  window.PIXELTubeDemoSocial = {
    getIdentity,
    isModerator,
    reportVideo,
    getModeratorReports,
    updateModeratorReport,
    setReaction,
    addComment,
    toggleSubscription,
    registerVideoOwner,
    getVideoOwner,
    recordView,
    getFeedIds,
    getVideoSocial,
    getSubscriberCount,
    getNotifications,
    markNotificationsRead,
  };
})();
