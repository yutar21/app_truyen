import fs from 'node:fs';

const lines = fs.readFileSync('ui/app.orig.js', 'utf8').split('\n');
const items = [];
lines.forEach((l, i) => {
  const stripped = l.replace(/\/\/.*/, '');
  if (/[\u4e00-\u9fff]/.test(stripped)) {
    items.push({ line: i + 1, content: stripped });
  }
});
fs.writeFileSync('scratch_app_orig_all_lines.json', JSON.stringify(items, null, 2), 'utf8');
console.log('Total lines in app.orig.js with Chinese:', items.length);
