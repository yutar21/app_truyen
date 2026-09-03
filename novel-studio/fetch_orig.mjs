import https from 'node:https';
import fs from 'node:fs';

const file = fs.createWriteStream('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\app.orig.js');
https.get('https://raw.githubusercontent.com/zhitongblog/novel-studio/main/ui/app.js', (res) => {
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Original app.js downloaded successfully!');
  });
}).on('error', (err) => {
  console.error('Download error:', err.message);
});
