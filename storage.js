export async function fetchVideos() {
    try {
        const response = await fetch('/api/videos');
        if (!response.ok) return [];
        return mapFiles(await response.json(), 'videos');
    } catch (error) { return []; }
}

export async function fetchMinis() {
    try {
        const response = await fetch('/api/minis');
        if (!response.ok) return [];
        return mapFiles(await response.json(), 'minis');
    } catch (error) { return []; }
}

function mapFiles(files, folder) {
    if (!Array.isArray(files)) return [];
    return files
        .filter(f => !f.IsDirectory && f.ObjectName.match(/\.(mp4|webm|ogg)$/i))
        .map((file) => {
            const cleanName = file.ObjectName.replace(/\.[^/.]+$/, "").replace(/_/g, ' ');
            return {
                id: `bunny-${folder}-${file.ObjectName}`,
                title: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
                channel: 'PIXELTube Uploads',
                subs: '1.2M', views: 'New',
                time: new Date(file.LastChanged).toLocaleDateString(),
                duration: folder === 'minis' ? '0:30' : '0:00',
                thumbnail: `https://placehold.co/600x338/1f1f1f/FFF?text=PIXELTube`,
                avatar: '#1d3557', verified: true, category: 'Tech',
                videoUrl: `https://${window.BUNNY_CDN || 'apullzone.b-cdn.net'}/${folder}/${file.ObjectName}`,
                isMini: folder === 'minis'
            };
        });
}

export async function fetchBunnyStats() {
    try {
        const res = await fetch('/api/stats');
        if (res.status === 404) return null;
        if (!res.ok) return null;
        return await res.json();
    } catch (e) { return null; }
}

export async function saveBunnyStats(data) {
    try {
        const res = await fetch('/api/stats', {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) { return false; }
}

export async function uploadInChunks(file, fileName, folder, onProgress) {
    const CHUNK_SIZE = 3 * 1024 * 1024; 
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');

    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const contentRange = `bytes ${start}-${end - 1}/${file.size}`;
        
        const res = await fetch(`/api/upload?filename=${encodeURIComponent(safeName)}&folder=${folder}&chunkIndex=${i}`, {
            method: 'POST',
            headers: { 'Content-Range': contentRange },
            body: chunk
        });
        if (!res.ok) throw new Error(`Chunk failed`);
        if (onProgress) onProgress((i + 1) / totalChunks);
    }
}