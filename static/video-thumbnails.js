const PIXELTubeThumbnails = (() => {
  function loadRandomFrame(video) {
    video.preload = 'metadata';

    const seekToRandomFrame = () => {
      if (!Number.isFinite(video.duration) || video.duration <= 0) return;
      video.currentTime = Math.random() * video.duration * 0.95;
    };

    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      seekToRandomFrame();
    } else {
      video.addEventListener('loadedmetadata', seekToRandomFrame, { once: true });
    }
  }

  return { loadRandomFrame };
})();
