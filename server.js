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

    // 1. Formata o CNPJ com máscara (00.000.000/0000-00)
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const cnpjMascara = cnpjLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

    // 2. Preenche o campo de pesquisa
    const cnpjInput = page.locator('input[placeholder*="CNPJ"], input[id*="cnpj"], input[name*="cnpj"], input[type="text"]').first();
    await cnpjInput.waitFor({ state: 'visible', timeout: 15000 });
    
    await cnpjInput.click();
    await cnpjInput.fill(cnpjMascara);
    
    await cnpjInput.evaluate(el => {
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    });

    await page.waitForTimeout(1000);

    // 3. Clica em Pesquisar
    await page.evaluate(() => {
      const btn = document.querySelector('button.br-button.primary') || 
                  document.querySelector('button[type="button"]') ||
                  document.querySelector('button[type="submit"]');
      if (btn) {
        btn.removeAttribute('disabled');
        btn.click();
      }
    });

    await cnpjInput.focus();
    await page.keyboard.press('Enter');
    
    // 4. Aguarda os resultados da busca
    await page.waitForTimeout(4000);

    // 5. Clica na linha da tabela ou no botão de detalhes/ações para abrir os Dirigentes
    try {
      const botaoAcao = page.locator('table tbody tr td button, button[title*="Detalhes"], button[title*="Visualizar"], .br-button').first();
      if (await botaoAcao.isVisible({ timeout: 5000 })) {
        await botaoAcao.click();
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      // Caso a tela já carregue aberta
    }

    // 6. Busca específica pelo rótulo "Data fim" no DOM
    const dataFimMandato = await page.evaluate(() => {
      const textoPagina = document.body.innerText;
      
      // Procura exatamente pelo texto "Data fim" seguido da data DD/MM/AAAA
      const matchDataFim = textoPagina.match(/Data\s*fim\s*[\r\n]*\s*(\d{2}\/\d{2}\/\d{4})/i);
      if (matchDataFim) {
        return matchDataFim[1];
      }

      // Procura no bloco de elementos próximos a "Mandato"
      const elementos = Array.from(document.querySelectorAll('*'));
      for (const el of elementos) {
        if (el.children.length === 0 && el.textContent.trim().toLowerCase() === 'data fim') {
          const pai = el.parentElement;
          if (pai) {
            const match = pai.innerText.match(/(\d{2}\/\d{2}\/\d{4})/);
            if (match) return match[1];
          }
        }
      }

      return null;
    });

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: dataFimMandato || 'Não encontrada',
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
