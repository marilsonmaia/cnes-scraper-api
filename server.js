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
    const targetUrl = 'https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade';
    
    await page.goto(targetUrl, { 
      waitUntil: 'domcontentloaded', 
      timeout: 45000 
    });

    // 1. Limpa e aplica a máscara oficial no CNPJ (00.000.000/0000-00)
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const cnpjMascara = cnpjLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

    // 2. Localiza o campo de busca
    const cnpjInput = page.locator('input[placeholder*="CNPJ"], input[id*="cnpj"], input[name*="cnpj"], input[type="text"]').first();
    await cnpjInput.waitFor({ state: 'visible', timeout: 15000 });
    
    // 3. Preenche com a máscara e dispara eventos nativos do Angular
    await cnpjInput.click();
    await cnpjInput.fill(cnpjMascara);
    
    await cnpjInput.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });

    await page.waitForTimeout(1000);

    // 4. Executa a pesquisa forçando a remoção do 'disabled' ou via tecla Enter
    await page.evaluate(() => {
      const btn = document.querySelector('button.br-button.primary') || 
                  document.querySelector('button[type="button"]') ||
                  document.querySelector('button[type="submit"]');
      if (btn) {
        btn.removeAttribute('disabled');
        btn.click();
      }
    });

    // Garante o envio via Enter caso a ação do botão falhe
    await cnpjInput.focus();
    await page.keyboard.press('Enter');
    
    // 5. Aguarda a renderização do resultado
    await page.waitForTimeout(5000);

    const conteudoPagina = await page.content();
    
    // Extrai datas no formato DD/MM/AAAA encontradas na página
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

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API CNES rodando na porta ${PORT}`);
});
