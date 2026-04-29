import { createJupiterApiClient } from '@jup-ag/api';
import { LAMPORTS_PER_SOL } from '@solana/web3.js';

export const jupiterApi = createJupiterApiClient({
  basePath: 'https://quote-api.jup.ag/v6'
});

export { LAMPORTS_PER_SOL };
