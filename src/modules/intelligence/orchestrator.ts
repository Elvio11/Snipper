import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { MarketIntelligence, SecurityReport, SocialPulse, DexData } from './types';
import { SecurityAuditor } from './security-auditor';

const execPromise = promisify(exec);

export class MarketOrchestrator {
  private auditor: SecurityAuditor;

  constructor() {
    this.auditor = new SecurityAuditor();
  }

  public async getIntelligence(tokenAddress: string, chain: string = 'solana'): Promise<MarketIntelligence> {
    // 1. Fetch Market Data (In a real scenario, this calls GeckoTerminal MCP tools)
    // For now, we assume we receive this or fetch it via internal methods
    const dexData = await this.fetchDexData(tokenAddress, chain);

    // 2. Security Hard-Gate
    const security = await this.auditor.audit(tokenAddress, dexData);

    let social: SocialPulse = {
      sentimentScore: 0,
      mentionsCount: 0,
      topPlatforms: [],
      recentPosts: [],
      trendingScore: 0
    };

    // 3. Social Enrichment (Only if security pass)
    if (security.isSafe) {
      social = await this.fetchSocialPulse(dexData.symbol || tokenAddress);
    }

    // 4. Scoring Logic
    const overallScore = this.calculateOverallScore(security, social, dexData);

    return {
      symbol: dexData.symbol || 'UNKNOWN',
      address: tokenAddress,
      timestamp: new Date().toISOString(),
      security,
      social,
      market: dexData,
      overallScore,
      recommendation: this.getRecommendation(overallScore, security.isSafe)
    };
  }

  private async fetchDexData(address: string, chain: string): Promise<any> {
    try {
      const response = await fetch(`https://api.dexpaprika.com/networks/${chain}/tokens/${address}`);
      if (!response.ok) throw new Error(`DexPaprika failed: ${response.status}`);
      const data = await response.json() as any;
      
      // Map to our DexData format
      return {
        symbol: data.symbol || 'UNKNOWN',
        price: data.price_usd || 0,
        volume24h: data.volume_usd_24h || 0,
        liquidity: { usd: data.liquidity_usd || 0 },
        marketCap: data.market_cap_usd || 0,
        pairAddress: address,
        chain,
        security: {
          is_renounced: data.security?.is_renounced ?? true,
          is_mintable: data.security?.is_mintable ?? false,
          is_freezable: data.security?.is_freezable ?? false,
          is_liquidity_locked: data.security?.is_liquidity_locked ?? false,
          top_holders_percent: data.security?.top_holders_percent ?? 0
        }
      };
    } catch (error) {
      console.error('DexData Fetch Error:', error);
      // Fallback to minimal data
      return { symbol: 'UNKNOWN', price: 0, volume24h: 0, liquidity: { usd: 0 }, chain };
    }
  }

  private async fetchSocialPulse(query: string): Promise<SocialPulse> {
    try {
      // Path to the Python bridge
      const scriptPath = path.resolve(__dirname, '../../../../../tools/unified_social_pulse.py');
      const { stdout } = await execPromise(`python "${scriptPath}" "${query}"`);
      return JSON.parse(stdout);
    } catch (error) {
      console.error('Social Pulse Error:', error);
      return {
        sentimentScore: 0,
        mentionsCount: 0,
        topPlatforms: [],
        recentPosts: [],
        trendingScore: 0
      };
    }
  }

  private calculateOverallScore(security: SecurityReport, social: SocialPulse, market: any): number {
    if (!security.isSafe) return 0;
    
    let score = security.score * 0.4; // 40% security
    score += (social.sentimentScore + 1) * 50 * 0.3; // 30% sentiment (map -1..1 to 0..100)
    score += Math.min(100, (social.trendingScore * 10)) * 0.2; // 20% momentum
    score += Math.min(100, (market.volume24h / 10000)) * 0.1; // 10% volume
    
    return Math.round(score);
  }

  private getRecommendation(score: number, isSafe: boolean): 'BUY' | 'SELL' | 'HOLD' | 'IGNORE' {
    if (!isSafe) return 'IGNORE';
    if (score >= 85) return 'BUY';
    if (score >= 70) return 'HOLD';
    if (score >= 50) return 'HOLD';
    return 'IGNORE';
  }
}
