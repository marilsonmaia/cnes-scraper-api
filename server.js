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
    const cnpjLimpo = cnpj.replace(/\D/g, '');
    const cnpjMascara = cnpjLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");

    // 1. TENTATIVA DIRETA: Abre direto a URL de detalhes da entidade pelo CNPJ
    const detalhesUrl = `https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade/detalhes/${cnpjLimpo}`;
    console.log(`Navegando para: ${detalhesUrl}`);
    
    await page.goto(detalhesUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(3000);

    // Se a navegação direta redirecionar de volta para a busca, faz a busca pelo formulário
    if (!page.url().includes('/detalhes/')) {
      console.log("URL de detalhes redirecionou. Realizando busca via formulário...");
      const searchUrl = 'https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade';
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 35000 });
      await page.waitForTimeout(2000);

      const cnpjInput = page.locator('input[placeholder*="CNPJ"], input[id*="cnpj"], input[type="text"]').first();
      await cnpjInput.waitFor({ state: 'visible', timeout: 10000 });
      await cnpjInput.click();
      await cnpjInput.fill(cnpjMascara);

      await cnpjInput.evaluate(el => {
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
      });

      await page.waitForTimeout(1000);

      // Clica em Pesquisar
      const btnPesquisar = page.locator('button:has-text("Pesquisar"), button.br-button.primary, button[type="submit"]').first();
      if (await btnPesquisar.isVisible()) {
        await btnPesquisar.click();
      } else {
        await page.keyboard.press('Enter');
      }

      await page.waitForTimeout(4000);

      // Clica no resultado na tabela
      const linkTabela = page.locator('table tbody tr a, table tbody tr button, table tbody tr').first();
      if (await linkTabela.isVisible({ timeout: 5000 })) {
        await linkTabela.click();
        await page.waitForTimeout(3000);
      }
    }

    // 2. Clica na aba "Dirigentes"
    try {
      const abaDirigentes = page.locator('button:has-text("Dirigentes"), a:has-text("Dirigentes"), .br-tab-item:has-text("Dirigentes"), *:has-text("Dirigentes")').first();
      if (await abaDirigentes.isVisible({ timeout: 5000 })) {
        await abaDirigentes.click();
        await page.waitForTimeout(2500);
      }
    } catch (e) {
      console.log('Aviso na aba Dirigentes:', e.message);
    }

    // 3. Tenta expandir blocos sanfona/accordion se houver
    try {
      const accordions = await page.locator('.br-accordion button, details summary').all();
      for (const item of accordions) {
        if (await item.isVisible()) {
          await item.click().catch(() => {});
        }
      }
      await page.waitForTimeout(1000);
    } catch (e) {}

    // 4. Varredura profunda para extrair a "Data fim"
    const dataFimMandato = await page.evaluate(() => {
      const texto = document.body.innerText;

      // Padrão 1: "Data fim" seguido por DD/MM/AAAA
      const m1 = texto.match(/Data\s*fim[\s\S]{0,50}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m1 && m1[1]) return m1[1];

      // Padrão 2: "Mandato" com data de início e data de fim
      const m2 = texto.match(/Mandato[\s\S]{0,200}?(\d{2}\/\d{2}\/\d{4})[\s\S]{0,50}?(\d{2}\/\d{2}\/\d{4})/i);
      if (m2 && m2[2]) return m2[2];

      // Padrão 3: Varredura de nós do DOM com o rótulo "Data fim"
      const elementos = Array.from(document.querySelectorAll('*'));
      for (const el of elementos) {
        const txt = el.textContent ? el.textContent.trim().toLowerCase() : '';
        if (txt === 'data fim' || txt === 'data fim:' || txt === 'fim do mandato') {
          let pai = el.parentElement;
          for (let i = 0; i < 3 && pai; i++) {
            const datas = pai.innerText.match(/(\d{2}\/\d{2}\/\d{4})/g);
            if (datas && datas.length > 0) {
              return datas[datas.length - 1];
            }
            pai = pai.parentElement;
          }
        }
      }

      // Padrão 4: Extrai datas do bloco referente a Dirigentes
      const idxDirigentes = texto.search(/Dirigentes/i);
      if (idxDirigentes !== -1) {
        const bloco = texto.substring(idxDirigentes);
        const datas = bloco.match(/(\d{2}\/\d{2}\/\d{4})/g);
        if (datas && datas.length >= 2) {
          return datas[1]; // Geralmente a 2ª data é a Data Fim
        } else if (datas && datas.length === 1) {
          return datas[0];
        }
      }

      return null;
    });

    return res.json({
      success: true,
      cnpj: cnpjLimpo,
      dataFimMandato: dataFimMandato || 'Não encontrada',
      urlAtual: page.url(),
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
