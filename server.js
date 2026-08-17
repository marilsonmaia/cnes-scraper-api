const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  return res.status(200).json({ status: 'online', message: 'API CNES Scraper ativa' });
});

app.post('/consultar-cnes', async (req, res) => {
  const { cnpj } = req.body;
  
  if (!cnpj) {
    return res.status(400).json({ error: 'CNPJ obrigatório' });
  }

  let browser;
  try {
    browser = await chromium.launch({ 
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080'
      ] 
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      locale: 'pt-BR',
      timezoneId: 'America/Sao_Paulo'
    });

    const page = await context.newPage();
    const cnpjLimpo = cnpj.replace(/\D/g, '');

    let apiDataFim = null;

    // Intercepta respostas da API interna em formato JSON
    page.on('response', async (response) => {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const json = await response.json().catch(() => null);
          if (json) {
            const str = JSON.stringify(json);
            // Procura por chaves comuns de data fim de mandato no JSON
            const matches = str.match(/"(?:dataFim|dtFim|dataFimMandato|fimMandato|dataTermino|dtTermino|dt_fim|data_fim)"\s*:\s*"([^"]+)"/i);
            if (matches && matches[1]) {
              const val = matches[1];
              if (val.includes('-')) {
                const parts = val.substring(0, 10).split('-');
                if (parts.length === 3) apiDataFim = `${parts[2]}/${parts[1]}/${parts[0]}`;
              } else if (val.match(/\d{2}\/\d{2}\/\d{4}/)) {
                apiDataFim = val.match(/\d{2}\/\d{2}\/\d{4}/)[0];
              }
            }
          }
        }
      } catch (e) {}
    });

    // 1. TENTA ACESSO DIRETO À TELA DE DETALHES
    const detalhesUrl = `https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade/detalhes/${cnpjLimpo}`;
    console.log(`Navegando para detalhes: ${detalhesUrl}`);
    await page.goto(detalhesUrl, { waitUntil: 'domcontentloaded', timeout: 35000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Se tiver redirecionado para a busca, faz o fluxo de formulário desbloqueado
    if (page.url().includes('/cadastro-entidade') && !page.url().includes('/detalhes/')) {
      console.log('Redirecionado para busca. Preenchendo formulário...');
      const inputCnpj = page.locator('input[placeholder*="CNPJ"], input[type="text"]').first();
      await inputCnpj.waitFor({ state: 'visible', timeout: 10000 });
      
      await inputCnpj.focus();
      await inputCnpj.fill('');
      // Digita caractere por caractere para acionar reatividade do Angular
      await inputCnpj.pressSequentially(cnpjLimpo, { delay: 50 });
      await inputCnpj.evaluate(el => el.blur());
      await page.waitForTimeout(1000);

      // Remove ativamente a desabilitação do botão
      await page.evaluate(() => {
        const btns = document.querySelectorAll('button');
        btns.forEach(b => {
          if (b.textContent.includes('Pesquisar') || b.type === 'submit') {
            b.removeAttribute('disabled');
            b.disabled = false;
          }
        });
      });

      const btnPesquisar = page.locator('button:has-text("Pesquisar"), button.br-button.primary, button[type="submit"]').first();
      await btnPesquisar.click({ force: true }).catch(async () => {
        await page.keyboard.press('Enter');
      });

      await page.waitForTimeout(4000);

      // Clica no resultado da tabela
      const linkTabela = page.locator('table tbody tr a, table tbody tr button, table tbody tr td').first();
      if (await linkTabela.isVisible({ timeout: 5000 })) {
        await linkTabela.click();
        await page.waitForTimeout(4000);
      }
    }

    // 2. CLICA NA ABA / SEÇÃO DIRIGENTES
    try {
      const elementosClique = await page.locator('button, a, .br-tab-item, div, span').all();
      for (const el of elementosClique) {
        const text = await el.innerText().catch(() => '');
        if (text && /dirigente|mandato|diretoria/i.test(text)) {
          if (await el.isVisible().catch(() => false)) {
            await el.click({ force: true }).catch(() => {});
            await page.waitForTimeout(1500);
          }
        }
      }
    } catch (e) {}

    await page.waitForTimeout(3000);

    // 3. EXTRAÇÃO DE DATA DA PÁGINA
    const extraidoDom = await page.evaluate(() => {
      const texto = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');

      // Padrão 1: "Data fim" seguida de data
      const m1 = texto.match(/Data\s*fim[\s\S]{0,50}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m1 && m1[1]) return m1[1];

      // Padrão 2: Mandato / Período
      const m2 = texto.match(/Mandato[\s\S]{0,200}?(\d{2}\/\d{2}\/\d{4})[\s\S]{0,50}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m2 && m2[2]) return m2[2];

      // Padrão 3: Qualquer intervalo "DD/MM/AAAA a DD/MM/AAAA"
      const m3 = texto.match(/(\d{2}\/\d{2}\/\d{4})[\s\S]{0,30}?(?:a|até|-|à)[\s\S]{0,30}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m3 && m3[2]) return m3[2];

      // Padrão 4: Procura todas as datas na página e pega a maior (futura)
      const todasDatas = texto.match(/(\d{2}\/\d{2}\/\d{4})/g);
      if (todasDatas && todasDatas.length > 0) {
        const futuras = todasDatas.filter(d => {
          const ano = parseInt(d.split('/')[2], 10);
          return ano >= 2024;
        });
        if (futuras.length > 0) return futuras[futuras.length - 1];
        return todasDatas[todasDatas.length - 1];
      }

      return null;
    });

    const dataFinal = apiDataFim || extraidoDom;
    const textoPagina = await page.evaluate(() => (document.body ? document.body.innerText : '').substring(0, 500));

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: dataFinal || 'Não encontrada',
      urlAtual: page.url(),
      snippetTexto: textoPagina,
      consultadoEm: new Date().toISOString()
    });

  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao consultar o CNES: ' + error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API CNES rodando na porta ${PORT}`);
});
