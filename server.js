const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// Rota raiz para teste de ping/despertar do Render
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
        '--single-process'
      ] 
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();
    
    // Nova URL oficial do Cadastro Nacional de Entidades Sindicais (CNES)
    const targetUrl = 'https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade';
    
    await page.goto(targetUrl, { 
      waitUntil: 'networkidle', 
      timeout: 45000 
    });

    const cnpjLimpo = cnpj.replace(/\D/g, '');

    // Localiza e preenche o campo de CNPJ
    const cnpjInput = page.locator('input[placeholder*="CNPJ"], input[id*="cnpj"], input[name*="cnpj"], input[type="text"]').first();
    await cnpjInput.waitFor({ state: 'visible', timeout: 15000 });
    await cnpjInput.fill(cnpjLimpo);
    
    // Localiza e clica no botão Pesquisar
    const pesquisarBtn = page.locator('button:has-text("Pesquisar"), input[type="submit"], button[type="submit"]').first();
    await pesquisarBtn.click();
    
    // Aguarda o retorno da busca
    await page.waitForTimeout(4000);

    const conteudoPagina = await page.content();
    
    // Extrai datas no formato DD/MM/AAAA encontradas no resultado
    const regexData = /(\d{2}\/\d{2}\/\d{4})/g;
    const datasEncontradas = conteudoPagina.match(regexData) || [];

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: datasEncontradas[1] || datasEncontradas[0] || 'Não encontrada',
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API CNES rodando na porta ${PORT}`));
