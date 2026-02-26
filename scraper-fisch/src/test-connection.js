const fetch = require('node-fetch');

async function testConnection() {
  const url = 'https://fischcalculator.com/';
  console.log(`Fetching ${url}...\n`);

  const res = await fetch(url);
  const html = await res.text();

  console.log(`1. Status code: ${res.status}`);
  console.log(`\n2. Primeros 500 caracteres:\n${html.slice(0, 500)}`);
  console.log(`\n3. Contiene "fish": ${/fish/i.test(html) ? 'SI' : 'NO'}`);
}

testConnection().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
