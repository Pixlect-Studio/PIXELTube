// api/ads.js
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const zone = process.env.BUNNY_STORAGE_ZONE || 'pixeltube-videos';
  const key = process.env.BUNNY_ACCESS_KEY;
  const url = `https://uk.storage.bunnycdn.com/${zone}/Statistics/ads.json`;

  try {
    if (req.method === 'GET') {
      const response = await fetch(url, { headers: { 'AccessKey': key } });
      if (response.status === 404) return res.status(200).json({ ads: [] });
      const data = await response.json();
      return res.status(200).json(data);
    } 
    
    if (req.method === 'PUT') {
      const response = await fetch(url, {
        method: 'PUT',
        headers: { 'AccessKey': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body)
      });
      return res.status(response.status).json({ success: response.ok });
    }
  } catch (error) {
    res.status(500).json({ error: 'Ads API Error' });
  }
}