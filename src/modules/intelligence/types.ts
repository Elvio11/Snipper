export interface SecurityReport {
  isSafe: boolean;
  score: number; // 0-100
  flags: string[];
  ownerBalance: number;
  isMintable: boolean;
  isRenounced: boolean;
  liquidityLocked: boolean;
  topHoldersConcentration: number;
  auditDetails: string;
}

export interface SocialPulse {
  sentimentScore: number; // -1 to 1
  mentionsCount: number;
  topPlatforms: string[];
  recentPosts: string[];
  trendingScore: number;
}

export interface DexData {
  price: number;
  volume24h: number;
  liquidity: number;
  marketCap: number;
  pairAddress: string;
  chain: string;
}

export interface MarketIntelligence {
  symbol: string;
  address: string;
  timestamp: string;
  security: SecurityReport;
  social: SocialPulse;
  market: DexData;
  overallScore: number;
  recommendation: 'BUY' | 'SELL' | 'HOLD' | 'IGNORE';
}
