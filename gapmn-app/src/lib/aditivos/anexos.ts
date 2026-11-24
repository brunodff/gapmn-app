// PDFs anexados na tela do aditivo (SICAF, consolidada, certidões, item 13 e item 14): ficam só na memória da aba
// e vão juntos no .zip (não são guardados no site).
export interface Arquivo { nome: string; bytes: ArrayBuffer }
export interface AnexosConsultas {
  sicaf: Arquivo[];
  consolidada: Arquivo | null;
  complementos: Record<string, Arquivo>;
  item13: Arquivo | null;
  socio: Arquivo[];
}
export const anexosVazios = (): AnexosConsultas => ({ sicaf: [], consolidada: null, complementos: {}, item13: null, socio: [] });
