const DOWNLOADS_KEY = 'pixeltube_offline_downloads';
const CACHE_NAME = 'pixeltube-video-downloads-v1';
export const OFFLINE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024;

let playbackUrls = [];

export function offlineDownloads() {
  try {
    const value = JSON.parse(localStorage.getItem(DOWNLOADS_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch (error) {
    console.error('[offline] could not read offline downloads:', error);
    return [];
  }
}

export function isOfflineDownloaded(vid) {
  return offlineDownloads().some(item => item.video?.id === vid);
}

export async function saveOfflineVideo(video, channel, sourceUrl) {
  if (!('caches' in window) || !location.origin || location.protocol === 'file:') {
    throw new Error('Offline downloads require PIXELTube to be open from its website.');
  }
  if (!navigator.serviceWorker?.controller) {
    throw new Error('Reload PIXELTube once before saving videos offline.');
  }

  const existing = offlineDownloads();
  const retained = existing.filter(item => item.video?.id !== video.id);
  const storedBytes = retained.reduce((total, item) => total + (Number(item.size) || 0), 0);
  const cache = await caches.open(CACHE_NAME);
  const resources = [];
  let downloadedBytes = 0;
  const cachePrefix = new URL(`/__pixeltube_offline__/${encodeURIComponent(video.id)}/${Date.now()}-${Math.random().toString(36).slice(2)}/`, location.origin);

  const addResource = async (url, response) => {
    if (!response.ok) throw new Error(`A video segment returned ${response.status}.`);
    const declaredSize = Number(response.headers.get('content-length')) || 0;
    const remaining = OFFLINE_LIMIT_BYTES - storedBytes - downloadedBytes;
    if (declaredSize > remaining) throw new Error('This download would exceed the 2 GB offline storage limit.');

    const blob = await response.blob();
    const size = blob.size;
    if (size > OFFLINE_LIMIT_BYTES - storedBytes - downloadedBytes) {
      throw new Error('This download would exceed the 2 GB offline storage limit.');
    }

    const key = new URL(String(resources.length), cachePrefix).href;
    await cache.put(key, new Response(blob, {
      headers: {
        'Content-Type': blob.type || 'application/octet-stream',
        'Content-Length': String(size)
      }
    }));
    resources.push({ url, key, type: blob.type || 'application/octet-stream' });
    downloadedBytes += size;
  };

  try {
    let manifest = '';
    let manifestUrl = sourceUrl;
    const isHls = /\.m3u8(?:$|[?#])/i.test(sourceUrl);

    if (isHls) {
      const masterResponse = await fetch(sourceUrl);
      if (!masterResponse.ok) throw new Error(`Video playlist returned ${masterResponse.status}.`);
      const master = await masterResponse.text();
      const masterLines = master.split(/\r?\n/);
      let bestVariant = null;
      for (let index = 0; index < masterLines.length; index += 1) {
        const line = masterLines[index].trim();
        if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
        const uriLine = masterLines.slice(index + 1).find(next => next.trim() && !next.trim().startsWith('#'));
        if (!uriLine) continue;
        const attrs = line.slice(line.indexOf(':') + 1);
        const bandwidth = Number(attrs.match(/(?:^|,)BANDWIDTH=(\d+)/)?.[1]) || 0;
        const resolution = attrs.match(/(?:^|,)RESOLUTION=(\d+x\d+)/)?.[1] || '';
        const pixels = resolution ? resolution.split('x').map(Number).reduce((a, b) => a * b, 1) : 0;
        if (!bestVariant || pixels > bestVariant.pixels ||
            (pixels === bestVariant.pixels && bandwidth > bestVariant.bandwidth)) {
          bestVariant = { pixels, bandwidth, url: new URL(uriLine.trim(), sourceUrl).href };
        }
      }

      if (bestVariant) manifestUrl = bestVariant.url;
      const mediaResponse = bestVariant ? await fetch(manifestUrl) : new Response(master);
      if (!mediaResponse.ok) throw new Error(`Video playlist returned ${mediaResponse.status}.`);
      manifest = await mediaResponse.text();

      const references = new Set();
      for (const line of manifest.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) references.add(new URL(trimmed, manifestUrl).href);
        for (const match of line.matchAll(/URI="([^"]+)"/g)) {
          references.add(new URL(match[1], manifestUrl).href);
        }
      }
      if (!references.size) throw new Error('This HLS playlist contains no downloadable video segments.');

      for (const url of references) {
        const response = await fetch(url);
        await addResource(url, response);
      }
    } else {
      const response = await fetch(sourceUrl);
      if (!response.ok) throw new Error(`Video download returned ${response.status}.`);
      const declaredSize = Number(response.headers.get('content-length')) || 0;
      if (!declaredSize) throw new Error('The video size could not be verified, so it cannot be saved safely.');
      if (declaredSize > OFFLINE_LIMIT_BYTES - storedBytes) {
        throw new Error('This download would exceed the 2 GB offline storage limit.');
      }
      await addResource(sourceUrl, response);
    }

    const download = {
      video: { ...video },
      channel: { ...channel },
      isHls,
      manifest,
      manifestUrl,
      resources,
      size: downloadedBytes,
      savedAt: Date.now()
    };
    localStorage.setItem(DOWNLOADS_KEY, JSON.stringify([...retained, download]));
    if (existing.some(item => item.video?.id === video.id)) {
      await deleteResources(existing.find(item => item.video?.id === video.id));
    }
    return download;
  } catch (error) {
    await Promise.all(resources.map(resource => cache.delete(resource.key)));
    throw error;
  }
}

export async function removeOfflineVideo(vid) {
  const downloads = offlineDownloads();
  const selected = downloads.find(item => item.video?.id === vid);
  if (selected) await deleteResources(selected);
  localStorage.setItem(DOWNLOADS_KEY, JSON.stringify(downloads.filter(item => item.video?.id !== vid)));
}

async function deleteResources(download) {
  if (!download?.resources) return;
  const cache = await caches.open(CACHE_NAME);
  await Promise.all(download.resources.map(resource => cache.delete(resource.key)));
}

export async function offlinePlaybackSource(vid) {
  const download = offlineDownloads().find(item => item.video?.id === vid);
  if (!download) return null;

  const cache = await caches.open(CACHE_NAME);
  const replacements = new Map();
  for (const resource of download.resources) {
    const response = await cache.match(resource.key);
    if (!response) throw new Error(`Offline file for "${download.video.title}" is missing.`);
    replacements.set(resource.url, resource.key);
  }

  if (!download.isHls) {
    const resource = download.resources[0];
    return { url: replacements.get(resource.url), isHls: false };
  }

  const rewritten = download.manifest.split(/\r?\n/).map(line => {
    let output = line;
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const url = new URL(trimmed, download.manifestUrl).href;
      output = line.replace(trimmed, replacements.get(url) || url);
    }
    return output.replace(/URI="([^"]+)"/g, (_match, uri) => {
      const url = new URL(uri, download.manifestUrl).href;
      return `URI="${replacements.get(url) || url}"`;
    });
  }).join('\n');
  const manifestUrl = URL.createObjectURL(new Blob([rewritten], { type: 'application/vnd.apple.mpegurl' }));
  playbackUrls.push(manifestUrl);
  return { url: manifestUrl, isHls: true };
}

export function clearOfflinePlaybackUrls() {
  playbackUrls.forEach(url => URL.revokeObjectURL(url));
  playbackUrls = [];
}
