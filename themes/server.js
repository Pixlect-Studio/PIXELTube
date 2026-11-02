// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: './data.env' });

const app = express();
app.use(cors());
app.use(express.static(__dirname)); // Serves index.html, studio.html, themes, etc.

// Helper for Bunny API
const BUNNY_API = 'https://uk.storage.bunnycdn.com';
const getBunnyUrl = (endpoint) => `${BUNNY_API}/${process.env.BUNNY_STORAGE_ZONE}/${endpoint}`;
const headers = { 'AccessKey': process.env.BUNNY_ACCESS_KEY };

// API: Fetch Videos
app.get('/api/videos', async (req, res) => {
    try {
        const r = await fetch(getBunnyUrl('videos/'), { headers: { ...headers, 'Accept': 'application/json' } });
        res.status(r.status).json(await r.json());
    } catch (e) { res.status(500).json({ error: 'Fetch failed' }); }
});

// API: Fetch Minis
app.get('/api/minis', async (req, res) => {
    try {
        const r = await fetch(getBunnyUrl('minis/'), { headers: { ...headers, 'Accept': 'application/json' } });
        res.status(r.status).json(await r.json());
    } catch (e) { res.status(500).json({ error: 'Fetch failed' }); }
});

// API: Get Stats
app.get('/api/stats', async (req, res) => {
    try {
        const r = await fetch(getBunnyUrl('Statistics/data.json'), { headers });
        if (r.status === 404) return res.status(404).json({});
        res.status(r.status).json(await r.json());
    } catch (e) { res.status(500).json({ error: 'Fetch failed' }); }
});

// API: Save Stats
app.put('/api/stats', express.json(), async (req, res) => {
    try {
        const r = await fetch(getBunnyUrl('Statistics/data.json'), {
            method: 'PUT',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        res.status(r.status).json({ success: r.ok });
    } catch (e) { res.status(500).json({ error: 'Save failed' }); }
});

// API: Chunked Upload
app.post('/api/upload', express.raw({ type: 'application/octet-stream', limit: '10mb' }), async (req, res) => {
    const { filename, folder, chunkIndex } = req.query;
    const contentRange = req.headers['content-range'];
    const method = parseInt(chunkIndex) === 0 ? 'PUT' : 'PATCH';

    try {
        const r = await fetch(getBunnyUrl(`${folder}/${filename}`), {
            method: method,
            headers: { ...headers, 'Content-Type': 'application/octet-stream', ...(contentRange && { 'Content-Range': contentRange }) },
            body: req.body
        });
        res.status(r.status).json({ success: r.ok });
    } catch (e) { res.status(500).json({ error: 'Upload failed' }); }
});

// Fallback to index.html for any other route (like /studio.html)
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(process.env.PORT || 3000, () => {
    console.log(`Server running at http://localhost:${process.env.PORT}`);
});