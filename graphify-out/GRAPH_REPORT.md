# Graph Report - D:/SniperBOT  (2026-05-01)

## Corpus Check
- 139 files · ~126,392 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 671 nodes · 1237 edges · 22 communities detected
- Extraction: 71% EXTRACTED · 29% INFERRED · 0% AMBIGUOUS · INFERRED: 353 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_.startAll()|.startAll()]]
- [[_COMMUNITY_startServer()|startServer()]]
- [[_COMMUNITY_.handlePayment()|.handlePayment()]]
- [[_COMMUNITY_getLyraClient()|getLyraClient()]]
- [[_COMMUNITY_asyncHandler()|asyncHandler()]]
- [[_COMMUNITY_getBalance()|getBalance()]]
- [[_COMMUNITY_.set()|.set()]]
- [[_COMMUNITY_Cache|Cache]]
- [[_COMMUNITY_getDynamicBuyAmount(|getDynamicBuyAmount(]]
- [[_COMMUNITY_DexScanner|DexScanner]]
- [[_COMMUNITY_.getSummary()|.getSummary()]]
- [[_COMMUNITY_.discoverApi()|.discoverApi()]]
- [[_COMMUNITY_generateGoSDK()|generateGoSDK()]]
- [[_COMMUNITY_CLMMPoolMonitor|CLMMPoolMonitor]]
- [[_COMMUNITY_box()|box()]]
- [[_COMMUNITY_registerIntelligence|registerIntelligence]]
- [[_COMMUNITY_registerTechnicalAna|registerTechnicalAna]]
- [[_COMMUNITY_AdapterRegistry|AdapterRegistry]]
- [[_COMMUNITY_batchWithRateLimit()|batchWithRateLimit()]]
- [[_COMMUNITY_c()|c()]]
- [[_COMMUNITY_shinobi-ws.js|shinobi-ws.js]]
- [[_COMMUNITY_registerUtils()|registerUtils()]]

## God Nodes (most connected - your core abstractions)
1. `log()` - 93 edges
2. `LyraClient` - 38 edges
3. `getConnection()` - 27 edges
4. `PoolMonitor` - 25 edges
5. `PoolService` - 22 edges
6. `main()` - 20 edges
7. `PositionManager` - 20 edges
8. `DexScreenerService` - 20 edges
9. `DexScreenerService` - 20 edges
10. `LyraDiscovery` - 18 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `setPositionManager()`  [INFERRED]
  D:\SniperBOT\src\vendors\market-data\index.ts → D:\SniperBOT\telegram.js
- `main()` --calls--> `validateConfig()`  [INFERRED]
  D:\SniperBOT\src\vendors\market-data\index.ts → D:\SniperBOT\config.js
- `buyToken()` --calls--> `log()`  [INFERRED]
  D:\SniperBOT\executor.js → D:\SniperBOT\logger.js
- `sellToken()` --calls--> `log()`  [INFERRED]
  D:\SniperBOT\executor.js → D:\SniperBOT\logger.js
- `paperBuy()` --calls--> `log()`  [INFERRED]
  D:\SniperBOT\executor.js → D:\SniperBOT\logger.js

## Communities

### Community 0 - ".startAll()"
Cohesion: 0.05
Nodes (19): start(), withRetry(), HeliusMonitor, log(), PoolMonitor, logRugCheckResult(), parseRugCheckReport(), rugCheck() (+11 more)

### Community 1 - "startServer()"
Cohesion: 0.07
Nodes (22): startServer(), deleteFromCache(), getFromCache(), readCache(), saveToCache(), registerAnalytics(), safeParse(), safeStringify() (+14 more)

### Community 2 - ".handlePayment()"
Cohesion: 0.06
Nodes (7): LyraIntel, logDeployment(), logError(), Logger, logPayment(), LyraRegistry, registerLyraTools()

### Community 3 - "getLyraClient()"
Cohesion: 0.07
Nodes (2): getLyraClient(), LyraClient

### Community 4 - "asyncHandler()"
Cohesion: 0.05
Nodes (20): AuthError, ChainNotSupportedError, ConfigurationError, ContractError, DeploymentError, errorHandler(), getErrorMessage(), InsufficientFundsError (+12 more)

### Community 5 - "getBalance()"
Cohesion: 0.11
Nodes (32): getBalance(), buyToken(), calculateDynamicSlippage(), getEntryPrice(), getPaperPrice(), getQuote(), paperBuy(), paperSell() (+24 more)

### Community 6 - ".set()"
Cohesion: 0.11
Nodes (10): getJupiterPrice(), _evictCacheIfNeeded(), PoolService, getCPMMPriceFromPool(), getPriceFromBirdeye(), getPriceFromDexscreener(), getPriceFromPool(), getPriceFromPoolRPC() (+2 more)

### Community 7 - "Cache"
Cohesion: 0.06
Nodes (8): Cache, applySecurityMiddleware(), RateLimiter, sanitizeInput(), sanitizeObject(), securityHeaders(), RateLimiter, validateNotBlockedAddress()

### Community 8 - "getDynamicBuyAmount("
Cohesion: 0.11
Nodes (7): validateConfig(), fetchFromAPI(), gracefulShutdown(), main(), printBanner(), PositionManager, initTelegram()

### Community 9 - "DexScanner"
Cohesion: 0.11
Nodes (2): DexScanner, DexScreenerService

### Community 10 - ".getSummary()"
Cohesion: 0.2
Nodes (14): closePosition(), handleCallback(), handleCommand(), sendAlert(), sendCloseHelp(), sendConfig(), sendHelp(), sendPause() (+6 more)

### Community 11 - ".discoverApi()"
Cohesion: 0.16
Nodes (1): LyraDiscovery

### Community 12 - "generateGoSDK()"
Cohesion: 0.22
Nodes (12): generateGoSDK(), generateRouteMethodsGo(), routeToGoMethodName(), generatePythonSDK(), generateRouteMethodsPython(), routeToSnakeCaseMethod(), extractPathParams(), toCamelCase() (+4 more)

### Community 13 - "CLMMPoolMonitor"
Cohesion: 0.15
Nodes (6): CLMMPoolMonitor, extractLiquidityFromDexScreener(), getDexScreenerToken(), fetchCLMMPoolInfo(), fetchPoolLiquidity(), parseCLMMPoolAccount()

### Community 14 - "box()"
Cohesion: 0.21
Nodes (10): box(), colorize(), formatAddress(), formatError(), formatTxHash(), printPaymentSummary(), printWelcome(), progressBar() (+2 more)

### Community 15 - "registerIntelligence"
Cohesion: 0.18
Nodes (4): registerIntelligence(), MarketOrchestrator, SecurityAuditor, registerIntelligenceTools()

### Community 16 - "registerTechnicalAna"
Cohesion: 0.2
Nodes (7): registerTechnicalAnalysis(), calculateBB(), calculateMA(), calculateMACD(), calculateRSI(), getComprehensiveAnalysis(), registerTechnicalAnalysisTools()

### Community 17 - "AdapterRegistry"
Cohesion: 0.18
Nodes (4): AdapterRegistry, constructor(), DeFiAnalyticsAdapter, setupHandlers()

### Community 18 - "batchWithRateLimit()"
Cohesion: 0.27
Nodes (3): batchWithRateLimit(), getRateLimiter(), RateLimiter

### Community 19 - "c()"
Cohesion: 0.51
Nodes (9): c(), getGasPrice(), getMarketOverview(), getPrice(), main(), processCommand(), showChains(), showHelp() (+1 more)

### Community 20 - "shinobi-ws.js"
Cohesion: 0.28
Nodes (1): ShinobiWebSocket

### Community 23 - "registerUtils()"
Cohesion: 0.47
Nodes (3): registerUtils(), registerUtilityPrompts(), registerUtilityTools()

## Knowledge Gaps
- **Thin community `getLyraClient()`** (45 nodes): `getLyraClient()`, `LyraClient`, `.canSpend()`, `.clearPaymentHistory()`, `.constructor()`, `.createPaymentApi()`, `.estimateTotalCost()`, `.estimateUSdsYield()`, `.fromEnv()`, `.getActiveNetwork()`, `.getDefaultToken()`, `.getMidnightTimestamp()`, `.getNetworkConfig()`, `.getPaymentHistory()`, `.getPeriodCutoff()`, `.getPricing()`, `.getRecommendedNetworks()`, `.getRemainingDailyAllowance()`, `.getSperaxContracts()`, `.getSupportedNetworks()`, `.getSupportedTokens()`, `.getTodaysSpending()`, `.getUsageStats()`, `.getUSDsBenefits()`, `.isPaymentEnabled()`, `.isUsingUSDs()`, `.isYieldBearing()`, `.lowCost()`, `.readOnly()`, `.resetDailySpendIfNeeded()`, `.securityScan()`, `.solana()`, `.testnet()`, `.yieldBearing()`, `resetLyraClient()`, `setLyraClient()`, `logger.js`, `client.ts`, `constants.ts`, `discovery.ts`, `intel.ts`, `lyra-ecosystem.test.ts`, `registry.ts`, `tools.ts`, `types.ts`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `DexScanner`** (34 nodes): `DexScanner`, `._calculateScore()`, `.constructor()`, `._isStablecoin()`, `._poll()`, `._processCandidate()`, `._scoreAndFilter()`, `._scoreCandidate()`, `.setPositions()`, `.start()`, `.stop()`, `DexScreenerService`, `.constructor()`, `.getCurrentApi()`, `.getNewMemePairs()`, `.getNewPairs()`, `._getNewPairsFallback()`, `.getPair()`, `.getPairByAddress()`, `.getPairsByChain()`, `.getRecentTokenAddresses()`, `.getRecentTokens()`, `.getTokenPairs()`, `.getTokenPairsByAddresses()`, `.getTokenPrice()`, `.getTokenSecurity()`, `.getTrendingPairs()`, `.makeRequest()`, `.rateLimit()`, `.rotateApi()`, `.search()`, `._fetchDexScreenerPool()`, `dex-scanner.js`, `dexscreener-service.js`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `.discoverApi()`** (18 nodes): `.discoverApi()`, `LyraDiscovery`, `.analyze()`, `.analyzeCompatibility()`, `.constructor()`, `.detectProtocol()`, `.discover()`, `.estimateCost()`, `.generateMcpConfig()`, `.generateToolDefinitions()`, `.getCodeSnippets()`, `.getCompatibilityScore()`, `.getFullAssistance()`, `.getPricing()`, `.getSupportedProtocols()`, `.getTestCases()`, `.isMcpCompatible()`, `.listTools()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `shinobi-ws.js`** (9 nodes): `shinobi-ws.js`, `ShinobiWebSocket`, `.constructor()`, `.disconnect()`, `.isVolumeGrowing()`, `.processTrade()`, `.scheduleReconnect()`, `.startPing()`, `.stopPing()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `.startAll()` to `startServer()`, `.handlePayment()`, `getLyraClient()`, `getBalance()`, `.set()`, `getDynamicBuyAmount(`, `DexScanner`, `.getSummary()`, `CLMMPoolMonitor`, `box()`, `c()`, `shinobi-ws.js`?**
  _High betweenness centrality (0.379) - this node is a cross-community bridge._
- **Why does `LyraClient` connect `getLyraClient()` to `.handlePayment()`, `.discoverApi()`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `main()` connect `getDynamicBuyAmount(` to `.startAll()`, `startServer()`, `.handlePayment()`, `getBalance()`, `.getSummary()`, `box()`, `makeRequestCsApi()`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **Are the 92 inferred relationships involving `log()` (e.g. with `buyToken()` and `sellToken()`) actually correct?**
  _`log()` has 92 INFERRED edges - model-reasoned connections that need verification._
- **Are the 22 inferred relationships involving `getConnection()` (e.g. with `buyToken()` and `sellToken()`) actually correct?**
  _`getConnection()` has 22 INFERRED edges - model-reasoned connections that need verification._
- **Should `.startAll()` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._
- **Should `startServer()` be split into smaller, more focused modules?**
  _Cohesion score 0.07 - nodes in this community are weakly interconnected._