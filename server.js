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

    const cnpjLimpo = cnpj.replace(/\D/g, '');

    // Localiza o campo de busca
    const cnpjInput = page.locator('input[placeholder*="CNPJ"], input[id*="cnpj"], input[name*="cnpj"], input[type="text"]').first();
    await cnpjInput.waitFor({ state: 'visible', timeout: 15000 });
    
    // Interage com o campo simulando digitação humana para ativar a validação do Angular
    await cnpjInput.click();
    await cnpjInput.fill('');
    await cnpjInput.pressSequentially(cnpjLimpo, { delay: 50 });
    
    // Dispara eventos de mudança e perde o foco (blur) para liberar o botão de busca
    await cnpjInput.dispatchEvent('input');
    await cnpjInput.dispatchEvent('change');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);

    // Tenta disparar a pesquisa via Enter ou clique no botão
    const pesquisarBtn = page.locator('button.br-button.primary, button:has-text("Pesquisar"), button[type="submit"]').first();
    
    if (await pesquisarBtn.isEnabled()) {
      await pesquisarBtn.click();
    } else {
      // Se o botão ainda estiver desativado, força o envio pressionando Enter no campo
      await cnpjInput.focus();
      await page.keyboard.press('Enter');
    }
    
    // Aguarda o carregamento dos resultados da pesquisa
    await page.waitForTimeout(5000);

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
