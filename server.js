const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).json({ status: 'online', message: 'API CNES Scraper ativa' });
});

app.post('/consultar-cnes', async (req, res) => {
  const { cnpj } = req.body;
  if (!cnpj) return res.status(400).json({ error: 'CNPJ obrigatório' });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    let payloadApi = null;

    // Intercepta todas as respostas da API do governo em segundo plano
    page.on('response', async (response) => {
      try {
        const url = response.url();
        if (url.includes('cnes-backend') || url.includes('entidades')) {
          const contentType = response.headers()['content-type'] || '';
          if (contentType.includes('application/json')) {
            const json = await response.json().catch(() => null);
            if (json) payloadApi = json;
          }
        }
      } catch (e) {}
    });

    // 1. Acesso ao Portal
    await page.goto('https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade', {
      waitUntil: 'networkidle',
      timeout: 45000
    });

    // 2. Preenchimento do Campo CNPJ
    const campoCnpj = page.locator('input[type="text"]').first();
    await campoCnpj.waitFor({ state: 'visible', timeout: 15000 });
    await campoCnpj.click();
    await campoCnpj.fill(cnpjLimpo);

    // Dispara eventos do Angular
    await campoCnpj.dispatchEvent('input');
    await campoCnpj.dispatchEvent('change');
    await campoCnpj.dispatchEvent('blur');
    await page.waitForTimeout(1000);

    // Habilita botões desativados
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        b.removeAttribute('disabled');
        b.disabled = false;
      });
    });

    // 3. Submissão do Formulário
    const btnPesquisar = page.locator('button:has-text("Pesquisar"), button.br-button.primary, button[type="submit"]').first();
    await btnPesquisar.click({ force: true });
    await page.waitForTimeout(4000);

    // 4. Clique na Linha de Resultado ou Botão Detalhar
    const linkDetalhes = page.locator('table tbody tr td, table tbody tr a, .br-item, button:has-text("Visualizar")').first();
    if (await linkDetalhes.isVisible({ timeout: 10000 }).catch(() => false)) {
      await linkDetalhes.click({ force: true });
      await page.waitForTimeout(4000);
    }

    // 5. Varredura do DOM
    const textoPagina = await page.evaluate(() => document.body ? document.body.innerText : '');

    // Busca de data por expressão regular no texto visível
    let dataFim = null;
    const padraoMandato = /(?:Data\s*fim|Mandato|Validade|Término|Fim)[\s\S]{0,80}?(\d{2}\/\d{2}\/\d{4})/i;
    const match = textoPagina.match(padraoMandato);

    if (match && match[1]) {
      dataFim = match[1];
    } else {
      // Procura qualquer data formato DD/MM/AAAA no texto capturado
      const datasEncontradas = textoPagina.match(/\d{2}\/\d{2}\/\d{4}/g);
      if (datasEncontradas && datasEncontradas.length > 0) {
        dataFim = datasEncontradas[datasEncontradas.length - 1];
      }
    }

    // Procura em JSONs interceptados
    if (!dataFim && payloadApi) {
      const jsonStr = JSON.stringify(payloadApi);
      const matchJson = jsonStr.match(/"(?:dataFim|dtFim|dataFimMandato|fimMandato|dataTermino)"\s*:\s*"([^"]+)"/i);
      if (matchJson && matchJson[1]) {
        dataFim = matchJson[1];
      }
    }

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: dataFim || "Não encontrada",
      tamanhoTextoCapturado: textoPagina.length
    });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor ativo na porta ${PORT}`));
