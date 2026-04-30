# Graph Report - D:/SniperBOT  (2026-04-28)

## Corpus Check
- 101 files · ~102,647 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 561 nodes · 999 edges · 20 communities detected
- Extraction: 75% EXTRACTED · 25% INFERRED · 0% AMBIGUOUS · INFERRED: 251 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_.has()|.has()]]
- [[_COMMUNITY_getDynamicBuyAmount(|getDynamicBuyAmount(]]
- [[_COMMUNITY_startServer()|startServer()]]
- [[_COMMUNITY_asyncHandler()|asyncHandler()]]
- [[_COMMUNITY_Cache|Cache]]
- [[_COMMUNITY_.get()|.get()]]
- [[_COMMUNITY_LyraClient|LyraClient]]
- [[_COMMUNITY_.set()|.set()]]
- [[_COMMUNITY_.searchTools()|.searchTools()]]
- [[_COMMUNITY_.discoverApi()|.discoverApi()]]
- [[_COMMUNITY_generateGoSDK()|generateGoSDK()]]
- [[_COMMUNITY_box()|box()]]
- [[_COMMUNITY_registerIntelligence|registerIntelligence]]
- [[_COMMUNITY_getLyraClient()|getLyraClient()]]
- [[_COMMUNITY_AdapterRegistry|AdapterRegistry]]
- [[_COMMUNITY_registerTechnicalAna|registerTechnicalAna]]
- [[_COMMUNITY_c()|c()]]
- [[_COMMUNITY_batchWithRateLimit()|batchWithRateLimit()]]
- [[_COMMUNITY_registerUtils()|registerUtils()]]
- [[_COMMUNITY_deriveCLMMPoolPDA()|deriveCLMMPoolPDA()]]

## God Nodes (most connected - your core abstractions)
1. `log()` - 68 edges
2. `LyraClient` - 38 edges
3. `PoolMonitor` - 23 edges
4. `getConnection()` - 22 edges
5. `main()` - 19 edges
6. `LyraDiscovery` - 18 edges
7. `LyraRegistry` - 18 edges
8. `PoolService` - 18 edges
9. `PositionManager` - 16 edges
10. `Logger` - 16 edges

## Surprising Connections (you probably didn't know these)
- `main()` --calls--> `validateConfig()`  [INFERRED]
  D:\SniperBOT\src\vendors\market-data\index.ts → D:\SniperBOT\config.js
- `buyToken()` --calls--> `getWallet()`  [INFERRED]
  D:\SniperBOT\executor.js → D:\SniperBOT\wallet.js
- `buyToken()` --calls--> `getConnection()`  [INFERRED]
  D:\SniperBOT\executor.js → D:\SniperBOT\wallet.js
- `buyToken()` --calls--> `log()`  [INFERRED]
  D:\SniperBOT\executor.js → D:\SniperBOT\logger.js
- `sellToken()` --calls--> `getWallet()`  [INFERRED]
  D:\SniperBOT\executor.js → D:\SniperBOT\wallet.js

## Communities

### Community 0 - ".has()"
Cohesion: 0.05
Nodes (35): CLMMPoolMonitor, extractLiquidityFromDexScreener(), getDexScreenerToken(), HeliusMonitor, cancelAllOrders(), cancelLimitOrder(), createLimitOrder(), getJupiterPrice() (+27 more)

### Community 1 - "getDynamicBuyAmount("
Cohesion: 0.07
Nodes (22): validateConfig(), fetchFromAPI(), gracefulShutdown(), main(), printBanner(), PositionManager, startStdioServer(), closePosition() (+14 more)

### Community 2 - "startServer()"
Cohesion: 0.07
Nodes (18): startServer(), deleteFromCache(), getFromCache(), readCache(), saveToCache(), safeParse(), safeStringify(), startHTTPServer() (+10 more)

### Community 3 - "asyncHandler()"
Cohesion: 0.05
Nodes (21): AuthError, ChainNotSupportedError, ConfigurationError, ContractError, DeploymentError, errorHandler(), getErrorMessage(), InsufficientFundsError (+13 more)

### Community 4 - "Cache"
Cohesion: 0.06
Nodes (8): Cache, applySecurityMiddleware(), RateLimiter, sanitizeInput(), sanitizeObject(), securityHeaders(), RateLimiter, validateNotBlockedAddress()

### Community 5 - ".get()"
Cohesion: 0.11
Nodes (8): buyToken(), getPaperPrice(), getQuote(), paperBuy(), paperSell(), sellToken(), PoolService, ShinobiWebSocket

### Community 6 - "LyraClient"
Cohesion: 0.08
Nodes (1): LyraClient

### Community 7 - ".set()"
Cohesion: 0.1
Nodes (15): registerAnalytics(), registerMarketData(), getJupiterPrice(), getCPMMPriceFromPool(), getPriceFromBirdeye(), getPriceFromDexscreener(), getPriceFromPool(), getPriceFromPoolRPC() (+7 more)

### Community 8 - ".searchTools()"
Cohesion: 0.13
Nodes (1): LyraRegistry

### Community 9 - ".discoverApi()"
Cohesion: 0.16
Nodes (1): LyraDiscovery

### Community 10 - "generateGoSDK()"
Cohesion: 0.22
Nodes (12): generateGoSDK(), generateRouteMethodsGo(), routeToGoMethodName(), generatePythonSDK(), generateRouteMethodsPython(), routeToSnakeCaseMethod(), extractPathParams(), toCamelCase() (+4 more)

### Community 11 - "box()"
Cohesion: 0.21
Nodes (10): box(), colorize(), formatAddress(), formatError(), formatTxHash(), printPaymentSummary(), printWelcome(), progressBar() (+2 more)

### Community 12 - "registerIntelligence"
Cohesion: 0.18
Nodes (4): registerIntelligence(), MarketOrchestrator, SecurityAuditor, registerIntelligenceTools()

### Community 13 - "getLyraClient()"
Cohesion: 0.28
Nodes (2): getLyraClient(), registerLyraTools()

### Community 14 - "AdapterRegistry"
Cohesion: 0.16
Nodes (5): AdapterRegistry, constructor(), DeFiAnalyticsAdapter, setupHandlers(), start()

### Community 15 - "registerTechnicalAna"
Cohesion: 0.2
Nodes (7): registerTechnicalAnalysis(), calculateBB(), calculateMA(), calculateMACD(), calculateRSI(), getComprehensiveAnalysis(), registerTechnicalAnalysisTools()

### Community 16 - "c()"
Cohesion: 0.47
Nodes (10): c(), getBalance(), getGasPrice(), getMarketOverview(), getPrice(), main(), processCommand(), showChains() (+2 more)

### Community 17 - "batchWithRateLimit()"
Cohesion: 0.27
Nodes (3): batchWithRateLimit(), getRateLimiter(), RateLimiter

### Community 19 - "registerUtils()"
Cohesion: 0.47
Nodes (3): registerUtils(), registerUtilityPrompts(), registerUtilityTools()

### Community 20 - "deriveCLMMPoolPDA()"
Cohesion: 0.5
Nodes (3): fetchCLMMPoolInfo(), fetchPoolLiquidity(), parseCLMMPoolAccount()

## Knowledge Gaps
- **Thin community `LyraClient`** (33 nodes): `LyraClient`, `.canSpend()`, `.clearPaymentHistory()`, `.constructor()`, `.createPaymentApi()`, `.estimateTotalCost()`, `.estimateUSdsYield()`, `.getActiveNetwork()`, `.getDefaultToken()`, `.getMidnightTimestamp()`, `.getNetworkConfig()`, `.getPaymentHistory()`, `.getPeriodCutoff()`, `.getPricing()`, `.getRecommendedNetworks()`, `.getRemainingDailyAllowance()`, `.getSperaxContracts()`, `.getSupportedNetworks()`, `.getSupportedTokens()`, `.getTodaysSpending()`, `.getUsageStats()`, `.getUSDsBenefits()`, `.handlePayment()`, `.isPaymentEnabled()`, `.isUsingUSDs()`, `.isYieldBearing()`, `.lowCost()`, `.readOnly()`, `.resetDailySpendIfNeeded()`, `.securityScan()`, `.solana()`, `.testnet()`, `.yieldBearing()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `.searchTools()`** (19 nodes): `.searchTools()`, `LyraRegistry`, `.browse()`, `.constructor()`, `.deleteTool()`, `.estimateCost()`, `.getCategories()`, `.getFeaturedTools()`, `.getPricing()`, `.getToolConfiguration()`, `.getToolDetails()`, `.getToolExamples()`, `.getToolInfo()`, `.getTrending()`, `.listByCategory()`, `.registerTool()`, `.requestFeaturedListing()`, `.search()`, `.updateTool()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `.discoverApi()`** (18 nodes): `.discoverApi()`, `LyraDiscovery`, `.analyze()`, `.analyzeCompatibility()`, `.constructor()`, `.detectProtocol()`, `.discover()`, `.estimateCost()`, `.generateMcpConfig()`, `.generateToolDefinitions()`, `.getCodeSnippets()`, `.getCompatibilityScore()`, `.getFullAssistance()`, `.getPricing()`, `.getSupportedProtocols()`, `.getTestCases()`, `.isMcpCompatible()`, `.listTools()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.
- **Thin community `getLyraClient()`** (15 nodes): `getLyraClient()`, `.fromEnv()`, `resetLyraClient()`, `setLyraClient()`, `logger.js`, `client.ts`, `constants.ts`, `discovery.ts`, `intel.ts`, `lyra-ecosystem.test.ts`, `registry.ts`, `tools.ts`, `types.ts`, `base.ts`, `registerLyraTools()`
  Too small to be a meaningful cluster - may be noise or needs more connections extracted.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `log()` connect `.has()` to `getDynamicBuyAmount(`, `startServer()`, `.get()`, `box()`, `getLyraClient()`, `AdapterRegistry`, `c()`?**
  _High betweenness centrality (0.382) - this node is a cross-community bridge._
- **Why does `LyraClient` connect `LyraClient` to `.searchTools()`, `.discoverApi()`, `startServer()`, `getLyraClient()`?**
  _High betweenness centrality (0.102) - this node is a cross-community bridge._
- **Why does `main()` connect `getDynamicBuyAmount(` to `.has()`, `startServer()`, `makeRequestCsApi()`, `box()`?**
  _High betweenness centrality (0.091) - this node is a cross-community bridge._
- **Are the 67 inferred relationships involving `log()` (e.g. with `buyToken()` and `sellToken()`) actually correct?**
  _`log()` has 67 INFERRED edges - model-reasoned connections that need verification._
- **Are the 17 inferred relationships involving `getConnection()` (e.g. with `buyToken()` and `sellToken()`) actually correct?**
  _`getConnection()` has 17 INFERRED edges - model-reasoned connections that need verification._
- **Are the 14 inferred relationships involving `main()` (e.g. with `validateConfig()` and `printWalletInfo()`) actually correct?**
  _`main()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Should `.has()` be split into smaller, more focused modules?**
  _Cohesion score 0.05 - nodes in this community are weakly interconnected._