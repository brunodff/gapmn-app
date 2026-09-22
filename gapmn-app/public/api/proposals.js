export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { cnpj, ano, seq, item } = req.query;
  if (!cnpj || !ano || !seq || !item) {
    return res.status(400).json({ error: 'missing params: cnpj, ano, seq, item' });
  }

  const cnpjClean = String(cnpj).replace(/\D/g, '');
  const url = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpjClean}/compras/${ano}/${seq}/itens/${item}/propostas?pagina=1&tamanhoPagina=500`;

  try {
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'processoscae/1.0' }
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch(e) { data = { raw: text }; }
    res.status(r.ok ? 200 : r.status).json(data);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
}
