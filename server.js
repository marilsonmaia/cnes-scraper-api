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
    const cnpjMascara = cnpjLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

    let apiDataFim = null;

    // Intercepta respostas da API interna do Angular
    page.on('response', async (response) => {
      try {
        const url = response.url();
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const json = await response.json().catch(() => null);
          if (json) {
            const jsonStr = JSON.stringify(json);
            // Procura por chaves de data de fim de mandato no JSON retornado pela API
            const m = jsonStr.match(/"(?:dataFim|dtFim|dataFimMandato|fimMandato|dataTermino)"\s*:\s*"(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})"/i);
            if (m && m[1]) {
              if (m[1].includes('-')) {
                const parts = m[1].split('-');
                apiDataFim = `${parts[2]}/${parts[1]}/${parts[0]}`;
              } else {
                apiDataFim = m[1];
              }
            }
          }
        }
      } catch (e) {}
    });

    // 1. Acessa a página oficial de pesquisa
    const searchUrl = 'https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade';
    console.log(`Acessando busca: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // 2. Preenche o CNPJ
    console.log(`Preenchendo CNPJ: ${cnpjMascara}`);
    const inputCnpj = page.locator('input[placeholder*="CNPJ"], input[type="text"]').first();
    await inputCnpj.waitFor({ state: 'visible', timeout: 15000 });
    await inputCnpj.click();
    await inputCnpj.fill(cnpjMascara);
    await inputCnpj.dispatchEvent('input');
    await inputCnpj.dispatchEvent('change');
    await page.waitForTimeout(1000);

    // 3. Clica em Pesquisar
    console.log('Clicando em Pesquisar...');
    const btnPesquisar = page.locator('button:has-text("Pesquisar"), button.br-button.primary, button[type="submit"]').first();
    if (await btnPesquisar.isVisible()) {
      await btnPesquisar.click();
    } else {
      await page.keyboard.press('Enter');
    }

    await page.waitForTimeout(4000);

    // 4. Clica na tabela de resultados para navegar até os detalhes da entidade
    console.log('Procurando linha do resultado...');
    const linkTabela = page.locator('table tbody tr a, table tbody tr button, table tbody tr td').first();
    if (await linkTabela.isVisible({ timeout: 6000 })) {
      await linkTabela.click();
      console.log('Linha clicada! Aguardando página de detalhes...');
      await page.waitForTimeout(4000);
    } else {
      console.log('Navegando via URL direta como fallback...');
      await page.goto(`https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade/detalhes/${cnpjLimpo}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(4000);
    }

    // 5. Clica na seção / aba "Dirigentes"
    try {
      const btnDirigentes = page.locator('text=/Dirigentes/i').last();
      if (await btnDirigentes.isVisible({ timeout: 4000 })) {
        await btnDirigentes.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    } catch (e) {}

    await page.waitForTimeout(2000);

    // 6. Varredura no texto renderizado da página
    const textoPagina = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

    let dataFim = apiDataFim;

    if (!dataFim) {
      // Procura "Data fim" seguida de data DD/MM/AAAA
      const m1 = textoPagina.match(/Data\s*fim[\s\S]{0,40}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m1 && m1[1]) dataFim = m1[1];
    }

    if (!dataFim) {
      // Procura bloco de Mandato
      const m2 = textoPagina.match(/Mandato[\s\S]{0,200}?(\d{2}\/\d{2}\/\d{4})[\s\S]{0,40}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m2 && m2[2]) dataFim = m2[2];
    }

    if (!dataFim) {
      // Busca todas as datas na página após a palavra Dirigentes ou Mandato
      const idxMandato = textoPagina.search(/Mandato|Dirigentes/i);
      if (idxMandato !== -1) {
        const trecho = textoPagina.substring(idxMandato);
        const datas = trecho.match(/(\d{2}\/\d{2}\/\d{4})/g);
        if (datas && datas.length >= 2) {
          dataFim = datas[1]; // Segunda data costuma ser a Data Fim
        } else if (datas && datas.length === 1) {
          dataFim = datas[0];
        }
      }
    }

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: dataFim || 'Não encontrada',
      urlAtual: page.url(),
      snippetTexto: textoPagina.substring(0, 300),
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
