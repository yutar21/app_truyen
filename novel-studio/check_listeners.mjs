import fs from 'node:fs';

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, 'ui', 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(__dirname, 'ui', 'app.js'), 'utf8');

// Trích xuất tất cả các ID trong html tĩnh (index.html)
const htmlIds = new Set();
const idRegex = /id=["']([\w\-]+)["']/g;
let m;
while ((m = idRegex.exec(html)) !== null) {
  htmlIds.add(m[1]);
}

// Trích xuất thêm các ID được tạo động trong template HTML của app.js
const dynamicIds = new Set();
while ((m = idRegex.exec(js)) !== null) {
  dynamicIds.add(m[1]);
}

// Trích xuất tất cả các lệnh addEventListener trong app.js
const eventRegex = /[\$]\(['"]#([\w\-]+)['"]\)(?:\s*&&\s*[\$]\(['"]#\1['"]\))?\.addEventListener/g;
const missingStaticListenerIds = [];
const totallyMissingIds = [];

while ((m = eventRegex.exec(js)) !== null) {
  const id = m[1];
  if (!htmlIds.has(id)) {
    missingStaticListenerIds.push(id);
    if (!dynamicIds.has(id)) {
      totallyMissingIds.push(id);
    }
  }
}

console.log('Tổng số ID trong index.html tĩnh:', htmlIds.size);
console.log('Tổng số ID động trong app.js:', dynamicIds.size);
console.log('ID có listener không nằm trong index.html (được render động qua JS):', missingStaticListenerIds);
console.log('ID hoàn toàn không tồn tại ở bất cứ đâu:', totallyMissingIds);

if (totallyMissingIds.length === 0) {
  console.log('✅ HOÀN TOÀN KHÔNG CÓ BẤT KỲ EVENT LISTENER NÀO BỊ NULL HOẶC THIẾU ELEMENT!');
}


