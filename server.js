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
        '--disable-gpu',
        '--window-size=1920,1080'
      ] 
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });

    const page = await context.newPage();
    const cnpjLimpo = cnpj.replace(/\D/g, '');

    const jsonInterceptados = [];

    // Intercepta e armazena todas as respostas JSON do backend do governo
    page.on('response', async (response) => {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('application/json')) {
          const json = await response.json().catch(() => null);
          if (json) {
            jsonInterceptados.push({ url: response.url(), body: json });
          }
        }
      } catch (e) {}
    });

    // 1. CARREGA A PÁGINA INICIAL DE BUSCA
    console.log('Navegando para o portal CNES...');
    await page.goto('https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade', {
      waitUntil: 'networkidle',
      timeout: 45000
    });

    // 2. PREENCHIMENTO REATIVO PARA ANGULAR
    const inputCnpj = page.locator('input[placeholder*="CNPJ"], input[type="text"]').first();
    await inputCnpj.waitFor({ state: 'visible', timeout: 15000 });
    await inputCnpj.click();
    await inputCnpj.fill(cnpjLimpo);
    
    // Força disparo de eventos Angular para ativar o botão
    await inputCnpj.dispatchEvent('input');
    await inputCnpj.dispatchEvent('change');
    await inputCnpj.dispatchEvent('blur');
    await page.waitForTimeout(1000);

    // Remove qualquer trava de 'disabled' no botão
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach(b => {
        b.removeAttribute('disabled');
        b.disabled = false;
      });
    });

    // 3. CLIQUE NO BOTÃO PESQUISAR
    const btnPesquisar = page.locator('button:has-text("Pesquisar"), button.br-button.primary, button[type="submit"]').first();
    await btnPesquisar.click({ force: true });
    await page.waitForTimeout(3000);

    // 4. CLIQUE NO RESULTADO ENCONTRADO
    const itemTabela = page.locator('table tbody tr a, table tbody tr td, .br-item').first();
    if (await itemTabela.isVisible({ timeout: 10000 })) {
      await itemTabela.click();
      await page.waitForTimeout(4000);
    }

    // 5. NAVEGAÇÃO ENTRE ABAS (DIRIGENTES / MANDATO)
    const abas = await page.locator('button, a, .br-tab-item, div').all();
    for (const aba of abas) {
      const txt = await aba.innerText().catch(() => '');
      if (/dirigente|mandato|diretoria/i.test(txt)) {
        if (await aba.isVisible().catch(() => false)) {
          await aba.click({ force: true }).catch(() => {});
          await page.waitForTimeout(2000);
        }
      }
    }

    // 6. EXTRAÇÃO DA DATA NO DOM DA PÁGINA
    const textoCompleto = await page.evaluate(() => document.body ? document.body.innerText : '');
    
    // Procura padrões de datas brasileiras após palavras-chave
    let dataEncontrada = null;
    const regexDatas = /(?:Data\s*fim|Mandato|Período|Término)[\s\S]{0,100}?(\d{2}\/\d{2}\/\d{4})/i;
    const matchData = textoCompleto.match(regexDatas);

    if (matchData && matchData[1]) {
      dataEncontrada = matchData[1];
    } else {
      // Busca ampla por todas as datas na tela e extrai a última/futura
      const todasDatas = textoCompleto.match(/(\d{2}\/\d{2}\/\d{4})/g);
      if (todasDatas && todasDatas.length > 0) {
        dataEncontrada = todasDatas[todasDatas.length - 1];
      }
    }

    // Procura em JSONs interceptados se o DOM falhar
    if (!dataEncontrada && jsonInterceptados.length > 0) {
      const strJson = JSON.stringify(jsonInterceptados);
      const matchJson = strJson.match(/"(?:dataFim|dtFim|dataFimMandato|fimMandato|dataTermino|dtTermino)"\s*:\s*"([^"]+)"/i);
      if (matchJson && matchJson[1]) {
        dataEncontrada = matchJson[1];
      }
    }

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: dataEncontrada || 'Não encontrada',
      urlFinal: page.url(),
      respostasApiCapuradas: jsonInterceptados.length,
      consultadoEm: new Date().toISOString()
    });

  } catch (error) {
    return res.status(500).json({ 
      success: false, 
      error: 'Erro na consulta: ' + error.message 
    });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API CNES rodando na porta ${PORT}`);
});
