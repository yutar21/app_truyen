import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(__dirname, 'ui', 'app.orig.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, 'ui', 'index.orig.html'), 'utf8');

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
