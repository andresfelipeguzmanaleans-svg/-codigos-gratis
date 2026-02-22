const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'data', 'games');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let count = 0;
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (!d.introText) {
    count++;
    console.log(f + '|' + d.name + '|' + (d.thumbnail ? 'HAS_THUMB' : 'NO_THUMB') + '|' + (d.genre || '') + '|' + (d.totalVisits || 0) + '|' + (d.playerCount || 0) + '|' + (d.likes || 0));
  }
}
console.log('\nTotal: ' + count);
