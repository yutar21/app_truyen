import fs from 'node:fs';

const content = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\app.js', 'utf8');
const lines = content.split(/\r?\n/);

const keywords = ['renderUsage', 'renderSettings', 'renderEnv', 'openReader', 'renderReader'];
lines.forEach((line, idx) => {
  for (const kw of keywords) {
    if (line.includes(kw)) {
      console.log(`Line ${idx + 1} (${kw}): ${line.slice(0, 100)}`);
    }
  }
});
