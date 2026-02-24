const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'data', 'games');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
let needTexts = 0, haveAll = 0;
const list = [];
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
  if (d.thumbnail && !d.introText) {
    needTexts++;
    list.push(f + '|' + d.name + '|' + d.genre + '|' + d.totalVisits + '|' + d.playerCount + '|' + d.likes + '|' + (d.placeId || ''));
  } else if (d.thumbnail && d.introText) {
    haveAll++;
  }
}
console.log('Need texts: ' + needTexts);
console.log('Already have texts: ' + haveAll);
console.log('---');
list.forEach(l => console.log(l));
