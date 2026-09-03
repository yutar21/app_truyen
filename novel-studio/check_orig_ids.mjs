import fs from 'node:fs';

const appJs = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\app.orig.js', 'utf8');
const html = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\index.orig.html', 'utf8');

const idRegex = /[\$]\(['"]#([\w\-]+)['"]\)/g;
const ids = new Set();
let m;
while ((m = idRegex.exec(appJs)) !== null) {
  ids.add(m[1]);
}

const missing = [];
for (const id of ids) {
  if (!html.includes(`id="${id}"`) && !html.includes(`id='${id}'`)) {
    missing.push(id);
  }
}

console.log(`Kiểm tra bản gốc: ${ids.size} IDs, Bị thiếu: ${missing.length}`);
if (missing.length) console.log('Thiếu:', missing);
