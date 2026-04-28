/**
 * SICAF Bot — Baixa Situação do Fornecedor no comprasnet.gov.br
 *
 * Não requer VPN — acessa a internet pública.
 *
 * Fluxo:
 *   1. Abre comprasnet SICAF
 *   2. Clica em "Governo" → redireciona para gov.br SSO
 *   3. Login com CPF + senha gov.br
 *   4. Pesquisa CNPJ no SICAF
 *   5. Clica em "Situação do Fornecedor"
 *   6. Baixa o PDF gerado
 *
 * Uso: node sicaf-bot.js <CPF> <SENHA> <CNPJ>
 */

const { chromium } = require("playwright");
const path = require("path");
const fs   = require("fs");

const OUTPUT_DIR = path.join(__dirname, "output");
const SICAF_URL  = "https://www3.comprasnet.gov.br/sicaf-web/index.jsf";

async function shot(page, nome) {
  try {
    await page.screenshot({ path: path.join(OUTPUT_DIR, `sicaf_${nome}.png`), fullPage: false });
  } catch (_) {}
}

// ── Formata CNPJ para exibição ────────────────────────────────────────────────
function fmtCnpj(cnpj) {
  const c = cnpj.replace(/\D/g, "");
  return c.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
}

// ── Tenta clicar em múltiplos seletores ──────────────────────────────────────
async function tryClick(page, ...selectors) {
  for (const sel of selectors) {
    try {
      await page.locator(sel).first().click({ timeout: 4000 });
      return true;
    } catch (_) {}
  }
  return false;
}

// ── Preenche campo de texto com fallback ─────────────────────────────────────
async function fillField(page, value, ...selectors) {
  for (const sel of selectors) {
    const el = await page.$(sel).catch(() => null);
    if (el) { await el.fill(value); return true; }
  }
  // Fallback: primeiro input visível
  const inputs = await page.$$("input[type='text']:visible, input:not([type='hidden']):not([type='submit']):not([type='button']):visible");
  if (inputs[0]) { await inputs[0].fill(value); return true; }
  return false;
}

// ── Executar Bot SICAF ────────────────────────────────────────────────────────
async function executarBotSicaf({ cpf, senha, cnpj, onStatus = console.log }) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: false,
    args: ["--ignore-certificate-errors", "--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    acceptDownloads: true,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  const cpfLimpo  = cpf.replace(/\D/g, "");
  const cnpjLimpo = cnpj.replace(/\D/g, "");

  try {
    // ── Passo 1: Abre SICAF ───────────────────────────────────────────────────
    onStatus("Acessando comprasnet SICAF...");
    await page.goto(SICAF_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    await shot(page, "01_inicio");
    onStatus(`URL inicial: ${page.url()}`);

    // ── Passo 2: Clica em "Governo" ───────────────────────────────────────────
    onStatus("Clicando em 'Governo'...");
    const clicouGoverno = await tryClick(page,
      "text=Governo",
      "a:has-text('Governo')",
      "button:has-text('Governo')",
      "li:has-text('Governo') a",
      "span:has-text('Governo')",
    );
    if (!clicouGoverno) {
      // Tenta link que contenha "gov" no href
      const links = await page.$$("a[href*='gov']");
      if (links[0]) await links[0].click();
    }
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);
    await shot(page, "02_governo");
    onStatus(`URL após Governo: ${page.url()}`);

    // ── Passo 3: Login gov.br ─────────────────────────────────────────────────
    onStatus("Preenchendo login gov.br...");

    // Aguarda campo de CPF ou redirect para SSO
    await page.waitForSelector(
      "input[name='cpf'], input[id*='cpf'], input[placeholder*='CPF'], input[autocomplete='username'], input[type='text']",
      { timeout: 15000 }
    ).catch(() => {});
    await shot(page, "03_login");
    onStatus(`URL login: ${page.url()}`);

    // Preenche CPF
    const cpfOk = await fillField(page, cpfLimpo,
      "input[name='cpf']", "input[id*='cpf']",
      "input[placeholder*='CPF']", "input[autocomplete='username']"
    );
    if (!cpfOk) throw new Error("Campo CPF não encontrado na página de login. Veja sicaf_03_login.png");
    onStatus(`CPF preenchido: ${cpfLimpo}`);

    // Clica Continuar
    await tryClick(page,
      "button:has-text('Continuar')",
      "button:has-text('Próximo')",
      "button[type='submit']",
      "input[type='submit']"
    );
    await page.waitForTimeout(2500);
    await shot(page, "04_apos_cpf");

    // Preenche senha
    await page.waitForSelector("input[type='password']", { timeout: 12000 }).catch(() => {});
    const senhaInput = await page.$("input[type='password']");
    if (!senhaInput) throw new Error("Campo senha não encontrado. CPF incorreto ou fluxo inesperado. Veja sicaf_04_apos_cpf.png");
    await senhaInput.fill(senha);
    onStatus("Senha preenchida.");

    // Clica Entrar
    await tryClick(page,
      "button:has-text('Entrar')",
      "button:has-text('Acessar')",
      "button[type='submit']",
      "input[type='submit']"
    );
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, "05_pos_login");
    onStatus(`URL pós-login: ${page.url()}`);

    // Verifica erro de login
    const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (
      bodyText.toLowerCase().includes("incorreto") ||
      bodyText.toLowerCase().includes("inválido") ||
      bodyText.toLowerCase().includes("invalid") ||
      bodyText.toLowerCase().includes("senha errada")
    ) {
      throw new Error("Login gov.br falhou. Verifique CPF e senha.");
    }
    onStatus("✅ Login realizado com sucesso.");

    // ── Passo 4: Navega de volta ao SICAF se necessário ───────────────────────
    if (!page.url().includes("sicaf") && !page.url().includes("comprasnet")) {
      onStatus("Retornando ao SICAF após login...");
      await page.goto(SICAF_URL, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForTimeout(2000);
    }
    await shot(page, "06_sicaf_logado");
    onStatus(`URL no SICAF: ${page.url()}`);

    // ── Passo 5: Pesquisa por CNPJ ────────────────────────────────────────────
    onStatus(`Pesquisando CNPJ: ${fmtCnpj(cnpjLimpo)}...`);

    // Aguarda campo CNPJ (ou menu de consulta)
    const temCNPJ = await page.waitForSelector(
      "input[name*='cnpj'], input[id*='cnpj'], input[placeholder*='CNPJ'], input[placeholder*='cnpj']",
      { timeout: 8000 }
    ).catch(() => null);

    if (!temCNPJ) {
      // Tenta navegar para a consulta via menu
      onStatus("Procurando menu de consulta...");
      await tryClick(page,
        "a:has-text('Consultar')", "text=Consultar",
        "a:has-text('Fornecedor')", "text=Fornecedor",
        "a:has-text('Pesquisar')"
      );
      await page.waitForTimeout(2000);
      await shot(page, "07_menu_consulta");
    }

    // Preenche CNPJ
    const cnpjOk = await fillField(page, cnpjLimpo,
      "input[name*='cnpj']", "input[id*='cnpj']",
      "input[placeholder*='CNPJ']", "input[placeholder*='cnpj']"
    );
    if (!cnpjOk) throw new Error("Campo CNPJ não encontrado. Veja sicaf_07_menu_consulta.png");
    onStatus("CNPJ preenchido.");

    // Pesquisa
    await tryClick(page,
      "button:has-text('Pesquisar')",
      "input[value='Pesquisar']",
      "button[type='submit']",
      "input[type='submit']"
    );
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(3000);
    await shot(page, "08_resultado");
    onStatus("Resultado da pesquisa carregado.");

    // Verifica se encontrou empresa
    const bodyRes = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    if (bodyRes.toLowerCase().includes("nenhum") || bodyRes.toLowerCase().includes("não encontrado")) {
      throw new Error(`CNPJ ${fmtCnpj(cnpjLimpo)} não encontrado no SICAF.`);
    }

    // ── Passo 6: Clica em "Situação do Fornecedor" ────────────────────────────
    onStatus("Clicando em 'Situação do Fornecedor'...");
    const clicouSituacao = await tryClick(page,
      "a:has-text('Situação do Fornecedor')",
      "button:has-text('Situação do Fornecedor')",
      "text=Situação do Fornecedor",
      "a:has-text('Situação')",
      "button:has-text('Situação')"
    );
    if (!clicouSituacao) throw new Error("Botão 'Situação do Fornecedor' não encontrado. Veja sicaf_08_resultado.png");
    await page.waitForTimeout(4000);
    await shot(page, "09_situacao");
    onStatus("Página Situação do Fornecedor carregada.");

    // ── Passo 7: Baixa PDF ────────────────────────────────────────────────────
    onStatus("Baixando PDF...");
    const nomeArq = `sicaf_${cnpjLimpo}_${Date.now()}.pdf`;
    const pdfPath = path.join(OUTPUT_DIR, nomeArq);

    // Tenta interceptar download de PDF
    let downloadHandle = null;
    try {
      [downloadHandle] = await Promise.all([
        page.waitForEvent("download", { timeout: 15000 }),
        tryClick(page,
          "button:has-text('PDF')", "a:has-text('PDF')",
          "button:has-text('Gerar PDF')", "a:has-text('Gerar PDF')",
          "button:has-text('Imprimir')", "a:has-text('Imprimir')",
          "button:has-text('Visualizar')", "a:has-text('Visualizar')"
        ),
      ]);
    } catch (_) {}

    if (downloadHandle) {
      await downloadHandle.saveAs(pdfPath);
      onStatus(`✅ PDF baixado: ${nomeArq}`);
      return { pdfFile: pdfPath, cnpj: fmtCnpj(cnpjLimpo) };
    }

    // Fallback: abre nova aba PDF se houver iframe
    const iframeSrc = await page.$eval("iframe", el => el.src).catch(() => null);
    if (iframeSrc && iframeSrc.includes("pdf")) {
      onStatus("Baixando PDF do iframe...");
      const pdfPage = await context.newPage();
      try {
        [downloadHandle] = await Promise.all([
          pdfPage.waitForEvent("download", { timeout: 20000 }),
          pdfPage.goto(iframeSrc),
        ]).catch(() => [null]);
        if (downloadHandle) {
          await downloadHandle.saveAs(pdfPath);
          onStatus(`✅ PDF baixado via iframe: ${nomeArq}`);
          return { pdfFile: pdfPath, cnpj: fmtCnpj(cnpjLimpo) };
        }
      } finally { await pdfPage.close(); }
    }

    // Último fallback: imprime página como PDF
    onStatus("Gerando PDF via impressão da página...");
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true });
    onStatus(`✅ PDF gerado: ${nomeArq}`);
    return { pdfFile: pdfPath, cnpj: fmtCnpj(cnpjLimpo) };

  } finally {
    await browser.close();
  }
}

module.exports = { executarBotSicaf };

if (require.main === module) {
  const cpf   = process.argv[2] || "";
  const senha = process.argv[3] || "";
  const cnpj  = process.argv[4] || "";
  if (!cpf || !senha || !cnpj) {
    console.error("\nUso: node sicaf-bot.js <CPF> <SENHA> <CNPJ>");
    process.exit(1);
  }
  executarBotSicaf({ cpf, senha, cnpj }).then(r => {
    console.log(`\n✅ PDF salvo em: ${r.pdfFile}`);
  }).catch(err => {
    console.error(`\n❌ Erro: ${err.message}`);
    process.exit(1);
  });
}
