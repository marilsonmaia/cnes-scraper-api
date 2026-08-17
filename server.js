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

    // 1. Navega direto para a página de detalhes da entidade
    const detalhesUrl = `https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade/detalhes/${cnpjLimpo}`;
    console.log(`Navegando para: ${detalhesUrl}`);
    
    await page.goto(detalhesUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    // Aguarda o Angular carregar as chamadas da API interna
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(4000);

    // 2. Localiza e clica na aba ou seção "Dirigentes", se não estiver expandida
    try {
      const elDirigentes = page.locator('*:has-text("Dirigentes")').last();
      if (await elDirigentes.isVisible({ timeout: 3000 })) {
        await elDirigentes.click({ force: true }).catch(() => {});
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      console.log('Aviso ao clicar na seção Dirigentes:', e.message);
    }

    // 3. Aguarda o aparecimento do texto "Mandato" ou "Data fim" na tela
    try {
      await page.waitForSelector('text=/Data fim/i', { timeout: 7000 });
    } catch (e) {
      console.log('Rótulo "Data fim" demorou a renderizar, prosseguindo varredura...');
    }

    // 4. Extração minuciosa da Data Fim do Mandato
    const dataFimMandato = await page.evaluate(() => {
      const texto = document.body.innerText;

      // Padrão 1: Captura a data exatamente após "Data fim"
      const matchDataFim = texto.match(/Data\s*fim[\s\n\r:]*(\d{2}\/\d{2}\/\d{4})/i);
      if (matchDataFim && matchDataFim[1]) {
        return matchDataFim[1];
      }

      // Padrão 2: Bloco "Mandato" contendo Data Início e Data Fim (retorna a 2ª data)
      const matchMandato = texto.match(/Mandato[\s\S]*?(\d{2}\/\d{2}\/\d{4})[\s\S]*?(\d{2}\/\d{2}\/\d{4})/i);
      if (matchMandato && matchMandato[2]) {
        return matchMandato[2];
      }

      // Padrão 3: Varredura por nós de elementos do DOM contendo o rótulo
      const todosElementos = Array.from(document.querySelectorAll('*'));
      for (const el of todosElementos) {
        const txt = el.textContent ? el.textContent.trim() : '';
        if (/^Data\s*fim$/i.test(txt)) {
          let container = el.parentElement;
          for (let i = 0; i < 3 && container; i++) {
            const datas = container.innerText.match(/(\d{2}\/\d{2}\/\d{4})/g);
            if (datas && datas.length > 0) {
              return datas[datas.length - 1]; // Retorna a última data do bloco
            }
            container = container.parentElement;
          }
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
