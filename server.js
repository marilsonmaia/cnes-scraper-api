const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

app.get('/', (req, res) => {
  return res.json({ status: 'online', message: 'API CNES ativa' });
});

app.get('/consultar-cnes', async (req, res) => {
  const rawCnpj = req.query.cnpj;
  if (!rawCnpj) {
    return res.status(400).json({ status: 'erro', mensagem: 'CNPJ é obrigatório' });
  }

  const cnpj = String(rawCnpj).replace(/\D/g, '');
  if (cnpj.length !== 14) {
    return res.status(400).json({ status: 'erro', mensagem: 'CNPJ deve conter 14 dígitos' });
  }

  try {
    // 1. Consulta direta ao endpoint público do CNES/MTE
    const apiGovUrl = `https://cnes.trabalho.gov.br/cnes-backend/api/publico/entidades/pesquisar?cnpj=${cnpj}`;

    const response = await axios.get(apiGovUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://cnes.trabalho.gov.br/app/publico/consultas/cadastro-entidade',
        'Origin': 'https://cnes.trabalho.gov.br'
      },
      timeout: 15000
    });

    const data = response.data;

    // Converte o retorno em texto JSON para localizar campos de data
    const jsonStr = JSON.stringify(data);

    if (!data || jsonStr === '[]' || jsonStr === '{}') {
      return res.json({ status: 'nao_encontrado', mensagem: 'CNPJ não encontrado no CNES' });
    }

    // Busca chaves comuns de data de término/mandato no JSON retornado
    let dataTermino = null;
    const matchTermino = jsonStr.match(/"(?:dataFimMandato|dtFimMandato|dataFim|dtFim|dataTermino)"\s*:\s*"([^"]+)"/i);
    
    if (matchTermino && matchTermino[1]) {
      dataTermino = matchTermino[1];
    } else {
      // Captura a última data no formato DD/MM/AAAA ou AAAA-MM-DD
      const datas = jsonStr.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/g) || [];
      if (datas.length > 0) {
        dataTermino = datas[datas.length - 1];
      }
    }

    return res.json({
      status: 'sucesso',
      cnpj: cnpj,
      dataTerminoMandato: dataTermino || 'Não informada',
      dadosCompletos: data
    });

  } catch (error) {
    // Se o backend do MTE responder 404
    if (error.response && error.response.status === 404) {
      return res.json({ status: 'nao_encontrado', mensagem: 'Entidade não cadastrada' });
    }

    return res.status(500).json({
      status: 'erro',
      mensagem: error.message,
      detalhe: error.response ? error.response.data : null
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor ativo na porta ${PORT}`));
