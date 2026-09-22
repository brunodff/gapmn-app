// Vercel serverless — proxy CSV de aba de planilha pública Google Sheets
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { id, tab } = req.query;
  if (!id || !tab) return res.status(400).json({ error: 'Missing params: id, tab' });

  try {
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&sheet=${encodeURIComponent(tab)}`;
    const r = await fetch(url, { redirect: 'follow', headers: { accept: 'text/csv,*/*' } });
    if (!r.ok) return res.status(r.status).json({ error: `Upstream HTTP ${r.status}` });
    const text = await r.text();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    return res.status(200).send(text);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
