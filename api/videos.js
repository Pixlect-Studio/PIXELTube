export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const zone = process.env.BUNNY_STORAGE_ZONE;
  const key = process.env.BUNNY_ACCESS_KEY;
  try {
    const response = await fetch(`https://uk.storage.bunnycdn.com/${zone}/videos/`, {
      headers: { 'AccessKey': key, 'Accept': 'application/json' }
    });
    res.status(response.status).json(await response.json());
  } catch (error) { res.status(500).json({ error: 'Failed' }); }
}