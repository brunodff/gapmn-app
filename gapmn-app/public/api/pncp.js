// Vercel serverless function — proxy CORS-free para dadosabertos.compras.gov.br
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { uasg, ano, mod, pg } = req.query;
  if (!uasg || !ano || !mod || !pg) {
    return res.status(400).json({ error: 'Missing params: uasg, ano, mod, pg' });
  }

  const base = 'https://dadosabertos.compras.gov.br/modulo-contratacoes/1_consultarContratacoes_PNCP_14133';
  const qs   = `unidadeOrgaoCodigoUnidade=${uasg}`
             + `&dataPublicacaoPncpInicial=${ano}-01-01`
             + `&dataPublicacaoPncpFinal=${ano}-12-31`
             + `&codigoModalidade=${mod}`
             + `&pagina=${pg}&tamanhoPagina=500`;

  try {
    const r = await fetch(`${base}?${qs}`, { headers: { accept: 'application/json' } });
    if (!r.ok) return res.status(r.status).json({ error: `Upstream HTTP ${r.status}` });
    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
