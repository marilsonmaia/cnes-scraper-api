const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

app.get('/consultar-cnes', async (req, res) => {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    const requisicoesRede = [];

    // Captura todas as APIs que o site do governo tenta chamar
    page.on('response', response => {
      if (response.url().includes('cnes') || response.url().includes('api')) {
        requisicoesRede.push(`${response.status()} : ${response.url()}`);
      }
    });

    // Tenta acessar a página do CNES
    await page.goto('https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Aguarda 5 segundos para carga de scripts
    await page.waitForTimeout(5000);

    const titulo = await page.title();
    const textoVisivel = await page.evaluate(() => document.body ? document.body.innerText : 'SEM CONTEUDO');
    const totalInputs = await page.locator('input').count();

    return res.json({
      status: 'diagnostico_concluido',
      tituloPagina: titulo,
      inputsEncontrados: totalInputs,
      requisicoesInternas: requisicoesRede,
      textoCapturado: textoVisivel.substring(0, 400).replace(/\s+/g, ' '),
      possivelBloqueio: textoVisivel.includes('Cloudflare') || textoVisivel.includes('Access Denied') || textoVisivel.includes('Captcha')
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Diagnóstico ativo na porta ${PORT}`));
