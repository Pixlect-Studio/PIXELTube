export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const zone = process.env.BUNNY_STORAGE_ZONE || 'pixeltube-videos';
  const key = process.env.BUNNY_ACCESS_KEY;

  try {
    const response = await fetch(`https://uk.storage.bunnycdn.com/${zone}/minis/`, {
      headers: { 'AccessKey': key, 'Accept': 'application/json' }
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch minis' });
  }
}