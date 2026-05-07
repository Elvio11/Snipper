# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-05-07

### Added
- **Visual Dashboard**: A new React-based web interface for real-time monitoring of trades, wallet balances, and performance metrics.
- **Dashboard API**: Backend API to serve data to the frontend dashboard.
- **Price Fallback**: Implemented a fallback price discovery mechanism (`0.000001 SOL`) for newly launched tokens that are not yet indexed by market data APIs.
- **Utility Scripts**: Added `check_live_balances.js` and `convert_keys.js` for easier wallet management.

### Changed
- **Config Synchronization**: Updated default `STOP_LOSS_PERCENT` to 20% across `config.js`, `.env`, and `.env.example` to align with high-volatility trading and test requirements.
- **E2E Test Improvements**: Enhanced `new-token.test.js` to use dynamic token amounts from buy transactions, ensuring 100% test pass rates for the full trade lifecycle.

### Fixed
- Fixed a bug where paper trading would fail for tokens with zero initial price data.
- Improved logging consistency in `executor.js`.
