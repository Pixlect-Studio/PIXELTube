// storage.js
// No more config or API keys needed! Everything goes through the backend.

export async function fetchVideos() {
    try {
        const response = await fetch('/api/videos');
        if (!response.ok) return [];
        const files = await response.json();
        return mapFiles(files, 'videos');
    } catch (error) {
        console.error("Fetch Videos Error:", error);
        return [];
    }
}

export async function fetchMinis() {
    try {
        const response = await fetch('/api/minis');
        if (!response.ok) return [];
        const files = await response.json();
        return mapFiles(files, 'minis');
    } catch (error) {
        console.error("Fetch Minis Error:", error);
        return [];
    }
}

// Helper to format Bunny file objects
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
                subs: '1.2M',
                views: 'New',
                time: new Date(file.LastChanged).toLocaleDateString(),
                duration: folder === 'minis' ? '0:30' : '0:00',
                thumbnail: `https://placehold.co/600x338/1f1f1f/FFF?text=PIXELTube`,
                avatar: '#1d3557',
                verified: true,
                category: 'Tech',
                // We need the CDN hostname. We'll use a public env var for this.
                videoUrl: `https://${window.BUNNY_CDN || 'pixeltube.b-cdn.net'}/${folder}/${file.ObjectName}`,
                isMini: folder === 'minis'
            };
        });
}

export async function fetchBunnyStats() {
    try {
        const res = await fetch('/api/stats');
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('Failed to fetch stats');
        return await res.json();
    } catch (e) { 
        console.warn("Stats Error:", e);
        return null; 
    }
}

export async function saveBunnyStats(data) {
    try {
        const res = await fetch('/api/stats', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return res.ok;
    } catch (e) { 
        console.error("Save Stats Error:", e);
        return false; 
    }
}

export async function uploadToBunny(file, fileName, folder = 'videos') {
    const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const res = await fetch(`/api/upload?filename=${safeName}&folder=${folder}`, {
        method: 'PUT',
        body: file
    });
    if (!res.ok) throw new Error('Upload failed');
    return true;
}