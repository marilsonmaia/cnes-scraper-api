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

    // 2. Preenche o campo de CNPJ
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
                  document.querySelector('button[type="submit"]') ||
                  document.querySelector('button:not([disabled])');
      if (btn) {
        btn.removeAttribute('disabled');
        btn.click();
      }
    });

    await cnpjInput.focus();
    await page.keyboard.press('Enter');
    
    // 4. Aguarda explicitamente a tabela de resultados aparecer
    try {
      await page.waitForSelector('table tbody tr', { timeout: 15000 });
      await page.waitForTimeout(1000);
    } catch (e) {
      console.log('Tabela de resultados não apareceu a tempo.');
    }

    // 5. Clica no item da tabela para abrir os detalhes
    try {
      const linha = page.locator('table tbody tr').first();
      const acao = linha.locator('button, a, i').first();
      
      if (await acao.isVisible({ timeout: 3000 })) {
        await acao.click();
      } else if (await linha.isVisible({ timeout: 3000 })) {
        await linha.click();
      }
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log('Erro ao clicar no resultado da tabela:', e.message);
    }

    // 6. Tenta clicar na aba "Dirigentes", se existir
    try {
      const abaDirigentes = page.locator('text=/Dirigentes/i').first();
      if (await abaDirigentes.isVisible({ timeout: 3000 })) {
        await abaDirigentes.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('Aba Dirigentes não encontrada ou já aberta.');
    }

    // 7. Extrai a "Data fim" do Mandato
    const resultadoData = await page.evaluate(() => {
      const texto = document.body.innerText;

      // Padrão 1: Procura por "Data fim" seguido por uma data no formato DD/MM/AAAA
      const matchDataFim = texto.match(/Data\s*fim[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i);
      if (matchDataFim && matchDataFim[1]) {
        return matchDataFim[1];
      }

      // Padrão 2: Procura no bloco "Mandato" por duas datas (início e fim)
      const matchMandato = texto.match(/Mandato[\s\S]*?(\d{2}\/\d{2}\/\d{4})[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i);
      if (matchMandato && matchMandato[2]) {
        return matchMandato[2];
      }

      // Padrão 3: Procura por elementos HTML que contenham "Data fim"
      const todosElementos = Array.from(document.querySelectorAll('*'));
      for (const el of todosElementos) {
        if (el.children.length === 0 && el.textContent.trim().toLowerCase() === 'data fim') {
          const pai = el.closest('div, td, tr, section') || el.parentElement;
          if (pai) {
            const datas = pai.innerText.match(/(\d{2}\/\d{2}\/\d{4})/g);
            if (datas && datas.length > 0) {
              return datas[datas.length - 1];
            }
          }
        }
      }

      return null;
    });

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: resultadoData || 'Não encontrada',
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
