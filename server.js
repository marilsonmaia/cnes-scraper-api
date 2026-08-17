const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

// Rota raiz para teste de ping/despertar do Render (evita erro 404)
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
    // Inicializa navegador headless otimizado para o Render
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
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    // Acessa o portal CNES MTE
    await page.goto('http://cnes.mte.gov.br/paginas/consultas/consulta_entidades.xhtml', { 
      waitUntil: 'domcontentloaded', 
      timeout: 30000 
    });

    // Limpa o CNPJ mantendo apenas dígitos
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    await page.fill('input[id*="cnpj"]', cnpjLimpo);
    
    // Dispara a busca
    await page.click('button[id*="pesquisar"], input[type="submit"]');
    await page.waitForTimeout(3000);

    const conteudoPagina = await page.content();
    
    // Extrai datas no formato DD/MM/AAAA
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
    // Garante o encerramento do processo do navegador
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API CNES rodando na porta ${PORT}`));
