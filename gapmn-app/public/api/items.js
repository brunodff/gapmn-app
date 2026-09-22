export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { cnpj, ano, seq, pg = '1', size = '500' } = req.query;
  if (!cnpj || !ano || !seq) {
    return res.status(400).json({ error: 'missing params: cnpj, ano, seq' });
  }

  const cnpjClean = String(cnpj).replace(/\D/g, '');
  const url = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpjClean}/compras/${ano}/${seq}/itens?pagina=${pg}&tamanhoPagina=${size}`;

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
