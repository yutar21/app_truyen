import fs from 'node:fs';

const html = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\index.html', 'utf8');
const js = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\app.js', 'utf8');

// Trích xuất tất cả các ID trong html
const htmlIds = new Set();
const idRegex = /id=["']([\w\-]+)["']/g;
let m;
while ((m = idRegex.exec(html)) !== null) {
  htmlIds.add(m[1]);
}

// Trích xuất tất cả các lệnh addEventListener trong app.js
const eventRegex = /[\$]\(['"]#([\w\-]+)['"]\)(?:\s*&&\s*[\$]\(['"]#\1['"]\))?\.addEventListener/g;
const missingListenerIds = [];
while ((m = eventRegex.exec(js)) !== null) {
  const id = m[1];
  if (!htmlIds.has(id)) {
    missingListenerIds.push(id);
  }
}

console.log('Total HTML IDs:', htmlIds.size);
console.log('Missing event listener target IDs:', missingListenerIds);

if (missingListenerIds.length === 0) {
  console.log('✅ HOÀN TOÀN KHÔNG CÓ BẤT KỲ EVENT LISTENER NÀO BỊ NULL!');
}
