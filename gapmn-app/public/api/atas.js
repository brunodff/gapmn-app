// Vercel serverless — proxy CORS-free para ARPs do PNCP
// GET /api/atas?uasg=120630&ano=2026&pg=1
// GET /api/atas?uasg=120630&anos=2025,2026   (múltiplos anos)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { uasg, ano, anos, pg = '1' } = req.query;
  if (!uasg) return res.status(400).json({ error: 'missing param: uasg' });

  // Suporta múltiplos anos (anos=2025,2026) ou ano único
  const anoList = anos
    ? anos.split(',').map(s => s.trim()).filter(Boolean)
    : ano ? [ano] : [String(new Date().getFullYear())];

  const allResults = [];
  let lastStatus = 200;

  for (const a of anoList) {
    const url = `https://pncp.gov.br/api/consulta/v1/atas`
      + `?codigoUnidadeCompradora=${encodeURIComponent(uasg)}`
      + `&anoAta=${a}`
      + `&pagina=${pg}&tamanhoPagina=500`;
    try {
      const r = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'gapmn-app/1.0' },
        signal: AbortSignal.timeout(15000)
      });
      const text = await r.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }

      if (r.ok) {
        const items = Array.isArray(data) ? data
          : Array.isArray(data?.data) ? data.data
          : Array.isArray(data?.resultado) ? data.resultado
          : [];
        allResults.push(...items);
      } else {
        lastStatus = r.status;
      }
    } catch (e) {
      // timeout ou erro de rede — continua com próximo ano
      if (anoList.length === 1) return res.status(502).json({ error: String(e) });
    }
  }

  if (!allResults.length && lastStatus !== 200) {
    return res.status(lastStatus).json({ error: `PNCP retornou ${lastStatus}` });
  }

  return res.status(200).json(allResults);
}
