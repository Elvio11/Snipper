
import dexService from './src/services/dexscreener-service.js';

async function test() {
  const PAIR = 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE';
  console.log('Testing pair:', PAIR);
  const result = await dexService.getPairByAddress(PAIR);
  console.log('Result:', JSON.stringify(result, null, 2));
}

test();
