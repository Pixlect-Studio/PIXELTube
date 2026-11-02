// upload.js
export async function uploadInChunks(file, fileName, folder, onProgress) {
    const CHUNK_SIZE = 3 * 1024 * 1024; // 3MB per chunk (Safe for Vercel)
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
        
        if (!res.ok) throw new Error(`Failed to upload chunk ${i + 1}`);
        
        if (onProgress) onProgress((i + 1) / totalChunks);
    }
}