import TelegramBot from 'node-telegram-bot-api';
import { log } from './logger.js';
import { getTokenMetadata, getTokenName } from './tokenMetadata.js';
import { CONFIG } from './config.js';
import { PositionManager } from './positions.js';

let bot = null;
let chatId = null;
let positionManager = null;

export function setPositionManager(pm) {
  positionManager = pm;
}

function escapeMarkdown(text) {
  return text.replace(/[_*\[\]()~`>#+-|={}.!\\]/g, '\\$&');
}

function escapeMarkdownV2(text) {
  return text.replace(/[_*\[\]()~`>#+-|={}.!\\]/g, '\\\\$&');
}

export async function initTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    log('warn', 'Telegram not configured - notifications disabled');
    return false;
  }

  try {
    // Use polling with auto reconnect disabled to prevent spam logging
    bot = new TelegramBot(token, { 
      polling: true,
      filepath: false,
      autoReconnect: false,
      reconnectInterval: 0 // Disable auto reconnect
    });

    bot.on('polling_error', (err) => {
      // Only log critical polling errors
      if (err.message?.includes('ECONNRESET') || err.message?.includes('ENOTFOUND')) {
        log('warn', `Telegram polling issue: ${err.message} - will retry on next message`);
      }
    });

    bot.on('message', async (msg) => {
      if (!msg.text) return;
      await handleCommand(msg);
    });

    bot.on('callback_query', async (query) => {
      await handleCallback(query);
    });

    log('info', 'Telegram bot started with commands');
    return true;
  } catch (err) {
    log('error', `Telegram init failed: ${err.message}`);
    return false;
  }
}

async function handleCommand(msg) {
  const chatId = msg.chat.id;
  const text = msg.text;
  const parts = text.split(' ');
  const command = parts[0].toLowerCase();

  try {
    switch (command) {
      case '/start':
      case '/help':
        await sendHelp(chatId);
        break;
      case '/status':
        await sendStatus(chatId);
        break;
      case '/positions':
        await sendPositions(chatId);
        break;
      case '/stats':
        await sendStats(chatId);
        break;
      case '/config':
        await sendConfig(chatId);
        break;
      case '/pause':
        await sendPause(chatId);
        break;
      case '/resume':
        await sendResume(chatId);
        break;
      case '/pnl':
        await sendPnL(chatId);
        break;
      case '/close':
        await sendCloseHelp(chatId);
        break;
      default:
        await bot.sendMessage(chatId, `Unknown command: ${command}\n\nUse /help for available commands.`);
    }
  } catch (err) {
    log('error', `Telegram command error: ${err.message}`);
    bot.sendMessage(chatId, `Error: ${err.message}`);
  }
}

async function handleCallback(query) {
  const chatId = query.message.chat.id;
  const data = query.data;

  try {
    if (data === 'refresh_status') {
      await sendStatus(chatId, query.message.message_id);
    } else if (data === 'refresh_positions') {
      await sendPositions(chatId, query.message.message_id);
    } else if (data === 'refresh_stats') {
      await sendStats(chatId, query.message.message_id);
    } else if (data.startsWith('close_position_')) {
      const mint = data.replace('close_position_', '');
      await closePosition(chatId, mint);
    } else if (data === 'pause_bot') {
      await sendPause(chatId, query.message.message_id);
    } else if (data === 'resume_bot') {
      await sendResume(chatId, query.message.message_id);
    }

    bot.answerCallbackQuery(query.id);
  } catch (err) {
    log('error', `Callback error: ${err.message}`);
    bot.answerCallbackQuery(query.id, { text: `Error: ${err.message}` });
  }
}

async function sendHelp(chatId, editMsgId = null) {
  const message = `
🤖 *SniperBOT Commands*

*Trading*
/status   - Bot status & quick summary
/positions - View open positions
/pnl      - View P&L stats

*Management*
/pause    - Pause sniping
/resume   - Resume sniping

*Info*
/stats    - Detailed trading stats
/config   - Current configuration
/help     - Show this help

_Use inline buttons for quick actions_
`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '📊 Status', callback_data: 'refresh_status' }],
      [{ text: '💼 Positions', callback_data: 'refresh_positions' }],
      [{ text: '📈 Stats', callback_data: 'refresh_stats' }],
      [{ text: '⏸️ Pause', callback_data: 'pause_bot' }, { text: '▶️ Resume', callback_data: 'resume_bot' }],
    ]
  };

  if (editMsgId) {
    await bot.editMessageText(message, { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function sendStatus(chatId, editMsgId = null) {
  const summary = positionManager?.getSummary() || { openTrades: 0, totalTrades: 0 };

  const statusEmoji = '🟢';
  const message = `
${statusEmoji} *SniperBOT Status*

*Bot:* Running
*Mode:* ${CONFIG.PAPER_TRADING ? '📝 Paper Trading' : '💰 Live Trading'}

*Positions:*
• Open: ${summary.openTrades}
• Total: ${summary.totalTrades}

*Quick Actions:*
• Buy: ${CONFIG.BUY_AMOUNT_SOL} SOL
• Max Positions: ${CONFIG.MAX_POSITIONS}
• TP: ${CONFIG.TAKE_PROFIT_MULTIPLIER}x
• SL: ${CONFIG.STOP_LOSS_PERCENT}%

_Use /help for all commands_
`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '📊 Status', callback_data: 'refresh_status' }, { text: '💼 Positions', callback_data: 'refresh_positions' }],
      [{ text: '📈 Stats', callback_data: 'refresh_stats' }],
      [{ text: '⏸️ Pause', callback_data: 'pause_bot' }, { text: '▶️ Resume', callback_data: 'resume_bot' }],
    ]
  };

  if (editMsgId) {
    await bot.editMessageText(message, { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function sendPositions(chatId, editMsgId = null) {
  if (!positionManager) {
    const msg = '❌ Position manager not initialized';
    if (editMsgId) {
      await bot.editMessageText(msg, { chat_id: chatId, message_id: editMsgId });
    } else {
      await bot.sendMessage(chatId, msg);
    }
    return;
  }

  const openPositions = positionManager.getOpenPositions();

  if (openPositions.length === 0) {
    const msg = '💼 *Open Positions*\n\nNo open positions';
    if (editMsgId) {
      await bot.editMessageText(msg, { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown' });
    } else {
      await bot.sendMessage(chatId, msg, { parse_mode: 'Markdown' });
    }
    return;
  }

  let message = `💼 *Open Positions* (${openPositions.length})\n\n`;

  for (const [mint, pos] of openPositions) {
    const timeOpen = Math.round((Date.now() - pos.openedAt) / 60000);
    const pnlPercent = ((pos.pnlSOL || 0) / pos.solSpentOriginal * 100) || 0;
    const pnlEmoji = pnlPercent >= 0 ? '🟢' : '🔴';

    message += `${pnlEmoji} *${mint.slice(0, 8)}...*\n`;
    message += `  Spent: ${pos.solSpentOriginal.toFixed(4)} SOL\n`;
    message += `  P&L: ${pnlPercent >= 0 ? '+' : ''}${pnlPercent.toFixed(1)}% (${pos.pnlSOL >= 0 ? '+' : ''}${(pos.pnlSOL || 0).toFixed(4)} SOL)\n`;
    message += `  Sold: ${pos.totalSoldPercent || 0}%\n`;
    message += `  Open: ${timeOpen}m ago\n\n`;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: '🔄 Refresh', callback_data: 'refresh_positions' }],
    ]
  };

  if (editMsgId) {
    await bot.editMessageText(message, { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function sendStats(chatId, editMsgId = null) {
  const summary = positionManager?.getSummary() || { wins: 0, losses: 0, totalTrades: 0, totalPnLSOL: 0, winRate: '0', avgWin: 0, avgLoss: 0 };

  const message = `
📈 *Trading Statistics*

*Overall:*
• Total Trades: ${summary.totalTrades}
• Win Rate: ${summary.winRate}%
• Total P&L: ${parseFloat(summary.totalPnLSOL) >= 0 ? '+' : ''}${summary.totalPnLSOL} SOL

*Wins/Losses:*
• Wins: 🟢 ${summary.wins}
• Losses: 🔴 ${summary.losses}

*Average:*
• Avg Win: +${summary.avgWin?.toFixed(4) || 0} SOL
• Avg Loss: ${summary.avgLoss?.toFixed(4) || 0} SOL

*Settings:*
• Buy Amount: ${CONFIG.BUY_AMOUNT_SOL} SOL
• TP: ${CONFIG.TAKE_PROFIT_MULTIPLIER}x
• SL: ${CONFIG.STOP_LOSS_PERCENT}%
• Mode: ${CONFIG.PAPER_TRADING ? 'Paper' : 'Live'}
`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '📊 Status', callback_data: 'refresh_status' }, { text: '💼 Positions', callback_data: 'refresh_positions' }],
      [{ text: '🔄 Refresh', callback_data: 'refresh_stats' }],
    ]
  };

  if (editMsgId) {
    await bot.editMessageText(message, { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function sendConfig(chatId) {
  const message = `
⚙️ *Configuration*

*Trading:*
• Buy Amount: ${CONFIG.BUY_AMOUNT_SOL} SOL
• Max Positions: ${CONFIG.MAX_POSITIONS}
• Take Profit: ${CONFIG.TAKE_PROFIT_MULTIPLIER}x
• Stop Loss: ${CONFIG.STOP_LOSS_PERCENT}%
• Slippage: ${CONFIG.SLIPPAGE_PERCENT}%

*Safety:*
• Min Liquidity: $${CONFIG.MIN_LIQUIDITY_USD}
• Max Liquidity: $${CONFIG.MAX_LIQUIDITY_USD}
• Check Mint Revoked: ${CONFIG.REQUIRE_MINT_REVOKED ? 'Yes' : 'No'}
• Check Freeze Revoked: ${CONFIG.REQUIRE_FREEZE_REVOKED ? 'Yes' : 'No'}

*Mode:* ${CONFIG.PAPER_TRADING ? '📝 Paper Trading' : '💰 Live Trading'}
`;

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function sendPause(chatId, editMsgId = null) {
  const message = '⏸️ *Bot Paused*\n\nSniping has been paused. Use /resume to continue.';

  const keyboard = {
    inline_keyboard: [
      [{ text: '▶️ Resume', callback_data: 'resume_bot' }],
    ]
  };

  if (editMsgId) {
    await bot.editMessageText(message, { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function sendResume(chatId, editMsgId = null) {
  const message = '▶️ *Bot Resumed*\n\nSniping is now active!';

  const keyboard = {
    inline_keyboard: [
      [{ text: '⏸️ Pause', callback_data: 'pause_bot' }],
    ]
  };

  if (editMsgId) {
    await bot.editMessageText(message, { chat_id: chatId, message_id: editMsgId, parse_mode: 'Markdown', reply_markup: keyboard });
  } else {
    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown', reply_markup: keyboard });
  }
}

async function sendPnL(chatId) {
  const summary = positionManager?.getSummary() || { totalPnLSOL: 0, wins: 0, losses: 0, avgWin: 0, avgLoss: 0 };

  const totalPnL = parseFloat(summary.totalPnLSOL) || 0;
  const emoji = totalPnL >= 0 ? '🟢' : '🔴';

  const message = `
📊 *P&L Summary*

${emoji} *Total: ${totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(4)} SOL*

*Wins:* ${summary.wins}
*Losses:* ${summary.losses}

*Avg Win:* +${(summary.avgWin || 0).toFixed(4)} SOL
*Avg Loss:* ${(summary.avgLoss || 0).toFixed(4)} SOL
`;

  await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
}

async function sendCloseHelp(chatId) {
  await bot.sendMessage(chatId, 'To close a position, use the /positions command and click on a position, or contact the bot admin.');
}

async function closePosition(chatId, mint) {
  if (!positionManager) {
    await bot.sendMessage(chatId, '❌ Position manager not initialized');
    return;
  }

  try {
    await positionManager.closePosition(mint, 'manual');
    await bot.sendMessage(chatId, `✅ Position ${mint.slice(0, 8)}... closed`);
  } catch (err) {
    await bot.sendMessage(chatId, `❌ Error closing position: ${err.message}`);
  }
}

export async function sendAlert(type, data) {
  if (!bot || !chatId) return;

  const emoji = {
    buy: '🟢',
    sell_tp: '🎯',
    sell_sl: '🛑',
    error: '❌',
    info: 'ℹ️',
    vault_refill: '💰',
  };

  const icons = emoji[type] || '📢';
  let message = '';

  try {
    const mintAddress = data?.mint || 'unknown';
    const mintShort = mintAddress.slice(0, 8) + '...';
    const mintFull = mintAddress;

    let tokenInfo = '';
    let tokenName = '';
    try {
      const metadata = await getTokenMetadata(mintAddress);
      tokenName = getTokenName(mintAddress, metadata);
      if (tokenName && tokenName !== mintShort) {
        tokenInfo = `🎯 *${tokenName}*\n`;
      }
    } catch (e) {
      // metadata fetch failed, ignore
    }

    const formatSOL = (val) => val !== undefined ? `${val >= 0 ? '+' : ''}${Number(val).toFixed(4)} SOL` : '—';

    switch (type) {
      case 'buy':
        message = `${icons} *BUY EXECUTED* ✅\n\n` +
          `${tokenInfo}` +
          `🔹 *Mint:* \`${mintFull}\`\n` +
          `💰 *Amount:* ${data.solSpent?.toFixed(4) || '?'} SOL\n` +
          `📊 *Entry:* ${data.pricePerToken?.toExponential(3) || '?'} SOL\n` +
          `🎯 *Target:* ${(data.pricePerToken * 2)?.toExponential(3) || '?'} SOL (2x)\n` +
          `🛑 *Stop Loss:* ${(data.pricePerToken * 0.75)?.toExponential(3) || '?'} SOL (-25%)`;
        break;

      case 'sell_sl':
        const isProfitSL = (data.pnlSol || 0) >= 0;
        const resultLabelSL = isProfitSL ? 'EXITED (Above Entry)' : 'STOP LOSS';
        const emojiSL = isProfitSL ? '✅' : '🔻';
        message = `${icons} *POSITION CLOSED* ${emojiSL}\n\n` +
          `${tokenInfo}` +
          `🔹 *Mint:* \`${mintFull}\`\n` +
          `📊 *Exit Reason:* ${resultLabelSL}\n` +
          `💵 *P&L:* ${isProfitSL ? '+' : ''}${Number(data.pnlSol).toFixed(4)} SOL`;
        break;

      case 'sell_tp':
        const isProfitTP = (data.pnlSol || 0) >= 0;
        const resultLabelTP = isProfitTP ? 'TAKE PROFIT HIT!' : 'POSITION CLOSED';
        const emojiTP = isProfitTP ? '✅' : '🔻';
        message = `${icons} *${resultLabelTP}* ${emojiTP}\n\n` +
          `${tokenInfo}` +
          `🔹 *Mint:* \`${mintFull}\`\n` +
          `💰 *Profit:* +${Number(data.profitPercent || 0).toFixed(1)}%\n` +
          `💵 *P&L:* ${isProfitTP ? '+' : ''}${Number(data.pnlSol || 0).toFixed(4)} SOL`;
        break;

      case 'vault_refill':
        message = `${icons} *VAULT REFILL* 💰\n\n` +
          `Transferred: ${data.amount?.toFixed(4) || '?'} SOL\n` +
          `Signer balance: ${data.signerBalance?.toFixed(4) || '?'} SOL`;
        break;

      case 'error':
        message = `${icons} *ERROR* ❌\n\n${data.message}`;
        break;

      case 'info':
        message = `${icons} *INFO* ℹ️\n\n${data.message}`;
        break;

      default:
        message = `${icons} ${JSON.stringify(data, null, 2)}`;
    }

    await bot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    log('error', `Telegram alert failed: ${err.message}`);
  }
}

async function formatMint(mint) {
  try {
    const metadata = await getTokenMetadata(mint);
    return getTokenName(mint, metadata);
  } catch {
    return mint.slice(0, 8) + '...';
  }
}