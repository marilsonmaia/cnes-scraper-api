const express = require('express');
const { chromium } = require('playwright');

const app = express();
app.use(express.json());

app.get('/consultar-cnes', async (req, res) => {
  const rawCnpj = req.query.cnpj;
  if (!rawCnpj) {
    return res.status(400).json({ error: 'O parâmetro "cnpj" é obrigatório.' });
  }

  // Remove pontos, barras e traços
  const cnpj = String(rawCnpj).replace(/\D/g, '');
  if (cnpj.length !== 14) {
    return res.status(400).json({ error: 'CNPJ deve conter 14 dígitos.' });
  }

  // URL Direta de Detalhes no CNES
  const targetUrl = `https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade/detalhes/${cnpj}`;

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    // Navega diretamente para a URL de detalhes do CNPJ
    await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 35000 });

    // Tempo de segurança para o Angular injetar os dados no DOM
    await page.waitForTimeout(4000);

    // Extrai todo o texto visível da página
    const pageText = await page.evaluate(() => document.body.innerText || '');

    // Verifica se a entidade não existe no cadastro
    if (pageText.includes('Nenhum registro encontrado') || pageText.includes('não encontrada')) {
      return res.json({ 
        status: 'nao_encontrado', 
        cnpj, 
        mensagem: 'Entidade/CNPJ não localizado no CNES.' 
      });
    }

    // Busca específica de datas associadas ao mandato
    const inicioMatch = pageText.match(/Data\s+(?:início|inicio)(?:\s+mandato)?[\s:]*(\d{2}\/\d{2}\/\d{4})/i);
    const terminoMatch = pageText.match(/Data\s+(?:término|termino)(?:\s+mandato)?[\s:]*(\d{2}\/\d{2}\/\d{4})/i);

    // Captura genérica de todas as datas (DD/MM/AAAA) presentes na página como fallback
    const todasDatas = pageText.match(/\d{2}\/\d{2}\/\d{4}/g) || [];

    const dataInicio = inicioMatch ? inicioMatch[1] : (todasDatas[0] || null);
    const dataTermino = terminoMatch ? terminoMatch[1] : (todasDatas[1] || null);

    return res.json({
      status: 'sucesso',
      cnpj,
      dataInicioMandato: dataInicio,
      dataTerminoMandato: dataTermino,
      todasDatasEncontradas: todasDatas,
      previewTexto: pageText.substring(0, 300).replace(/\s+/g, ' ') // Auxilia na depuração
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor de raspagem CNES rodando na porta ${PORT}`));
