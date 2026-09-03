import fs from 'node:fs';
import path from 'node:path';

const volDir = 'C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novels\\dau-pha-thuong-khung-luc-tran\\chapters\\卷01';
const testFiles = [
  '001_O_Than_thanh_thieu_nien.txt',
  '002_Dau_gia_hoi_tuong_ngo.txt',
  '003_Khi_toan_ngung_tu_dot_pha.txt'
];

for (const tf of testFiles) {
  const p = path.join(volDir, tf);
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log('Deleted:', tf);
  }
}

const remaining = fs.readdirSync(volDir);
console.log(`Remaining chapters count in 卷01: ${remaining.length}`);
