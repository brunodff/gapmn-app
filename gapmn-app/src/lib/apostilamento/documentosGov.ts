// Documentos oficiais do contrato lidos sozinhos: o PDF do contrato (aba "Arquivos" do Contratos.gov.br) e o
// Termo de Referência da compra no PNCP (às vezes dentro do pacote do edital: zip com um .tar.gz dentro).
// Aqui só a parte sem rede: achar o TR no pacote e passar o que os PDFs trouxeram para o cadastro, sem apagar
// o que já foi preenchido.
import { gunzipSync, unzipSync } from "fflate";
import type { AchadosPdf } from "./lerPdfs.ts";
import type { DadosReajuste } from "./tipos.ts";

export interface ArquivoLido { nome: string; bytes: Uint8Array }

const ehPdf = (b: Uint8Array) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; // %PDF
const ehZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b;
const ehGzip = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;
const nomeDeTr = (n: string) => /termo\s*de\s*refer|(^|[\s_\-/])TR([\s_\-.]|$)|projeto\s*b[áa]sico/i.test(n);

/** Arquivos de um .tar (ustar/pax): nome e conteúdo */
export function lerTar(b: Uint8Array): ArquivoLido[] {
  const saida: ArquivoLido[] = [];
  const dec = new TextDecoder("utf-8");
  let i = 0, nomePax: string | null = null;
  while (i + 512 <= b.length) {
    const cab = b.subarray(i, i + 512);
    if (cab.every((x) => x === 0)) break;
    const nome = dec.decode(cab.subarray(0, 100)).replace(/\0.*$/s, "");
    const tamanho = parseInt(dec.decode(cab.subarray(124, 136)).replace(/\0.*$/s, "").trim() || "0", 8);
    const tipo = String.fromCharCode(cab[156] || 48);
    const dados = b.subarray(i + 512, i + 512 + tamanho);
    if (tipo === "x") nomePax = /\d+ path=([^\n]+)\n/.exec(dec.decode(dados))?.[1] ?? null;
    else if (tipo === "0" || tipo === "\0") { saida.push({ nome: nomePax ?? nome, bytes: dados }); nomePax = null; }
    i += 512 + Math.ceil(tamanho / 512) * 512;
  }
  return saida;
}

/** Abre o pacote (zip, gz, tar, aninhados) e devolve o PDF do Termo de Referência, se houver */
export function acharTrNoPacote(arq: ArquivoLido, profundidade = 0): ArquivoLido | null {
  const b = arq.bytes;
  if (ehPdf(b)) return nomeDeTr(arq.nome) || profundidade === 0 ? arq : null;
  if (profundidade > 3) return null;
  let membros: ArquivoLido[] = [];
  try {
    if (ehZip(b)) membros = Object.entries(unzipSync(b)).map(([nome, bytes]) => ({ nome, bytes }));
    else if (ehGzip(b)) membros = [{ nome: arq.nome.replace(/\.(gz|tgz|zip)$/i, ".tar"), bytes: gunzipSync(b) }];
    else if (b.length > 512 && new TextDecoder().decode(b.subarray(257, 262)) === "ustar") membros = lerTar(b);
  } catch { return null; }
  const pdfs = membros.filter((m) => ehPdf(m.bytes) && nomeDeTr(m.nome));
  if (pdfs.length) return pdfs[0];
  for (const m of membros) {
    if (ehPdf(m.bytes)) continue;
    const dentro = acharTrNoPacote(m, profundidade + 1);
    if (dentro && nomeDeTr(dentro.nome)) return dentro;
  }
  return null;
}

export interface Preenchido { campo: string; rotulo: string; valor: string; origem: string; trecho: string }

const vazio = (v: unknown) => v == null || String(v).trim() === "";
const mesma = (a: string, b: string) => a.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim()
  === b.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Leva para o cadastro o que o contrato (e, na falta, o TR) trouxe, só nos campos vazios.
 *  A data do orçamento prefere a do contrato (a cláusula de reajuste manda); o TR completa. */
export function aplicarAchados(d: DadosReajuste, contrato: AchadosPdf | null, tr: AchadosPdf | null,
  op: { ugApoioNome?: string; siglasPadrao?: (string | null | undefined)[]; origemContrato?: string; origemTr?: string } = {}): { dados: DadosReajuste; preenchidos: Preenchido[] } {
  const x: DadosReajuste = structuredClone(d);
  const feitos: Preenchido[] = [];
  const oc = op.origemContrato ?? "contrato", ot = op.origemTr ?? "termo de referência";
  const anota = (campo: string, rotulo: string, valor: string, origem: string, trecho: string) => feitos.push({ campo, rotulo, valor, origem, trecho });
  const dos = <K extends keyof AchadosPdf>(k: K) => (contrato?.[k] ? { a: contrato[k]!, o: oc } : tr?.[k] ? { a: tr[k]!, o: ot } : null);

  const ind = dos("indice");
  if (ind && vazio(x.indice?.nome)) { x.indice = { ...x.indice, nome: ind.a.valor as string }; anota("indice.nome", "Índice", x.indice.nome, ind.o, ind.a.trecho); }
  const cl = dos("clausula");
  if (cl && vazio(x.indice?.clausula)) { x.indice = { ...x.indice, clausula: cl.a.valor as string }; anota("indice.clausula", "Cláusula do reajuste", x.indice.clausula, cl.o, cl.a.trecho); }
  const db = dos("dataBase");
  if (db && vazio(x.data_base)) { x.data_base = db.a.valor as string; anota("data_base", "Data do orçamento", x.data_base, db.o, db.a.trecho); }

  if (contrato?.representante && vazio(x.empresa?.representante) && !x.empresa?.representantes?.length) {
    x.empresa = { ...x.empresa, representante: contrato.representante.valor.nome, representante_feminino: contrato.representante.valor.feminino };
    anota("empresa.representante", "Representante da empresa", contrato.representante.valor.nome, oc, contrato.representante.trecho);
  }
  if (contrato?.endereco && vazio(x.empresa?.endereco)) {
    x.empresa = { ...x.empresa, endereco: contrato.endereco.valor };
    anota("empresa.endereco", "Endereço da empresa", contrato.endereco.valor, oc, contrato.endereco.trecho);
  }
  if (contrato?.contratante && vazio(x.contratante_paragrafo)) {
    x.contratante_paragrafo = contrato.contratante.valor;
    anota("contratante_paragrafo", "I – CONTRATANTE (do contrato inicial)", contrato.contratante.valor, oc, contrato.contratante.trecho);
  }
  if (contrato?.contratada && vazio(x.contratada_paragrafo)) {
    x.contratada_paragrafo = contrato.contratada.valor;
    anota("contratada_paragrafo", "II – CONTRATADA (do contrato inicial)", contrato.contratada.valor, oc, contrato.contratada.trecho);
  }
  const om = contrato?.omContratante;
  if (om) {
    if (vazio(x.om_contratante_nome)) { x.om_contratante_nome = om.valor; anota("om_contratante_nome", "OM contratante", om.valor, oc, om.trecho); }
    // cabeçalho do termo: a OM do contrato, quando não é a própria unidade de apoio (essa já é o padrão)
    const outraOm = !(op.ugApoioNome && mesma(op.ugApoioNome, om.valor));
    if (vazio(x.termo_om_nome) && outraOm) {
      x.termo_om_nome = om.valor; anota("termo_om_nome", "Cabeçalho do termo", om.valor, oc, om.trecho);
    }
    // sigla: a do contrato no lugar da só sugerida (a da unidade de apoio ou a da UG no Contratos.gov.br)
    const sg = contrato?.omSigla;
    const soSugerida = vazio(x.om_contratante_sigla) || (op.siglasPadrao ?? []).some((s) => !!s && mesma(s, x.om_contratante_sigla));
    if (sg && outraOm && soSugerida) {
      x.om_contratante_sigla = sg.valor; anota("om_contratante_sigla", "Sigla da OM contratante", sg.valor, oc, sg.trecho);
    }
  }
  return { dados: x, preenchidos: feitos };
}
