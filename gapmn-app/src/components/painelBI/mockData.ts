// ─── Mock Data — Painel BI GAP-MN ────────────────────────────────────────────
// Baseado nos dados reais visíveis nas capturas do Power BI

export const medidas = {
  Credito_Recebido: 25_710_000,
  Empenhado:        15_290_000,
  Pct_Empenhado:    0.5945,
  a_liquidar:       13_720_000,
  a_pagar:            390_264,
  atualizado_em:    "03/03/2026",
};

export const calendario = [
  { mes: "jan", Credito_Recebido: 6_260_000 },
  { mes: "fev", Credito_Recebido: 15_920_000 },
  { mes: "mar", Credito_Recebido: 3_540_000 },
];

export const unidades = [
  { Sigla_OM: "DACTA IV", _3: "20YJ", _5: "339030", a_liquidar: 7_710_410, a_pagar: 249_367, Disp: 1_757_726, Disp_neg: -350_032 },
  { Sigla_OM: "HAMN",     _3: "20YJ", _5: "339036", a_liquidar: 2_726_425, a_pagar: 117_605, Disp: 2_498_052, Disp_neg: -770_689 },
  { Sigla_OM: "GAP-MN",  _3: "20YJ", _5: "339039", a_liquidar: 2_149_757, a_pagar:  21_292, Disp: 1_857_502, Disp_neg:  -61_693 },
  { Sigla_OM: "BAMN",     _3: "20YJ", _5: "339047", a_liquidar: 1_057_806, a_pagar:       0, Disp: 1_091_588, Disp_neg: -630_000 },
  { Sigla_OM: "PAMN",     _3: "20YJ", _5: "339030", a_liquidar:    33_129, a_pagar:       0, Disp:   957_262, Disp_neg:        0 },
  { Sigla_OM: "COMAR VII",_3: "20YJ", _5: "339030", a_liquidar:     2_250, a_pagar:       0, Disp:   109_367, Disp_neg:        0 },
  { Sigla_OM: "SERIPA-MN",_3: "20YJ", _5: "339039", a_liquidar:         0, a_pagar:       0, Disp:   365_006, Disp_neg:        0 },
];

export const scrollerUnidades = [
  { Sigla_OM: "DACTA IV",  Credito: 11_283_463 },
  { Sigla_OM: "HAMN",      Credito:  5_703_705 },
  { Sigla_OM: "GAP-MN",   Credito:  4_757_382 },
  { Sigla_OM: "BAMN",      Credito:  2_100_000 },
  { Sigla_OM: "PAMN",      Credito:    957_000 },
  { Sigla_OM: "SERIPA-MN", Credito:    365_000 },
  { Sigla_OM: "COMAR VII", Credito:    109_000 },
];

export const medidasSEO = {
  total_solicitacoes: 246,
  pct_atendidas:      0.6667,
  atendidas:          164,
  nao_atendidas:       82,
};

export const controleEmpenhos = [
  { solicitacao: "25M0533", subprocesso: "140731", siafi: "2023NE001355", siloms: "23E1263", data: "04/12/2025", ugcred: "GAP MN – 120630", valor: -125.40,    dias: 90 },
  { solicitacao: "26M0001", subprocesso: "143888", siafi: "2025NE002310", siloms: "25E2112", data: "06/01/2026", ugcred: "GAP-MN",           valor: -100_832.00, dias: 36 },
  { solicitacao: "26M0003", subprocesso: "143711", siafi: "2025NE000318", siloms: "25E0281", data: "06/01/2026", ugcred: "DACTA IV",          valor: -4_961.34,   dias: 27 },
  { solicitacao: "26M0004", subprocesso: "143712", siafi: "2025NE000030", siloms: "25E0022", data: "07/01/2026", ugcred: "DACTA IV",          valor: -4_672.80,   dias: 23 },
  { solicitacao: "26M0002", subprocesso: "143817", siafi: "2025NE002309", siloms: "25E2109", data: "07/01/2026", ugcred: "GAP-MN",            valor:  76_190.64,  dias: 23 },
  { solicitacao: "26M0005", subprocesso: "143865", siafi: "2024NE002103", siloms: "24E1956", data: "08/01/2026", ugcred: "HAMN",              valor:    -960.00,  dias: 21 },
  { solicitacao: "26M0007", subprocesso: "26517",  siafi: "2024NE000846", siloms: "24E0764", data: "08/01/2026", ugcred: "HAMN",              valor:  -6_080.00,  dias: 19 },
  { solicitacao: "26S0084", subprocesso: "143963", siafi: "2025NE000591", siloms: "25E0539", data: "14/01/2026", ugcred: "DACTA IV",          valor:    -316.42,  dias: 19 },
  { solicitacao: "26S0086", subprocesso: "143965", siafi: "2025NE000581", siloms: "25E0529", data: "14/01/2026", ugcred: "DACTA IV",          valor:    -279.06,  dias: 19 },
  { solicitacao: "26M0010", subprocesso: "143956", siafi: "2024NE001598", siloms: "24E1456", data: "16/01/2026", ugcred: "GAP-MN",            valor:  -3_053.36,  dias: 19 },
  { solicitacao: "26S0003", subprocesso: "143936", siafi: "2026NE000003", siloms: "26E0004", data: "16/01/2026", ugcred: "GAP-MN",            valor:  10_000.00,  dias: 13 },
  { solicitacao: "26S0004", subprocesso: "143967", siafi: "2026NE000004", siloms: "26E0003", data: "16/01/2026", ugcred: "GAP-MN",            valor:   4_200.84,  dias: 13 },
  { solicitacao: "26M0011", subprocesso: "143711", siafi: "2025NE000318", siloms: "25E0281", data: "20/01/2026", ugcred: "DACTA IV",          valor:   2_077.32,  dias: 13 },
  { solicitacao: "26M0012", subprocesso: "144068", siafi: "2025NE000030", siloms: "25E0022", data: "20/01/2026", ugcred: "DACTA IV",          valor:  -4_672.80,  dias: 12 },
  { solicitacao: "26S0005", subprocesso: "144332", siafi: "2026NE000021", siloms: "26E0021", data: "22/01/2026", ugcred: "GAP-MN",            valor:   3_287.53,  dias: 12 },
  { solicitacao: "26M0013", subprocesso: "26519",  siafi: "2025NE001179", siloms: "25E1046", data: "23/01/2026", ugcred: "HAMN",              valor:   4_681.20,  dias: 12 },
];

export const rpGapmn = [
  { Sigla_OM: "DACTA IV",   RP_NAO_PROC_REINSC: 1_156_490, RP_PROC_CANC:       0, RP_NAO_PROC_CANC:   7_346, RP_PROC_INSC: 3_132_307, RP_NAO_PROC_INSC:  9_389_874, RP_Total_Inscritos: 12_522_180 },
  { Sigla_OM: "GAP-MN",    RP_NAO_PROC_REINSC:    81_675, RP_PROC_CANC:   3_054, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:   837_889, RP_NAO_PROC_INSC:  7_171_222, RP_Total_Inscritos:  8_009_111 },
  { Sigla_OM: "HAMN",       RP_NAO_PROC_REINSC:    43_019, RP_PROC_CANC:  21_893, RP_NAO_PROC_CANC:       0, RP_PROC_INSC: 2_554_803, RP_NAO_PROC_INSC:  1_813_280, RP_Total_Inscritos:  4_368_083 },
  { Sigla_OM: "BAMN",       RP_NAO_PROC_REINSC:         0, RP_PROC_CANC:       0, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:   408_280, RP_NAO_PROC_INSC:  1_840_685, RP_Total_Inscritos:  2_248_964 },
  { Sigla_OM: "PAMN",       RP_NAO_PROC_REINSC:         0, RP_PROC_CANC:       0, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:   268_557, RP_NAO_PROC_INSC:  1_356_808, RP_Total_Inscritos:  1_625_365 },
  { Sigla_OM: "COMARA",     RP_NAO_PROC_REINSC:         0, RP_PROC_CANC:       0, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:    53_894, RP_NAO_PROC_INSC:    299_254, RP_Total_Inscritos:    353_148 },
  { Sigla_OM: "SERIPA-MN",  RP_NAO_PROC_REINSC:         0, RP_PROC_CANC:     601, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:    18_229, RP_NAO_PROC_INSC:     29_396, RP_Total_Inscritos:     47_624 },
  { Sigla_OM: "COMAR VII",  RP_NAO_PROC_REINSC:         0, RP_PROC_CANC:       0, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:     2_718, RP_NAO_PROC_INSC:      5_653, RP_Total_Inscritos:      8_371 },
  { Sigla_OM: "SERINFRA",   RP_NAO_PROC_REINSC:     6_420, RP_PROC_CANC:       0, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:       475, RP_NAO_PROC_INSC:      2_188, RP_Total_Inscritos:      2_663 },
  { Sigla_OM: "SEREP-MN",   RP_NAO_PROC_REINSC:         0, RP_PROC_CANC:       0, RP_NAO_PROC_CANC:       0, RP_PROC_INSC:    81_789, RP_NAO_PROC_INSC:     17_113, RP_Total_Inscritos:     98_902 },
];

export const rpTotais = {
  RP_Total_Inscritos: 29_930_000,
  LIQUIDADO:           4_210_000,
  RP_Total_Pago:       9_690_000,
};

// Imagens das OMs (ibb.co links do Power BI)
export const omImages: Record<string, string> = {
  "GAP-MN":    "https://i.ibb.co/whFshhQY/GAP-MN.png",
  "COMAR VII": "https://i.ibb.co/s93BPTR4/COMAR.png",
  "DACTA IV":  "https://i.ibb.co/TMYqBKYv/cindacta.png",
  "COMARA":    "https://i.ibb.co/TMhHpgbV/COMARA.png",
  "BAMN":      "https://i.ibb.co/nNGJf7ms/bamn2.png",
  "SERINFRA-MN":"https://i.ibb.co/svMZmmg7/SERINFRA.png",
  "SEREP-MN":  "https://i.ibb.co/YFFrtMyq/SEREP.png",
  "HAMN":      "https://i.ibb.co/rfmGTDGP/HAMN.png",
  "PAMN":      "https://i.ibb.co/ym8CkHFP/PAMN.png",
  "SERIPA-MN": "https://i.ibb.co/VcrdZSYS/SERIPA.png",
};
