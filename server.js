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

    // 3. Clica no botão Pesquisar
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
    
    // 4. Aguarda carregar a tabela de resultados da busca
    await page.waitForTimeout(4000);

    // 5. Clica no botão de ação da tabela (detalhes/visualizar entidade)
    try {
      const acaoTabela = page.locator('table tbody tr td button, table tbody tr td a, button[title*="Visualizar"], button[title*="Detalhes"], i.fa-eye, i.fa-search').first();
      if (await acaoTabela.isVisible({ timeout: 5000 })) {
        await acaoTabela.click();
        await page.waitForTimeout(3000);
      }
    } catch (e) {
      console.log('Aviso: Clique na tabela não necessário ou elemento não encontrado:', e.message);
    }

    // 6. Clica na aba/seção "Dirigentes", se existir
    try {
      const abaDirigentes = page.locator('text=/Dirigentes/i, button:has-text("Dirigentes"), a:has-text("Dirigentes")').first();
      if (await abaDirigentes.isVisible({ timeout: 3000 })) {
        await abaDirigentes.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('Aviso: Aba Dirigentes já visível ou não encontrada:', e.message);
    }

    // 7. Extração precisa do campo "Data fim" no painel de Mandato
    const dataFimMandato = await page.evaluate(() => {
      const texto = document.body.innerText;

      // Padrão 1: "Data fim" seguido da data DD/MM/AAAA
      const m1 = texto.match(/Data\s*fim[\s\S]{1,40}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m1 && m1[1]) return m1[1];

      // Padrão 2: Seção "Mandato" contendo data de início e data de fim
      const secaoMandato = texto.match(/Mandato[\s\S]{1,200}?(\d{2}\/\d{2}\/\d{4})[\s\S]{1,50}?(\d{2}\/\d{2}\/\d{4})/i);
      if (secaoMandato && secaoMandato[2]) return secaoMandato[2];

      // Padrão 3: Procura no contêiner do DOM rotulado como "Data fim"
      const elementos = Array.from(document.querySelectorAll('*'));
      for (const el of elementos) {
        if (el.children.length === 0 && el.textContent.trim().toLowerCase() === 'data fim') {
          const container = el.closest('div, td, tr, section') || el.parentElement;
          if (container) {
            const datas = container.innerText.match(/(\d{2}\/\d{2}\/\d{4})/g);
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
