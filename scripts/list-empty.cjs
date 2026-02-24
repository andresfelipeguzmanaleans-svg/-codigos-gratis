const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'data', 'games');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let count = 0;
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!d.thumbnail) {
    count++;
    const slug = (d.slug || '').replace(/^codigos?-/, '');
    console.log(count + '. ' + d.name + '  -->  ' + slug);
  }
}
console.log('\nTotal: ' + count);
