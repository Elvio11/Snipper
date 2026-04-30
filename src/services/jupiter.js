const JUPITER_PRICE_API = 'https://price.jup.ag/v6';
const JUPITER_SWAP_API = 'https://quote-api.jup.ag';
const SOL_MINT = 'So11111111111111111111111111111111111111112';

const _priceCache = new Map();
const CACHE_TTL = 5000;

export async function getJupiterPrice(mintAddress) {
  const cached = _priceCache.get(mintAddress);
  if (cached && Date.now() - cached.ts < CACHE_TTL) {
    return cached.price;
  }

  try {
    const res = await fetch(`${JUPITER_PRICE_API}/price?ids=${mintAddress}`, {
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    const usdPrice = data?.data?.[mintAddress]?.price;
    
    if (!usdPrice) return null;
    
    const solRes = await fetch(`${JUPITER_PRICE_API}/price?ids=${SOL_MINT}`);
    const solData = await solRes.json();
    const solUSD = solData?.data?.[SOL_MINT]?.price || 140;
    
    const price = usdPrice / solUSD;
    _priceCache.set(mintAddress, { price, ts: Date.now() });
    return price;
  } catch {
    return null;
  }
}

export async function getJupiterQuote(inputMint, outputMint, amount) {
  try {
    const res = await fetch(
      `${JUPITER_SWAP_API}/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippage=1`,
      { signal: AbortSignal.timeout(5000) }
    );
    return await res.json();
  } catch {
    return null;
  }
}

export async function getSolPrice() {
  try {
    const res = await fetch(`${JUPITER_PRICE_API}/price?ids=${SOL_MINT}`);
    const data = await res.json();
    return data?.data?.[SOL_MINT]?.price || 140;
  } catch {
    return 140;
  }
}