const fs = require('fs');
const path = require('path');

const dataPath = path.join(__dirname, '..', 'data', 'music-ids.json');
const publicPath = path.join(__dirname, '..', 'public', 'data', 'music-ids.json');

const d = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const sortByArtist = (a, b) => {
  const aa = (a.artist || '').toLowerCase();
  const bb = (b.artist || '').toLowerCase();
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
};

// Group A: genre AND thumbnail
const groupA = d.songs.filter(s => s.genre && s.thumbnail).sort(sortByArtist);
// Group B: genre but NO thumbnail
const groupB = d.songs.filter(s => s.genre && !s.thumbnail).sort(sortByArtist);
// Group C: no genre
const groupC = d.songs.filter(s => !s.genre).sort(sortByArtist);

console.log('Group A (genre + thumbnail):', groupA.length);
console.log('Group B (genre, no thumbnail):', groupB.length);
console.log('Group C (no genre):', groupC.length);
console.log('Total:', groupA.length + groupB.length + groupC.length);

d.songs = [...groupA, ...groupB, ...groupC];

const output = JSON.stringify(d, null, 2);
fs.writeFileSync(dataPath, output, 'utf8');
console.log('Written to', dataPath);

// Ensure public/data directory exists
fs.mkdirSync(path.dirname(publicPath), { recursive: true });
fs.writeFileSync(publicPath, output, 'utf8');
console.log('Copied to', publicPath);
