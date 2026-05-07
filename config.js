import 'dotenv/config';

export const CONFIG = {
  // Dual-wallet security
  PRIVATE_KEY:               process.env.PRIVATE_KEY || '',
  SIGNER_PRIVATE_KEY:         process.env.SIGNER_PRIVATE_KEY || '',
  SIGNER_MIN_BALANCE:         parseFloat(process.env.SIGNER_MIN_BALANCE || '0.01'),
  SIGNER_REFILL_AMOUNT:       parseFloat(process.env.SIGNER_REFILL_AMOUNT || '0.015'),
  VAULT_MIN_BALANCE_SOL:      parseFloat(process.env.MIN_SOL_BALANCE || process.env.VAULT_MIN_BALANCE_SOL || '0.005'),

  // Telegram notifications
  TELEGRAM_BOT_TOKEN:        process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID:          process.env.TELEGRAM_CHAT_ID || '',

  // RPC & API Keys
  RPC_URL:                   process.env.RPC_URL || 'https://api.mainnet-beta.solana.com',
  RPC_URL_FALLBACK:          process.env.RPC_URL_FALLBACK || 'https://api.mainnet-beta.solana.com',
  HELIUS_API_KEY:            process.env.HELIUS_API_KEY || '',
  JUPITER_API_KEY:           process.env.JUPITER_API_KEY || '',  // Optional: from developers.jup.ag/portal (keyless=0.5 RPS, free=1 RPS)
  RUGCHECK_API_KEY:          process.env.RUGCHECK_API_KEY || '',


  // Trade controls
  BUY_AMOUNT_SOL:            parseFloat(process.env.BUY_AMOUNT_SOL || '0.005'),
  TAKE_PROFIT_MULTIPLIER:    parseFloat(process.env.TAKE_PROFIT_MULTIPLIER || '1.35'),
  STOP_LOSS_PERCENT:         parseFloat(process.env.STOP_LOSS_PERCENT || '20'),
  SLIPPAGE_PERCENT:          parseFloat(process.env.SLIPPAGE || process.env.SLIPPAGE_PERCENT || '15'),
  MAX_POSITIONS:             parseInt(process.env.MAX_POSITIONS || '3'),
  USE_MANAGED_LANDING:       process.env.USE_MANAGED_LANDING !== 'false',
  MAX_PRIORITY_FEE_SOL:      parseFloat(process.env.PRIORITY_FEE || process.env.MAX_PRIORITY_FEE_SOL || '0.00001'),
  RETRY_ON_FAILURE:          process.env.RETRY_ON_FAILURE !== 'false',
  STRICT_DEDUPLICATION:      process.env.STRICT_DEDUPLICATION !== 'false',

  // Sell strategy
  SELL_MODE:                process.env.SELL_MODE || 'instant',  // 'instant' (100% at TP) or 'staged' (keep 50/50)
  INSTANT_TP_MULTIPLIER:     parseFloat(process.env.INSTANT_TP_MULTIPLIER || '1.35'),
  SELL_STAGES:               (() => {
    try {
      return JSON.parse(process.env.SELL_STAGES || '[{"multiplier":1.35,"percent":100}]');
    } catch (e) {
      console.error('ERROR: Invalid SELL_STAGES JSON in .env - using default');
      return [{"multiplier":1.35,"percent":100}];
    }
  })(),

  // Safety filters
  MIN_LIQUIDITY_USD:         parseFloat(process.env.MIN_LIQUIDITY_USD || '100'),
  MAX_LIQUIDITY_USD:         parseFloat(process.env.MAX_LIQUIDITY_USD || '500000'),
  REQUIRE_MINT_REVOKED:      process.env.REQUIRE_MINT_REVOKED !== 'false',
  REQUIRE_FREEZE_REVOKED:    process.env.REQUIRE_FREEZE_REVOKED !== 'false',
  HONEYPOT_CHECK:            process.env.HONEYPOT_CHECK !== 'false',
  MIN_SOL_LIQUIDITY:         parseFloat(process.env.MIN_SOL_LIQUIDITY || '3.5'), // 3.5 SOL minimum
  HONEYPOT_SIMULATION_ENABLED: process.env.HONEYPOT_SIMULATION_ENABLED === 'true',

  // Dynamic slippage
  DYNAMIC_SLIPPAGE:         process.env.DYNAMIC_SLIPPAGE !== 'false',
  DYNAMIC_SLIPPAGE_MIN_BPS: parseInt(process.env.DYNAMIC_SLIPPAGE_MIN_BPS || '50'),
  DYNAMIC_SLIPPAGE_MAX_BPS: parseInt(process.env.DYNAMIC_SLIPPAGE_MAX_BPS || '3000'),

  // Position controls
  MAX_HOLD_MINUTES:          parseInt(process.env.MAX_HOLD_MINUTES || '15'),      // Force close after 15min
  MONITORING_INTERVAL_MS:      parseInt(process.env.MONITORING_INTERVAL_MS || '3000'),  // 3s high-frequency

  // Shinobi WebSocket filters
  USE_SHINOBI_WS:              process.env.USE_SHINOBI_WS === 'true',
  MIN_TRADE_VOLUME_SOL:        parseFloat(process.env.MIN_TRADE_VOLUME_SOL || '0.5'),
  VOLUME_GROWTH_RATE:          parseFloat(process.env.VOLUME_GROWTH_RATE || '0.3'),
  SHINOBI_DEXS:                (process.env.SHINOBI_DEXS || 'pumpfun,raydium,jupiter,orca,pumpswap').split(','),

  // Bonding curve filter
  // Only buy tokens with minimum liquidity (closer to curve completion/migrated)
  // Set to 0 to rely on DexScreener USD liquidity instead
  MIN_INITIAL_LIQUIDITY_SOL:   parseFloat(process.env.MIN_INITIAL_LIQUIDITY_SOL || '0'),
  MIN_INITIAL_LIQUIDITY_USD:   parseFloat(process.env.MIN_INITIAL_LIQUIDITY_USD || '0'),
  MIN_LP_BURNED_PERCENT:     parseFloat(process.env.MIN_LP_BURNED_PERCENT || '0'),

  // Mode
  PAPER_TRADING:             process.env.PAPER_TRADING === 'true' || process.argv.includes('--paper'),

  // Graduated Scaling
  USE_GRADUATED_SCALING:     process.env.USE_GRADUATED_SCALING === 'true',
  SCALING_MIN_BALANCE:       parseFloat(process.env.SCALING_MIN_BALANCE || '5'),      // $5 USD
  SCALING_MAX_BALANCE:       parseFloat(process.env.SCALING_MAX_BALANCE || '50'),     // $50 USD cap
  SCALING_PHASES:            process.env.SCALING_PHASES 
    ? JSON.parse(process.env.SCALING_PHASES) 
    : [
        { min: 5,    max: 10,  fraction: 0.20 },
        { min: 10,   max: 20,  fraction: 0.30 },
        { min: 20,   max: 50,  fraction: 0.50 },
        { min: 50,   max: Infinity, fraction: 0.70 },
      ],

  // DexScreener Scanner Config
  SCANNER_ENABLED: process.env.SCANNER_ENABLED === 'true', // Defaults to false per user request
  SCANNER_POLL_INTERVAL: parseInt(process.env.SCANNER_POLL_INTERVAL || '5000'),
  SCANNER_MIN_LIQUIDITY: parseFloat(process.env.SCANNER_MIN_LIQUIDITY || '50'),
  SCANNER_MIN_VOLUME: parseFloat(process.env.SCANNER_MIN_VOLUME || '20'),
  SCANNER_MIN_TXNS: parseInt(process.env.SCANNER_MIN_TXNS || '0'),
  SCANNER_MAX_CANDIDATES: parseInt(process.env.SCANNER_MAX_CANDIDATES || '3'),
  SCANNER_SCORE_THRESHOLD: parseFloat(process.env.SCANNER_SCORE_THRESHOLD || '50'),
  RUGCHECK_MIN_SCORE:        parseInt(process.env.RUGCHECK_MIN_SCORE || '500'),
  
  // Advanced Safety Thresholds (replacing hardcoded values)
  RUGCHECK_TIER_STANDARD:    parseInt(process.env.RUGCHECK_TIER_STANDARD || '600'),
  RUGCHECK_TIER_HIGH_LIQ:    parseInt(process.env.RUGCHECK_TIER_HIGH_LIQ || '650'),
  ESTABLISHED_TOKEN_AGE_MS:  parseInt(process.env.ESTABLISHED_TOKEN_AGE_MS || '3600000'), // 1 hour
  MIN_SAFETY_SCORE:          parseInt(process.env.MIN_SAFETY_SCORE || '40'),
};

export function validateConfig() {
  const errors = [];
  if (!CONFIG.PAPER_TRADING && !CONFIG.PRIVATE_KEY)
    errors.push('PRIVATE_KEY is required for live trading');
  if (CONFIG.BUY_AMOUNT_SOL <= 0 && !CONFIG.USE_GRADUATED_SCALING)
    errors.push('BUY_AMOUNT_SOL must be > 0');
  if (CONFIG.TAKE_PROFIT_MULTIPLIER <= 0)
    errors.push('TAKE_PROFIT_MULTIPLIER must be > 0');
  return errors;
}

export function getSolPrice() {
  return CONFIG._solPrice || 90;
}

export function setSolPrice(price) {
  CONFIG._solPrice = price;
}

export function getDynamicBuyAmount(balanceSOL = 0, solPrice = 90, vaultSOL = 0, closedPnL = 0) {
  if (!CONFIG.USE_GRADUATED_SCALING) {
    return CONFIG.BUY_AMOUNT_SOL;
  }
  
  // COMPOUNDING: initial vault + accumulated profits
  const effectiveVaultSOL = vaultSOL + closedPnL;
  
  // Use effective vault for compounding logic
  const effectiveVaultUSD = effectiveVaultSOL * solPrice;
  let fraction = 0.20;
  
  for (const phase of CONFIG.SCALING_PHASES) {
    if (effectiveVaultUSD >= phase.min && effectiveVaultUSD < phase.max) {
      fraction = phase.fraction;
      break;
    }
  }
  
  // Formula: vault × (fraction / maxPositions) = per-trade amount
  const perTradeFraction = fraction / CONFIG.MAX_POSITIONS;
  const buyAmount = effectiveVaultSOL * perTradeFraction;
  
  // Cap at $50 max per trade
  const maxTradeUSD = 50;
  const scaled = Math.min(buyAmount, maxTradeUSD / solPrice);
  
  return Math.max(scaled, 0.001);
}
