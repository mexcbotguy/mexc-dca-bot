const fs = require('fs');
const path = require('path');
const config = require('./config');
const exchange = require('./exchange');

const STATE_FILE = path.resolve(__dirname, '..', 'dca-state.json');

// ---------------------------------------------------------------------------
//  State
// ---------------------------------------------------------------------------

function defaultState() {
  return {
    // Current deal
    active: false,                // Is there an active deal?
    entries: [],                  // [{ price, quantity, quoteSpent, timestamp, type }]
    safetyOrdersPlaced: 0,       // How many safety orders have triggered
    totalQuantity: 0,            // Total base asset accumulated
    totalQuoteSpent: 0,          // Total quote currency spent
    avgEntryPrice: 0,            // Weighted average entry price
    takeProfitPrice: 0,          // Current TP target

    // Scheduling
    lastBaseOrderTime: 0,        // Timestamp of last base order
    nextBaseOrderTime: 0,        // When next base order fires

    // Stats
    completedDeals: 0,
    totalProfit: 0,
    startedAt: null,
  };
}

let state = defaultState();

// ---------------------------------------------------------------------------
//  State Persistence
// ---------------------------------------------------------------------------

function saveState() {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('[STATE] Failed to save state:', e.message);
  }
}

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf-8');
      const saved = JSON.parse(raw);
      state = { ...defaultState(), ...saved };
      console.log('[STATE] Restored state from dca-state.json');
      console.log(`        Active deal: ${state.active}`);
      console.log(`        Entries: ${state.entries.length}`);
      console.log(`        Safety orders placed: ${state.safetyOrdersPlaced}`);
      console.log(`        Completed deals: ${state.completedDeals}`);
      console.log(`        Total profit: ${state.totalProfit.toFixed(4)}`);
      return true;
    }
  } catch (e) {
    console.error('[STATE] Failed to load state:', e.message);
  }
  return false;
}

function clearState() {
  const keep = {
    completedDeals: state.completedDeals,
    totalProfit: state.totalProfit,
    startedAt: state.startedAt,
  };
  state = { ...defaultState(), ...keep };
  saveState();
}

// ---------------------------------------------------------------------------
//  Safety Order Levels
// ---------------------------------------------------------------------------

function computeSafetyLevels(initialPrice) {
  const levels = [];
  let cumulativeDeviation = 0;
  let orderSize = config.SAFETY_ORDER_SIZE;

  for (let i = 0; i < config.MAX_SAFETY_ORDERS; i++) {
    // Deviation for this level
    const deviation = i === 0
      ? config.SAFETY_ORDER_DEVIATION
      : config.SAFETY_ORDER_DEVIATION * Math.pow(config.SAFETY_ORDER_STEP_SCALE, i);

    cumulativeDeviation += deviation;

    const triggerPrice = initialPrice * (1 - cumulativeDeviation / 100);

    // Order size with martingale multiplier
    if (i > 0) {
      orderSize = config.SAFETY_ORDER_SIZE * Math.pow(config.SAFETY_ORDER_MULTIPLIER, i);
    }

    levels.push({
      level: i + 1,
      deviation: cumulativeDeviation,
      triggerPrice,
      quoteAmount: orderSize,
    });
  }
  return levels;
}

// ---------------------------------------------------------------------------
//  Core Logic
// ---------------------------------------------------------------------------

function recalculate() {
  if (state.entries.length === 0) {
    state.totalQuantity = 0;
    state.totalQuoteSpent = 0;
    state.avgEntryPrice = 0;
    state.takeProfitPrice = 0;
    return;
  }

  let totalQty = 0;
  let totalQuote = 0;
  for (const e of state.entries) {
    totalQty += e.quantity;
    totalQuote += e.quoteSpent;
  }

  state.totalQuantity = totalQty;
  state.totalQuoteSpent = totalQuote;
  state.avgEntryPrice = totalQty > 0 ? totalQuote / totalQty : 0;
  state.takeProfitPrice = state.avgEntryPrice * (1 + config.TAKE_PROFIT_PCT / 100);
}

function executeBaseOrder() {
  const price = exchange.getPrice();
  console.log(`\n[BASE ORDER] Placing base order - ${config.BASE_ORDER_SIZE} ${getQuoteAsset()} at ~${price}`);

  const result = exchange.marketBuy(config.SYMBOL, config.BASE_ORDER_SIZE);
  const filledQty = parseFloat(result.executedQty || 0);
  const filledQuote = parseFloat(result.cummulativeQuoteQty || config.BASE_ORDER_SIZE);
  const filledPrice = filledQty > 0 ? filledQuote / filledQty : price;

  const entry = {
    price: filledPrice,
    quantity: filledQty,
    quoteSpent: filledQuote,
    timestamp: Date.now(),
    type: 'BASE',
  };

  state.entries.push(entry);
  state.active = true;
  state.lastBaseOrderTime = Date.now();
  state.nextBaseOrderTime = Date.now() + config.DCA_INTERVAL;

  // If this is the first entry of a new deal, reset safety orders counter
  if (state.entries.length === 1) {
    state.safetyOrdersPlaced = 0;
  }

  recalculate();
  saveState();

  console.log(`[BASE ORDER] Filled: ${filledQty} ${getBaseAsset()} @ ${filledPrice.toFixed(8)}`);
  printDealStatus();
}

function executeSafetyOrder(level, quoteAmount) {
  const price = exchange.getPrice();
  console.log(`\n[SAFETY ORDER #${level}] Triggered! Buying ${quoteAmount.toFixed(2)} ${getQuoteAsset()} at ~${price}`);

  const result = exchange.marketBuy(config.SYMBOL, quoteAmount);
  const filledQty = parseFloat(result.executedQty || 0);
  const filledQuote = parseFloat(result.cummulativeQuoteQty || quoteAmount);
  const filledPrice = filledQty > 0 ? filledQuote / filledQty : price;

  const entry = {
    price: filledPrice,
    quantity: filledQty,
    quoteSpent: filledQuote,
    timestamp: Date.now(),
    type: `SAFETY_${level}`,
  };

  state.entries.push(entry);
  state.safetyOrdersPlaced = level;

  recalculate();
  saveState();

  console.log(`[SAFETY ORDER #${level}] Filled: ${filledQty} ${getBaseAsset()} @ ${filledPrice.toFixed(8)}`);
  printDealStatus();
}

function executeTakeProfit() {
  const price = exchange.getPrice();
  console.log(`\n[TAKE PROFIT] Price ${price} >= TP ${state.takeProfitPrice.toFixed(8)} - Selling all!`);

  const qty = state.totalQuantity;
  const result = exchange.marketSell(config.SYMBOL, qty);
  const filledQuote = parseFloat(result.cummulativeQuoteQty || qty * price);
  const profit = filledQuote - state.totalQuoteSpent;
  const profitPct = (profit / state.totalQuoteSpent) * 100;

  console.log(`[TAKE PROFIT] Sold ${qty} ${getBaseAsset()} for ${filledQuote.toFixed(4)} ${getQuoteAsset()}`);
  console.log(`[TAKE PROFIT] Invested: ${state.totalQuoteSpent.toFixed(4)} ${getQuoteAsset()}`);
  console.log(`[TAKE PROFIT] Profit: ${profit >= 0 ? '+' : ''}${profit.toFixed(4)} ${getQuoteAsset()} (${profitPct >= 0 ? '+' : ''}${profitPct.toFixed(2)}%)`);
  console.log(`[TAKE PROFIT] Deal completed with ${state.entries.length} entries (${state.safetyOrdersPlaced} safety orders)`);

  state.completedDeals++;
  state.totalProfit += profit;

  // Reset for next deal
  clearState();
  console.log(`\n[STATS] Completed deals: ${state.completedDeals} | Total profit: ${state.totalProfit.toFixed(4)} ${getQuoteAsset()}`);
}

// ---------------------------------------------------------------------------
//  Price Check Loop
// ---------------------------------------------------------------------------

function checkPrice() {
  try {
    const currentPrice = exchange.getPrice();

    if (!state.active) return;

    // Check take profit
    if (state.takeProfitPrice > 0 && currentPrice >= state.takeProfitPrice) {
      executeTakeProfit();
      return;
    }

    // Check safety orders
    if (state.safetyOrdersPlaced < config.MAX_SAFETY_ORDERS && state.entries.length > 0) {
      const initialPrice = state.entries[0].price;
      const levels = computeSafetyLevels(initialPrice);

      for (let i = state.safetyOrdersPlaced; i < levels.length; i++) {
        const lvl = levels[i];
        if (currentPrice <= lvl.triggerPrice) {
          executeSafetyOrder(lvl.level, lvl.quoteAmount);
          // Re-check in case multiple levels triggered (price crashed)
          // but only one at a time to be safe
          break;
        }
      }
    }
  } catch (e) {
    console.error('[POLL] Error checking price:', e.message);
  }
}

// ---------------------------------------------------------------------------
//  DCA Timer
// ---------------------------------------------------------------------------

function checkDcaTimer() {
  const now = Date.now();

  // First base order
  if (!state.active && state.entries.length === 0) {
    executeBaseOrder();
    return;
  }

  // Recurring base orders only if no active deal
  // (In standard DCA-bot mode, new base orders start new deals after TP)
  // If there IS an active deal, we skip base orders and let safety orders handle it
  if (!state.active && now >= state.nextBaseOrderTime) {
    executeBaseOrder();
  }
}

// ---------------------------------------------------------------------------
//  Display
// ---------------------------------------------------------------------------

let _quoteAsset = null;
let _baseAsset = null;

function getQuoteAsset() {
  if (_quoteAsset) return _quoteAsset;
  try {
    const info = exchange.getSymbolInfo();
    _quoteAsset = info.quoteAsset;
    _baseAsset = info.baseAsset;
  } catch (e) {
    // Fallback: derive from symbol
    if (config.SYMBOL.endsWith('USDT')) {
      _quoteAsset = 'USDT';
      _baseAsset = config.SYMBOL.replace('USDT', '');
    } else {
      _quoteAsset = 'QUOTE';
      _baseAsset = 'BASE';
    }
  }
  return _quoteAsset;
}

function getBaseAsset() {
  if (!_baseAsset) getQuoteAsset();
  return _baseAsset;
}

function printDealStatus() {
  if (!state.active) return;

  const currentPrice = exchange.getPrice();
  const unrealizedValue = state.totalQuantity * currentPrice;
  const unrealizedPnl = unrealizedValue - state.totalQuoteSpent;
  const pnlPct = state.totalQuoteSpent > 0 ? (unrealizedPnl / state.totalQuoteSpent) * 100 : 0;

  console.log('');
  console.log('  +-----------------------------------------+');
  console.log('  |           ACTIVE DEAL STATUS            |');
  console.log('  +-----------------------------------------+');
  console.log(`  | Entries:       ${String(state.entries.length).padStart(24)} |`);
  console.log(`  | Safety Orders: ${String(state.safetyOrdersPlaced + '/' + config.MAX_SAFETY_ORDERS).padStart(24)} |`);
  console.log(`  | Avg Entry:     ${String(state.avgEntryPrice.toFixed(8)).padStart(24)} |`);
  console.log(`  | Current Price: ${String(currentPrice.toFixed(8)).padStart(24)} |`);
  console.log(`  | TP Target:     ${String(state.takeProfitPrice.toFixed(8)).padStart(24)} |`);
  console.log(`  | Total Qty:     ${String(state.totalQuantity.toFixed(8)).padStart(24)} |`);
  console.log(`  | Invested:      ${String(state.totalQuoteSpent.toFixed(4) + ' ' + getQuoteAsset()).padStart(24)} |`);
  console.log(`  | Value:         ${String(unrealizedValue.toFixed(4) + ' ' + getQuoteAsset()).padStart(24)} |`);
  console.log(`  | P&L:           ${String((unrealizedPnl >= 0 ? '+' : '') + unrealizedPnl.toFixed(4) + ' (' + pnlPct.toFixed(2) + '%)').padStart(24)} |`);
  console.log('  +-----------------------------------------+');
  console.log('');
}

function printSafetyLevels(initialPrice) {
  if (!initialPrice) {
    try {
      initialPrice = exchange.getPrice();
    } catch (e) {
      console.log('[INFO] Cannot fetch price for safety level display');
      return;
    }
  }

  const levels = computeSafetyLevels(initialPrice);
  console.log(`\n  Safety Order Levels (from entry @ ${initialPrice}):`);
  console.log('  +-------+----------+----------------+------------------+');
  console.log('  | Level | Drop %   | Trigger Price  | Order Size       |');
  console.log('  +-------+----------+----------------+------------------+');
  for (const lvl of levels) {
    console.log(
      `  | SO-${String(lvl.level).padEnd(2)} | ${String(lvl.deviation.toFixed(2) + '%').padEnd(8)} | ${String(lvl.triggerPrice.toFixed(4)).padStart(14)} | ${String(lvl.quoteAmount.toFixed(2) + ' ' + getQuoteAsset()).padStart(16)} |`
    );
  }
  console.log('  +-------+----------+----------------+------------------+');

  // Total max investment
  let totalMax = config.BASE_ORDER_SIZE;
  for (const lvl of levels) {
    totalMax += lvl.quoteAmount;
  }
  console.log(`  Max investment if all SOs trigger: ${totalMax.toFixed(2)} ${getQuoteAsset()}\n`);
}

function printConfig() {
  console.log('  +-------------------------------------------+');
  console.log('  |              CONFIGURATION                |');
  console.log('  +-------------------------------------------+');
  console.log(`  | Symbol:          ${String(config.SYMBOL).padStart(23)} |`);
  console.log(`  | Base Order:      ${String(config.BASE_ORDER_SIZE + ' ' + getQuoteAsset()).padStart(23)} |`);
  console.log(`  | Safety Order:    ${String(config.SAFETY_ORDER_SIZE + ' ' + getQuoteAsset()).padStart(23)} |`);
  console.log(`  | SO Multiplier:   ${String(config.SAFETY_ORDER_MULTIPLIER + 'x').padStart(23)} |`);
  console.log(`  | SO Deviation:    ${String(config.SAFETY_ORDER_DEVIATION + '%').padStart(23)} |`);
  console.log(`  | SO Step Scale:   ${String(config.SAFETY_ORDER_STEP_SCALE + 'x').padStart(23)} |`);
  console.log(`  | Max SOs:         ${String(config.MAX_SAFETY_ORDERS).padStart(23)} |`);
  console.log(`  | Take Profit:     ${String(config.TAKE_PROFIT_PCT + '%').padStart(23)} |`);
  console.log(`  | DCA Interval:    ${String(formatMs(config.DCA_INTERVAL)).padStart(23)} |`);
  console.log(`  | Poll Interval:   ${String(formatMs(config.POLL_INTERVAL)).padStart(23)} |`);
  console.log(`  | Mode:            ${String(config.DRY_RUN ? 'DRY RUN (simulated)' : 'LIVE TRADING').padStart(23)} |`);
  console.log('  +-------------------------------------------+');
}

function formatMs(ms) {
  if (ms >= 86400000) return (ms / 86400000).toFixed(1) + 'd';
  if (ms >= 3600000) return (ms / 3600000).toFixed(1) + 'h';
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
  return (ms / 1000).toFixed(1) + 's';
}

// ---------------------------------------------------------------------------
//  Main Loop
// ---------------------------------------------------------------------------

let running = false;
let pollTimer = null;
let dcaTimer = null;

function start() {
  if (!state.startedAt) {
    state.startedAt = new Date().toISOString();
  }

  loadState();
  running = true;

  printConfig();

  // Show safety levels preview
  try {
    const price = exchange.getPrice();
    console.log(`\n  Current ${config.SYMBOL} price: ${price}`);
    printSafetyLevels(price);
  } catch (e) {
    console.log(`\n  [WARN] Could not fetch price: ${e.message}`);
  }

  // Recalculate from restored state
  if (state.entries.length > 0) {
    recalculate();
    console.log('[BOT] Resuming active deal...');
    printDealStatus();
  }

  // Immediate first base order if no active deal
  if (!state.active || state.entries.length === 0) {
    console.log('[BOT] Starting first DCA deal...');
    try {
      executeBaseOrder();
    } catch (e) {
      console.error('[BOT] Failed to execute base order:', e.message);
    }
  }

  // Poll loop for price checks (safety orders + TP)
  pollTimer = setInterval(() => {
    if (!running) return;
    checkPrice();
  }, config.POLL_INTERVAL);

  // DCA timer for recurring base orders
  dcaTimer = setInterval(() => {
    if (!running) return;
    checkDcaTimer();
  }, Math.min(config.DCA_INTERVAL, 60000)); // Check at least every 60s

  // Periodic status log
  setInterval(() => {
    if (!running || !state.active) return;
    try {
      const price = exchange.getPrice();
      const pnlPct = state.totalQuoteSpent > 0
        ? ((state.totalQuantity * price - state.totalQuoteSpent) / state.totalQuoteSpent * 100)
        : 0;
      const nextBase = state.nextBaseOrderTime > 0
        ? formatMs(Math.max(0, state.nextBaseOrderTime - Date.now()))
        : 'N/A';
      console.log(
        `[TICK] ${config.SYMBOL} ${price.toFixed(4)} | Avg: ${state.avgEntryPrice.toFixed(4)} | TP: ${state.takeProfitPrice.toFixed(4)} | P&L: ${pnlPct.toFixed(2)}% | SOs: ${state.safetyOrdersPlaced}/${config.MAX_SAFETY_ORDERS} | Deals: ${state.completedDeals}`
      );
    } catch (e) { /* ignore */ }
  }, 60000);

  console.log(`\n[BOT] Running. Polling every ${formatMs(config.POLL_INTERVAL)}, DCA every ${formatMs(config.DCA_INTERVAL)}`);
  console.log('[BOT] Press Ctrl+C to stop gracefully.\n');
}

function stop() {
  console.log('\n[BOT] Shutting down...');
  running = false;

  if (pollTimer) clearInterval(pollTimer);
  if (dcaTimer) clearInterval(dcaTimer);

  saveState();

  console.log('[BOT] State saved. Goodbye.');
  console.log(`[STATS] Completed deals: ${state.completedDeals} | Total profit: ${state.totalProfit.toFixed(4)}`);

  if (state.active) {
    console.log('[NOTE] Active deal preserved. Bot will resume on next start.');
  }
}

// ---------------------------------------------------------------------------
//  Exports
// ---------------------------------------------------------------------------

module.exports = {
  start,
  stop,
  state,
  computeSafetyLevels,
  printDealStatus,
  printSafetyLevels,
  printConfig,
};
