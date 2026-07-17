// Genera api/handler.js sirviendo index.source.html como string, igual que
// amsac-transporte-bitrix24. Ejecutar con: node build.js
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'index.source.html');
const outPath = path.join(__dirname, 'api', 'handler.js');

const html = fs.readFileSync(srcPath, 'utf8');
const out =
  'module.exports = (req, res) => {\n' +
  '  res.setHeader("Content-Type", "text/html; charset=utf-8");\n' +
  '  res.status(200).send(' + JSON.stringify(html) + ');\n' +
  '};\n';

fs.writeFileSync(outPath, out);
console.log('api/handler.js generado (' + out.length + ' bytes) a partir de index.source.html');
