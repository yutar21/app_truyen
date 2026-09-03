import fs from 'node:fs';

const appJs = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\app.orig.js', 'utf8');
const html = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\index.html', 'utf8');

// Tìm tất cả các ID được query trong app.js: $('#xyz') hoặc document.querySelector('#xyz')
const idRegex = /[\$]\(['"]#([\w\-]+)['"]\)/g;
const ids = new Set();
let m;
while ((m = idRegex.exec(appJs)) !== null) {
  ids.add(m[1]);
}

console.log(`Tìm thấy ${ids.size} ID được query trong app.js`);
const missing = [];
for (const id of ids) {
  if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
    missing.push(id);
  }
}

if (missing.length) {
  console.log(`⚠️ CÁC ID BỊ THIẾU TRONG index.html:`, missing);
} else {
  console.log('✅ 100% ID trong app.js đều tồn tại đầy đủ trong index.html!');
}
