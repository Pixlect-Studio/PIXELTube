(function () {
  'use strict';

  const videoId = new URLSearchParams(location.search).get('id');
  const player = document.getElementById('videoPlayer');
  const errorBox = document.getElementById('playerError');
  let video = null;
  let countedPlayback = false;
  let socialLoadId = 0;

  function currentUser() {
    return window.PIXELTubeAuth?.user || null;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.classList.remove('hidden');
    document.getElementById('playerTitle').textContent = 'Video unavailable';
  }

  async function renderSocial() {
    if (!video) return;
    const loadId = ++socialLoadId;
    try {
      const user = currentUser();
      const identity = PIXELTubeDemoSocial.getIdentity(user);
      const social = await PIXELTubeAPI.getVideoSocial(video.id, user);
      if (loadId !== socialLoadId) return;
      document.getElementById('likeCount').textContent = social.likes;
      document.getElementById('dislikeCount').textContent = social.dislikes;
      const like = document.getElementById('likeButton');
      const dislike = document.getElementById('dislikeButton');
      like.disabled = !identity;
      dislike.disabled = !identity;
      like.classList.toggle('active', social.reaction === 'like');
      dislike.classList.toggle('active', social.reaction === 'dislike');
      like.setAttribute('aria-pressed', String(social.reaction === 'like'));
      dislike.setAttribute('aria-pressed', String(social.reaction === 'dislike'));

      const owner = social.creator;
      document.getElementById('creatorName').textContent = video.channel || owner?.name || 'Creator';
      document.getElementById('creatorSubscribers').textContent = owner
        ? `${social.subscriber_count} subscribers`
        : (video.creator_name ? `Created by ${video.creator_name}` : 'Channel');
      const subscribe = document.getElementById('subscribeButton');
      subscribe.disabled = !identity || !social.canSubscribe;
      subscribe.textContent = social.subscribed ? 'Subscribed' : 'Subscribe';
      subscribe.classList.toggle('active', social.subscribed);
      subscribe.title = identity
        ? (owner ? 'Subscription is saved to PIXELTube storage' : 'Creator account is unavailable')
        : 'Sign in with PIXLECT to subscribe';

      const comments = document.getElementById('commentsList');
      comments.replaceChildren();
      social.comments.forEach(comment => {
        const item = document.createElement('article');
        item.className = 'comment-item';
        const name = document.createElement('strong');
        name.textContent = comment.username;
        const time = document.createElement('time');
        const createdAt = comment.created_at || comment.createdAt;
        time.dateTime = createdAt;
        time.textContent = new Date(createdAt).toLocaleString();
        const body = document.createElement('p');
        body.textContent = comment.text;
        item.append(name, time, body);
        comments.appendChild(item);
      });
      document.getElementById('commentCount').textContent = `· ${social.comments.length}`;
      const input = document.getElementById('commentInput');
      input.disabled = !identity;
      input.placeholder = identity ? 'Add a comment…' : 'Sign in with PIXLECT to comment';
      document.querySelector('#commentForm button').disabled = !identity;
      document.getElementById('identityMessage').textContent = identity
        ? 'Comments, likes, and subscriptions are stored by PIXELTube. Account IDs are supplied by the browser and are not verified by this demo server.'
        : 'Sign in with PIXLECT to like, subscribe, or comment.';
    } catch (error) {
      console.error('Could not load video interactions from Bunny Storage:', error);
      if (loadId === socialLoadId) {
        document.getElementById('identityMessage').textContent = `Could not load interactions: ${error.message}`;
      }
    }
  }

  async function loadRelated() {
    const container = document.getElementById('relatedVideos');
    try {
      const videos = await PIXELTubeAPI.listVideos();
      const related = videos.filter(item => item.id !== video.id);
      if (!related.length) {
        container.textContent = 'No other videos yet.';
        return;
      }
      related.slice(0, 10).forEach(item => {
        const link = document.createElement('a');
        link.className = 'related-video';
        link.href = `video_player.html?id=${encodeURIComponent(item.id)}`;
        const title = document.createElement('strong');
        title.textContent = item.title || 'Untitled';
        const metadata = document.createElement('span');
        metadata.textContent = `${item.category || 'General'} · ${Number(item.views) || 0} views`;
        link.append(title, metadata);
        container.appendChild(link);
      });
    } catch (error) {
      console.error('Could not load related videos:', error);
      container.textContent = 'Could not load other videos.';
    }
  }

  async function loadVideo() {
    if (!videoId) {
      showError('No video ID was provided.');
      return;
    }
    try {
      video = await PIXELTubeAPI.getVideo(videoId);
      if (!video.url) throw new Error('This video does not have a playable URL.');
      document.title = `PIXELTube · ${video.title || 'Video'}`;
      document.getElementById('playerTitle').textContent = video.title || 'Untitled';
      document.getElementById('playerMetadata').textContent =
        `${video.category || 'General'} · ${video.channel || 'Channel unavailable'} · ${Number(video.views) || 0} views · ${video.created_at ? new Date(video.created_at).toLocaleDateString() : ''}`;
      document.getElementById('descriptionText').textContent = video.description || 'No description provided.';
      player.src = video.url;
      player.setAttribute('aria-label', `Video player: ${video.title || 'Untitled'}`);
      renderSocial();
      await loadRelated();
    } catch (error) {
      console.error('Could not load video:', error);
      showError(`Could not load this video: ${error.message}`);
    }
  }

  player.addEventListener('playing', async () => {
    if (countedPlayback || !video) return;
    countedPlayback = true;
    try {
      const result = await PIXELTubeAPI.addView(video.id);
      video.views = result.stats.views;
      document.getElementById('playerMetadata').textContent =
        `${video.category || 'General'} · ${video.channel || 'Channel unavailable'} · ${video.views} views · ${video.created_at ? new Date(video.created_at).toLocaleDateString() : ''}`;
    } catch (error) {
      console.error('Could not record video view:', error);
    }
  });

  document.getElementById('likeButton').addEventListener('click', async () => {
    try {
      await PIXELTubeAPI.setReaction(video.id, 'like', currentUser());
      await renderSocial();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('dislikeButton').addEventListener('click', async () => {
    try {
      await PIXELTubeAPI.setReaction(video.id, 'dislike', currentUser());
      await renderSocial();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('subscribeButton').addEventListener('click', async () => {
    try {
      await PIXELTubeAPI.toggleSubscription(video.id, currentUser());
      await renderSocial();
    } catch (error) {
      alert(error.message);
    }
  });
  document.getElementById('commentForm').addEventListener('submit', async event => {
    event.preventDefault();
    try {
      await PIXELTubeAPI.addComment(video.id, document.getElementById('commentInput').value, currentUser());
      document.getElementById('commentInput').value = '';
      renderSocial();
    } catch (error) {
      alert(error.message);
    }
  });

  const reportToggle = document.getElementById('reportVideoToggle');
  const reportPanel = document.getElementById('reportVideoPanel');
  const reportForm = document.getElementById('reportVideoForm');
  const reportStatus = document.getElementById('reportStatus');
  const submitReport = document.getElementById('submitVideoReport');

  reportToggle.addEventListener('click', () => {
    const isExpanded = reportToggle.getAttribute('aria-expanded') === 'true';
    reportToggle.setAttribute('aria-expanded', String(!isExpanded));
    reportPanel.classList.toggle('hidden', isExpanded);
    if (!isExpanded) document.getElementById('reportReason').focus();
  });

  reportForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!video || submitReport.disabled) return;
    submitReport.disabled = true;
    reportStatus.textContent = 'Sending report…';
    try {
      PIXELTubeDemoSocial.reportVideo(
        currentUser(),
        video.id,
        video.title,
        document.getElementById('reportReason').value,
        document.getElementById('reportDetails').value,
      );
      reportStatus.textContent = 'Report sent to the local moderator queue. Thank you for helping keep PIXELTube safe.';
      reportForm.reset();
    } catch (error) {
      reportStatus.textContent = error.message;
      submitReport.disabled = false;
    }
  });

  document.getElementById('shareButton').addEventListener('click', async () => {
    const shareUrl = location.href;
    try {
      if (navigator.share) await navigator.share({ title: video?.title || 'PIXELTube video', url: shareUrl });
      else {
        await navigator.clipboard.writeText(shareUrl);
        alert('Video link copied.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Could not share video:', error);
        alert('Could not share this video.');
      }
    }
  });

  window.addEventListener('pixeltube:profilesettingschange', renderSocial);
  document.addEventListener('DOMContentLoaded', () => {
    window.PIXELTubeAuth?.onChange(renderSocial);
  });
  loadVideo();
})();
