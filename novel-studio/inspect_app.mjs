import fs from 'node:fs';

const content = fs.readFileSync('C:\\Users\\Duk\\.gemini\\antigravity-ide\\scratch\\novel-studio\\ui\\app.js', 'utf8');
const lines = content.split(/\r?\n/);
console.log('Total lines in app.js:', lines.length);

const hits = [];
lines.forEach((line, idx) => {
  if (/function\s+\w+|const\s+\w+\s*=\s*(?:async\s*)?\(/i.test(line)) {
    hits.push(`${idx + 1}: ${line.slice(0, 80)}`);
  }
});
console.log('Found function definitions:\n', hits.slice(0, 40).join('\n'));
