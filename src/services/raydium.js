import { getConnection } from '../../wallet.js';
import { PublicKey } from '@solana/web3.js';

export const RAYDIUM_CLMM_PROGRAM = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
export const RAYDIUM_AMM_PROGRAM = new PublicKey('675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8');

const RAYDIUM_API = 'https://api-v3.raydium.io';

export async function fetchCLMMPoolInfo(poolAddress) {
  try {
    const res = await fetch(`${RAYDIUM_API}/pools/info/ids?ids=${poolAddress}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    return data?.data?.[0] || null;
  } catch {
    return null;
  }
}

export async function fetchPoolLiquidity(poolAddress) {
  const pool = await fetchCLMMPoolInfo(poolAddress);
  if (!pool) return null;
  return {
    tvl: parseFloat(pool.tvl || 0),
    liquidity: pool.liquidity,
    mintA: pool.mintA,
    mintB: pool.mintB,
  };
}

export async function deriveCLMMPoolPDA(mintA, mintB, ammConfig) {
  const [sortedA, sortedB] = mintA < mintB ? [mintA, mintB] : [mintB, mintA];
  const POOL_SEED = Buffer.from('pool_standard');
  
  return await PublicKey.findProgramAddress(
    [
      POOL_SEED,
      new PublicKey(ammConfig).toBuffer(),
      new PublicKey(sortedA).toBuffer(),
      new PublicKey(sortedB).toBuffer()
    ],
    RAYDIUM_CLMM_PROGRAM
  );
}

export function parseCLMMPoolAccount(data) {
  const DISCRIMINATOR = 8;
  const PUBKEY_LEN = 32;
  
  if (data.length < DISCRIMINATOR + PUBKEY_LEN * 4) {
    return null;
  }
  
  return {
    mintA: new PublicKey(data.slice(DISCRIMINATOR, DISCRIMINATOR + PUBKEY_LEN)).toString(),
    mintB: new PublicKey(data.slice(DISCRIMINATOR + PUBKEY_LEN, DISCRIMINATOR + PUBKEY_LEN * 2)).toString(),
    vaultA: new PublicKey(data.slice(DISCRIMINATOR + PUBKEY_LEN * 2, DISCRIMINATOR + PUBKEY_LEN * 3)).toString(),
    vaultB: new PublicKey(data.slice(DISCRIMINATOR + PUBKEY_LEN * 3, DISCRIMINATOR + PUBKEY_LEN * 4)).toString(),
  };
}