import { createJupiterApiClient } from '@jup-ag/api';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';
import { CONFIG } from '../config.js';

// Jupiter API v6 is deprecated but the @jup-ag/api SDK still uses it internally.
// The SDK handles the mapping. If JUPITER_API_KEY is set, pass it via headers.
const apiKey = CONFIG.JUPITER_API_KEY || '';

export const jupiterApi = createJupiterApiClient({
  basePath: 'https://api.jup.ag',
  ...(apiKey ? { headers: { 'x-api-key': apiKey } } : {}),
});

export { LAMPORTS_PER_SOL };
