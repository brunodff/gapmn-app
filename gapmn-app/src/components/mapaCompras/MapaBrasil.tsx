// Mapa do Brasil com um ponto por município (tamanho = número de compras). Estados pela malha do IBGE
// (assets/geo/uf.json) e centro aproximado de cada município (assets/geo/municipios.json), os mesmos do CCGP.
// Os arquivos entram como asset do Vite (?url): baixados só quando o mapa abre, em dev e em produção.
import { useEffect, useMemo, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import type { FeatureCollection, Geometry } from "geojson";
import urlUfs from "../../assets/geo/uf.json?url";
import urlCentros from "../../assets/geo/municipios.json?url";

export interface PontoMapa { codigoIbge: string; municipio: string; uf: string; quantidade: number; valor: number }
type Ufs = FeatureCollection<Geometry, { uf: string }>;
type Centros = Record<string, [number, number]>;

const L = 800, A = 780;
const COR = { estado: "rgba(255,255,255,0.04)", estadoCompra: "rgba(14,165,233,0.16)", borda: "rgba(148,163,184,0.35)", ponto: "#0ea5e9", ativo: "#7dd3fc", fundo: "#060e1f" };

let geoCarga: Promise<{ ufs: Ufs; centros: Centros }> | null = null;
function carregarGeo() {
  geoCarga ??= Promise.all([
    fetch(urlUfs).then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Ufs>; }),
    fetch(urlCentros).then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Centros>; }),
  ]).then(([ufs, centros]) => ({ ufs, centros }));
  geoCarga.catch(() => { geoCarga = null; });
  return geoCarga;
}

const fmtCurto = (v: number) => (v >= 1e6 ? `R$ ${(v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`
  : v >= 1e3 ? `R$ ${(v / 1e3).toLocaleString("pt-BR", { maximumFractionDigits: 0 })} mil` : v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }));

export default function MapaBrasil({ pontos, selecionado, aoSelecionar }: {
  pontos: PontoMapa[]; selecionado?: string | null; aoSelecionar?: (codigo: string | null) => void;
}) {
  const [geo, setGeo] = useState<{ ufs: Ufs; centros: Centros } | null>(null);
  const [erro, setErro] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [sobre, setSobre] = useState<{ p: PontoMapa; x: number; y: number } | null>(null);

  useEffect(() => {
    let vivo = true;
    carregarGeo().then((g) => { if (vivo) { setGeo(g); setErro(false); } }).catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [tentativa]);

  const proj = useMemo(() => {
    if (!geo) return null;
    const p = geoMercator().fitExtent([[10, 10], [L - 10, A - 10]], geo.ufs);
    return { p, caminho: geoPath(p) };
  }, [geo]);

  const marcas = useMemo(() => {
    if (!proj || !geo) return [];
    const max = Math.max(1, ...pontos.map((p) => p.quantidade));
    return pontos
      .map((p) => {
        const c = geo.centros[p.codigoIbge];
        const xy = c ? proj.p(c) : null;
        return xy ? { p, x: xy[0], y: xy[1], r: 4 + 18 * Math.sqrt(p.quantidade / max) } : null;
      })
      .filter((m): m is NonNullable<typeof m> => !!m)
      .sort((a, b) => b.r - a.r); // maiores embaixo, menores clicáveis por cima
  }, [proj, geo, pontos]);

  const ufsComCompra = useMemo(() => new Set(pontos.map((p) => p.uf)), [pontos]);

  if (erro) return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
      Não foi possível carregar o mapa. <button onClick={() => setTentativa((t) => t + 1)} className="underline">Tentar de novo</button>
    </div>
  );
  if (!proj || !geo) return <p className="py-10 text-center text-sm text-slate-500">Carregando o mapa…</p>;

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${L} ${A}`} className="h-auto w-full" role="img" aria-label="Mapa do Brasil com as compras por município">
        <g>
          {geo.ufs.features.map((f) => (
            <path key={f.properties.uf} d={proj.caminho(f) ?? ""} strokeWidth={1}
              fill={ufsComCompra.has(f.properties.uf) ? COR.estadoCompra : COR.estado} stroke={COR.borda} />
          ))}
        </g>
        <g>
          {marcas.map(({ p, x, y, r }) => {
            const ativo = selecionado === p.codigoIbge;
            return (
              <circle key={p.codigoIbge} cx={x} cy={y} r={r} strokeWidth={2} stroke={COR.fundo}
                fill={ativo ? COR.ativo : COR.ponto} fillOpacity={ativo ? 1 : 0.6} style={{ cursor: "pointer" }}
                onMouseEnter={() => setSobre({ p, x, y })} onMouseLeave={() => setSobre(null)}
                onClick={() => aoSelecionar?.(ativo ? null : p.codigoIbge)}>
                <title>{`${p.municipio}/${p.uf}: ${p.quantidade}`}</title>
              </circle>
            );
          })}
        </g>
      </svg>
      {sobre && (
        <div className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs shadow-lg"
          style={{ left: `${(sobre.x / L) * 100}%`, top: `${(sobre.y / A) * 100}%`, transform: "translate(-50%, calc(-100% - 14px))", background: "#0f1929", border: "1px solid #334155", color: "#eaf1fb" }}>
          <p style={{ fontWeight: 600 }}>{sobre.p.municipio}/{sobre.p.uf}</p>
          <p style={{ color: "#94a3b8" }}>{sobre.p.quantidade.toLocaleString("pt-BR")} {sobre.p.quantidade === 1 ? "compra" : "compras"}{sobre.p.valor > 0 ? ` · ${fmtCurto(sobre.p.valor)}` : ""}</p>
        </div>
      )}
    </div>
  );
}
