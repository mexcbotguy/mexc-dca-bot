const Mexc = require('mexc-sdk');
const config = require('./config');

const client = new Mexc.Spot(config.MEXC_API_KEY, config.MEXC_API_SECRET);

// ---------------------------------------------------------------------------
//  Helpers
// ---------------------------------------------------------------------------

function parse(raw) {
  if (typeof raw === 'object') return raw;
  return JSON.parse(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
//  Public / Market Data
// ---------------------------------------------------------------------------

function getPrice(symbol) {
  const data = parse(client.tickerPrice(symbol || config.SYMBOL));
  return parseFloat(data.price);
}

function getExchangeInfo(symbol) {
  const data = parse(client.exchangeInfo({ symbol: symbol || config.SYMBOL }));
  return data;
}

function getDepth(symbol, limit) {
  const data = parse(client.depth(symbol || config.SYMBOL, { limit: limit || 10 }));
  return data;
}

function getKlines(symbol, interval, limit) {
  const data = parse(client.klines(symbol || config.SYMBOL, interval || '1h', { limit: limit || 100 }));
  return data;
}

// ---------------------------------------------------------------------------
//  Account
// ---------------------------------------------------------------------------

function getAccountInfo() {
  const data = parse(client.accountInfo());
  return data;
}

function getBalance(asset) {
  const info = getAccountInfo();
  const bal = info.balances.find((b) => b.asset === asset);
  if (!bal) return { free: 0, locked: 0 };
  return { free: parseFloat(bal.free), locked: parseFloat(bal.locked) };
}

// ---------------------------------------------------------------------------
//  Symbol Info Cache
// ---------------------------------------------------------------------------

let symbolInfoCache = null;

function getSymbolInfo(symbol) {
  if (symbolInfoCache) return symbolInfoCache;
  const info = getExchangeInfo(symbol || config.SYMBOL);
  const sym = info.symbols ? info.symbols[0] : null;
  if (!sym) {
    throw new Error(`Symbol ${symbol || config.SYMBOL} not found on exchange`);
  }

  // Extract precision / filters
  let pricePrecision = 2;
  let quantityPrecision = 6;
  let minQty = 0;
  let minNotional = 0;
  let stepSize = 0;
  let tickSize = 0;

  if (sym.quotePrecision) pricePrecision = sym.quotePrecision;
  if (sym.baseAssetPrecision) quantityPrecision = sym.baseAssetPrecision;

  if (sym.filters) {
    for (const f of sym.filters) {
      if (f.filterType === 'PRICE_FILTER') {
        tickSize = parseFloat(f.tickSize || 0);
        if (tickSize > 0) {
          pricePrecision = countDecimals(tickSize);
        }
      }
      if (f.filterType === 'LOT_SIZE') {
        minQty = parseFloat(f.minQty || 0);
        stepSize = parseFloat(f.stepSize || 0);
        if (stepSize > 0) {
          quantityPrecision = countDecimals(stepSize);
        }
      }
      if (f.filterType === 'MIN_NOTIONAL') {
        minNotional = parseFloat(f.minNotional || 0);
      }
    }
  }

  symbolInfoCache = {
    baseAsset: sym.baseAsset,
    quoteAsset: sym.quoteAsset,
    pricePrecision,
    quantityPrecision,
    minQty,
    minNotional,
    stepSize,
    tickSize,
  };
  return symbolInfoCache;
}

function countDecimals(num) {
  const str = num.toString();
  if (str.includes('e-')) {
    return parseInt(str.split('e-')[1], 10);
  }
  if (str.includes('.')) {
    return str.split('.')[1].length;
  }
  return 0;
}

function roundStep(value, step, precision) {
  if (step > 0) {
    const rounded = Math.floor(value / step) * step;
    return parseFloat(rounded.toFixed(precision));
  }
  return parseFloat(value.toFixed(precision));
}

function formatPrice(price) {
  const info = getSymbolInfo();
  return roundStep(price, info.tickSize, info.pricePrecision);
}

function formatQuantity(qty) {
  const info = getSymbolInfo();
  return roundStep(qty, info.stepSize, info.quantityPrecision);
}

// ---------------------------------------------------------------------------
//  Orders
// ---------------------------------------------------------------------------

function marketBuy(symbol, quoteAmount) {
  const sym = symbol || config.SYMBOL;
  if (config.DRY_RUN) {
    const price = getPrice(sym);
    const qty = quoteAmount / price;
    return {
      orderId: `DRY-${Date.now()}`,
      symbol: sym,
      side: 'BUY',
      type: 'MARKET',
      executedQty: formatQuantity(qty),
      cummulativeQuoteQty: quoteAmount,
      price: price,
      status: 'FILLED',
      dry: true,
    };
  }

  const data = parse(
    client.newOrder(sym, 'BUY', 'MARKET', {
      quoteOrderQty: quoteAmount,
      newOrderRespType: 'FULL',
    })
  );
  return data;
}

function marketSell(symbol, quantity) {
  const sym = symbol || config.SYMBOL;
  const qty = formatQuantity(quantity);

  if (config.DRY_RUN) {
    const price = getPrice(sym);
    return {
      orderId: `DRY-${Date.now()}`,
      symbol: sym,
      side: 'SELL',
      type: 'MARKET',
      executedQty: qty,
      cummulativeQuoteQty: qty * price,
      price: price,
      status: 'FILLED',
      dry: true,
    };
  }

  const data = parse(
    client.newOrder(sym, 'SELL', 'MARKET', {
      quantity: qty,
      newOrderRespType: 'FULL',
    })
  );
  return data;
}

function limitBuy(symbol, quantity, price) {
  const sym = symbol || config.SYMBOL;
  const qty = formatQuantity(quantity);
  const px = formatPrice(price);

  if (config.DRY_RUN) {
    return {
      orderId: `DRY-${Date.now()}`,
      symbol: sym,
      side: 'BUY',
      type: 'LIMIT',
      origQty: qty,
      price: px,
      status: 'NEW',
      dry: true,
    };
  }

  const data = parse(
    client.newOrder(sym, 'BUY', 'LIMIT', {
      quantity: qty,
      price: px,
      timeInForce: 'GTC',
      newOrderRespType: 'FULL',
    })
  );
  return data;
}

function cancelOrder(symbol, orderId) {
  const sym = symbol || config.SYMBOL;
  if (config.DRY_RUN) {
    return { orderId, symbol: sym, status: 'CANCELED', dry: true };
  }
  const data = parse(client.cancelOrder(sym, { orderId }));
  return data;
}

function getOpenOrders(symbol) {
  const sym = symbol || config.SYMBOL;
  if (config.DRY_RUN) return [];
  const data = parse(client.openOrders(sym));
  return Array.isArray(data) ? data : [];
}

// ---------------------------------------------------------------------------
//  Exports
// ---------------------------------------------------------------------------

module.exports = {
  client,
  getPrice,
  getExchangeInfo,
  getDepth,
  getKlines,
  getAccountInfo,
  getBalance,
  getSymbolInfo,
  formatPrice,
  formatQuantity,
  marketBuy,
  marketSell,
  limitBuy,
  cancelOrder,
  getOpenOrders,
  sleep,
};
