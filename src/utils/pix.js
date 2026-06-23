function formatEMV(id, value) {
  const len = String(value).length.toString().padStart(2, '0');
  return `${id}${len}${value}`;
}

function crc16(data) {
  let crc = 0xFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
    }
  }
  return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
}

export function generatePix(valor, username, { chave: chavePersonalizada, nome: nomePersonalizado, cidade: cidadePersonalizada } = {}) {
  const chave = (chavePersonalizada || process.env.PIX_KEY || '').trim();
  
  let nome = (nomePersonalizado || process.env.PIX_NAME || 'MQS BOT')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .substring(0, 25)
    .trim();
    
  let cidade = (cidadePersonalizada || process.env.PIX_CITY || 'SAO PAULO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .substring(0, 15)
    .trim();

  // Garante o valor com duas casas decimais (ex: "15.00")
  const valorFormatado = parseFloat(valor).toFixed(2);

  // 26 = Merchant Account Information (Chave Pix)
  const merchantAccount = formatEMV('00', 'BR.GOV.BCB.PIX') + formatEMV('01', chave);

  // Montando o esqueleto básico do padrão EMV
  let pixPayload = 
    formatEMV('00', '01') +                // Payload Format Indicator
    formatEMV('26', merchantAccount) +     // Informações da Chave
    formatEMV('52', '0000') +              // Merchant Category Code
    formatEMV('53', '986') +               // Transaction Currency (986 = Real)
    formatEMV('54', valorFormatado) +      // Preço correto (ID 54 + Tamanho + Valor)
    formatEMV('58', 'BR') +                // Country Code
    formatEMV('59', nome) +                // Nome do beneficiário
    formatEMV('60', cidade);               // Cidade do beneficiário

  // 62 = Additional Data Field (TxID) - Usando o username limpo do comprador
  const txid = username.replace(/[^a-zA-Z0-9]/g, '').substring(0, 25) || 'COMPRAMQS';
  const additionalData = formatEMV('05', txid);
  pixPayload += formatEMV('62', additionalData);

  // 63 = Adiciona a indicação do CRC16
  pixPayload += '6304';

  // Calcula o código de validação final
  const resultadoFinal = pixPayload + crc16(pixPayload);

  return resultadoFinal;
}