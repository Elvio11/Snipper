const DEX_API = 'https://api.dexscreener.com';

export async function getDexScreenerToken(tokenAddress) {
  try {
    const res = await fetch(`${DEX_API}/latest/dex/tokens/${tokenAddress}`, {
      signal: AbortSignal.timeout(8000)
    });
    const data = await res.json();
    
    const pairs = (data?.pairs || [])
      .filter(p => p.chainId === 'solana')
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    
    return pairs[0] || null;
  } catch {
    return null;
  }
}

export async function getDexScreenerPairs(chainId, pairId) {
  try {
    const res = await fetch(`${DEX_API}/pairs/v2/${chainId}/${pairId}`, {
      signal: AbortSignal.timeout(5000)
    });
    return await res.json();
  } catch {
    return null;
  }
}

export function extractLiquidityFromDexScreener(pair) {
  if (!pair) return { liquidityUSD: 0, liquiditySOL: 0 };
  
  return {
    liquidityUSD: pair.liquidity?.usd || 0,
    liquiditySOL: pair.liquidity?.quote || 0,
    priceNative: parseFloat(pair.priceNative || 0),
    priceUSD: parseFloat(pair.priceUsd || 0),
    volume24h: pair.volume?.h24 || 0,
    txns24h: pair.txns?.h24 || 0,
  };
}