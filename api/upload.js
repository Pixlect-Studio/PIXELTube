// api/upload.js
import { Readable } from 'stream';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Content-Range');
  
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { searchParams } = new URL(req.url, `http://${req.headers.host}`);
  const fileName = searchParams.get('filename');
  const folder = searchParams.get('folder') || 'videos';
  const chunkIndex = parseInt(searchParams.get('chunkIndex') || '0');
  
  const zone = process.env.BUNNY_STORAGE_ZONE || 'pixeltube-videos';
  const key = process.env.BUNNY_ACCESS_KEY;
  
  const contentRange = req.headers['content-range'];
  
  // First chunk uses PUT to create the file. Subsequent chunks use PATCH to append.
  const method = chunkIndex === 0 ? 'PUT' : 'PATCH';
  
  const bunnyUrl = `https://uk.storage.bunnycdn.com/${zone}/${folder}/${fileName}`;

  try {
    const response = await fetch(bunnyUrl, {
      method: method,
      headers: {
        'AccessKey': key,
        'Content-Type': 'application/octet-stream',
        ...(contentRange && { 'Content-Range': contentRange })
      },
      body: Readable.toWeb(req), // Convert Node stream to Web stream for fetch
      duplex: 'half'
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error("Bunny Chunk Error:", response.status, errorText);
        return res.status(response.status).json({ error: 'Bunny rejected chunk' });
    }

    res.status(200).json({ success: true, chunk: chunkIndex });
  } catch (error) {
    console.error('Proxy Upload Error:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
}