const express = require('express');
const { chromium } = require('playwright-chromium');

const app = express();
app.use(express.json());

app.post('/consultar-cnes', async (req, res) => {
  const { cnpj } = req.body;
  
  if (!cnpj) {
    return res.status(400).json({ error: 'CNPJ obrigatorio' });
  }

  let browser;
  try {
    // Inicializa navegador em segundo plano com User-Agent real
    browser = await chromium.launch({ 
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    // Acesse o portal do CNES MTE
    await page.goto('http://cnes.mte.gov.br/paginas/consultas/consulta_entidades.xhtml', { 
      waitUntil: 'networkidle', 
      timeout: 30000 
    });

    // Preenche o CNPJ limpo (apenas numeros)
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    await page.fill('input[id*="cnpj"]', cnpjLimpo);
    
    // Clica no botao de pesquisar
    await page.click('button[id*="pesquisar"], input[type="submit"]');
    await page.waitForTimeout(3000);

    // Extrai o texto do resultado (ajustar os seletores conforme a estrutura HTML atual do CNES)
    const conteudoPagina = await page.content();
    
    // Busca por padrao de data dd/mm/aaaa no texto de vigencia
    const regexData = /(\d{2}\/\d{2}\/\d{4})/g;
    const datasEncontradas = conteudoPagina.match(regexData) || [];

    await browser.close();

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: datasEncontradas[1] || datasEncontradas[0] || 'Nao encontrada',
      consultadoEm: new Date().toISOString()
    });

  } catch (error) {
    if (browser) await browser.close();
    return res.status(500).json({ 
      success: false, 
      error: 'Erro ao consultar o CNES: ' + error.message 
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API CNES rodando na porta ${PORT}`));