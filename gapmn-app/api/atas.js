// Vercel serverless — ARPs relacionadas à UASG 120630 via PNCP search API
// Executa múltiplas buscas em paralelo (GAP-MN + HAMAN + outras unidades COMAER)
// GET /api/atas?uasg=120630
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { uasg = '120630' } = req.query;

  const CFG = {
    '120630': {
      issuer_codigo: '120630',
      cnpj_prefix: '00394429',   // todas as unidades COMAER
      queries: [
        'grupamento apoio manaus',   // ~20 ATAs — compras próprias da GAP-MN
        'base aerea manaus',         // ATAs registradas como "Base Aérea de Manaus" (mesmo UASG)
        'hamn',                      // ~131 ATAs — compras para o Hospital de Aeronáutica de Manaus
      ]
    }
  };
  const cfg = CFG[uasg];
  if (!cfg) return res.status(400).json({ error: `UASG ${uasg} não configurada` });

  // PNCP search API always returns 10 items/page regardless of tamanhoPagina
  const ITEMS_PER_PAGE = 10;
  const MAX_PAGES = 100; // cap 1000 items per query

  async function fetchPage(q, pg) {
    const url = `https://pncp.gov.br/api/search`
      + `?tipos_documento=ata&status=todos`
      + `&q=${encodeURIComponent(q)}`
      + `&pagina=${pg}&tamanhoPagina=${ITEMS_PER_PAGE}`;
    const r = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'gapmn-app/1.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!r.ok) throw new Error(`PNCP ${r.status} para "${q}"`);
    return r.json();
  }

  async function fetchAllPages(q) {
    try {
      const first = await fetchPage(q, 1);
      const total = first.total || 0;
      const pages = Math.min(Math.ceil(total / ITEMS_PER_PAGE), MAX_PAGES);
      const all = [...(first.items || [])];
      if (pages > 1) {
        const rest = await Promise.all(
          Array.from({ length: pages - 1 }, (_, i) => fetchPage(q, i + 2))
        );
        for (const d of rest) all.push(...(d.items || []));
      }
      return all;
    } catch {
      return [];   // ignora erro de uma busca, continua com as outras
    }
  }

  try {
    // Todas as buscas em paralelo
    const results = await Promise.all(cfg.queries.map(q => fetchAllPages(q)));
    const allItems = results.flat();

    // Deduplica por id do item
    const seen = new Set();
    const unique = allItems.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    // Filtra apenas ATAs da Aeronáutica (prefixo CNPJ COMAER = 00394429)
    const items = unique
      .filter(item => (item.orgao_cnpj || '').startsWith(cfg.cnpj_prefix))
      .map(item => ({
        pncp_id:         (item.item_url || '').replace('/atas/', ''),
        numero_ata:      (item.title || '').replace(/^Ata\s+n[ºo°]\s*/i, '').trim() || null,
        sequencial_ata:  parseInt(item.numero_sequencial, 10) || null,
        ano_ata:         parseInt(item.ano, 10) || null,
        uasg,
        cnpj_orgao:      item.orgao_cnpj || null,
        objeto:          (item.description || '').slice(0, 500) || null,
        valor_total:     item.valor_global || null,
        data_assinatura: (item.data_assinatura || '').slice(0, 10) || null,
        vigencia_inicio: (item.data_inicio_vigencia || '').slice(0, 10) || null,
        vigencia_fim:    (item.data_fim_vigencia || '').slice(0, 10) || null,
        situacao:        item.situacao_nome || null,
        fornecedor_cnpj: null,
        fornecedor_nome: null,
        numero_processo: item.numero_controle_pncp || null,
        unidade_nome:    item.unidade_nome || null,
        orgao_nome:      item.orgao_nome || null,
        cancelado:       item.cancelado || false,
        permite_adesao:  item.permite_adesao ?? null,
        is_issuer:       item.unidade_codigo === cfg.issuer_codigo,
      }));

    res.setHeader('X-Pncp-Total', String(unique.length));
    res.setHeader('X-Pncp-Filtered', String(items.length));
    return res.status(200).json(items);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
