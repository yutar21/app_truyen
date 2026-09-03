import https from 'node:https';
import fs from 'node:fs';

const file = fs.createWriteStream('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\index.orig.html');
https.get('https://raw.githubusercontent.com/zhitongblog/novel-studio/main/ui/index.html', (res) => {
  res.pipe(file);
  file.on('finish', () => {
    file.close();
    console.log('Original index.html downloaded successfully!');
  });
}).on('error', (err) => {
  console.error('Download error:', err.message);
});
