const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ path: './data.env' });

const app = express();
app.use(cors());
app.use(express.static(__dirname)); // Serves index.html

// API endpoint to fetch videos from Bunny.net
app.get('/api/videos', async (req, res) => {
    try {
        const { BUNNY_ACCESS_KEY, BUNNY_STORAGE_ZONE, BUNNY_CDN_HOSTNAME } = process.env;
        
        // Fetch the file list from the "videos" folder in Bunny Storage (matches your screenshot)
        const response = await fetch(`https://storage.bunnycdn.com/${BUNNY_STORAGE_ZONE}/videos/`, {
            method: 'GET',
            headers: {
                'AccessKey': BUNNY_ACCESS_KEY,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) throw new Error('Failed to fetch from Bunny.net');

        const files = await response.json();
        
        // Map Bunny files to PIXELTube video objects
        const videos = files
            .filter(f => f.IsDirectory === false && f.ObjectName.match(/\.(mp4|webm|ogg)$/i))
            .map((file, index) => {
                const cleanName = file.ObjectName.replace(/\.[^/.]+$/, "").replace(/-/g, ' ');
                return {
                    id: `bunny-${index}`,
                    title: cleanName.charAt(0).toUpperCase() + cleanName.slice(1),
                    channel: 'Bunny CDN Uploads',
                    subs: '1.2M',
                    views: `${Math.floor(Math.random() * 500) + 10}K views`,
                    time: new Date(file.LastChanged).toLocaleDateString(),
                    duration: '0:00', // Bunny doesn't provide duration automatically
                    emoji: '🎬',
                    grad: ['#0f2027', '#2c5364'],
                    avatar: '#1d3557',
                    verified: true,
                    category: 'Tech',
                    videoUrl: `https://${BUNNY_CDN_HOSTNAME}/videos/${file.ObjectName}`
                };
            });

        res.json(videos);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load videos' });
    }
});

app.listen(process.env.PORT, () => {
    console.log(`PIXELTube server running at http://localhost:${process.env.PORT}`);
});