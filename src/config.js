const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

function envRequired(key) {
  const val = process.env[key];
  if (!val || val.trim() === '' || val === 'your_api_key_here' || val === 'your_api_secret_here') {
    if (process.env.DRY_RUN === 'true' || process.env.DRY_RUN === '1') {
      return val || '';
    }
    console.error(`[CONFIG] Missing required environment variable: ${key}`);
    process.exit(1);
  }
  return val.trim();
}

function envFloat(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseFloat(val);
  if (isNaN(n)) {
    console.error(`[CONFIG] Invalid number for ${key}: ${val}`);
    process.exit(1);
  }
  return n;
}

function envInt(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  const n = parseInt(val, 10);
  if (isNaN(n)) {
    console.error(`[CONFIG] Invalid integer for ${key}: ${val}`);
    process.exit(1);
  }
  return n;
}

function envBool(key, fallback) {
  const val = process.env[key];
  if (val === undefined || val === '') return fallback;
  return val === 'true' || val === '1';
}

const config = {
  // API credentials
  MEXC_API_KEY:     envRequired('MEXC_API_KEY'),
  MEXC_API_SECRET:  envRequired('MEXC_API_SECRET'),

  // Trading pair
  SYMBOL:           (process.env.SYMBOL || 'BTCUSDT').trim().toUpperCase(),

  // Base order
  BASE_ORDER_SIZE:  envFloat('BASE_ORDER_SIZE', 50),

  // Safety orders
  SAFETY_ORDER_SIZE:        envFloat('SAFETY_ORDER_SIZE', 100),
  SAFETY_ORDER_MULTIPLIER:  envFloat('SAFETY_ORDER_MULTIPLIER', 1.5),
  SAFETY_ORDER_DEVIATION:   envFloat('SAFETY_ORDER_DEVIATION', 2),
  SAFETY_ORDER_STEP_SCALE:  envFloat('SAFETY_ORDER_STEP_SCALE', 1.5),
  MAX_SAFETY_ORDERS:        envInt('MAX_SAFETY_ORDERS', 5),

  // Take profit
  TAKE_PROFIT_PCT:  envFloat('TAKE_PROFIT_PCT', 1.5),

  // Timing
  DCA_INTERVAL:     envInt('DCA_INTERVAL', 3600000),
  POLL_INTERVAL:    envInt('POLL_INTERVAL', 10000),

  // Mode
  DRY_RUN:          envBool('DRY_RUN', true),
};

// Validate ranges
if (config.BASE_ORDER_SIZE <= 0) {
  console.error('[CONFIG] BASE_ORDER_SIZE must be > 0');
  process.exit(1);
}
if (config.SAFETY_ORDER_SIZE <= 0) {
  console.error('[CONFIG] SAFETY_ORDER_SIZE must be > 0');
  process.exit(1);
}
if (config.SAFETY_ORDER_MULTIPLIER < 1) {
  console.error('[CONFIG] SAFETY_ORDER_MULTIPLIER must be >= 1');
  process.exit(1);
}
if (config.SAFETY_ORDER_DEVIATION <= 0) {
  console.error('[CONFIG] SAFETY_ORDER_DEVIATION must be > 0');
  process.exit(1);
}
if (config.SAFETY_ORDER_STEP_SCALE < 1) {
  console.error('[CONFIG] SAFETY_ORDER_STEP_SCALE must be >= 1');
  process.exit(1);
}
if (config.MAX_SAFETY_ORDERS < 0) {
  console.error('[CONFIG] MAX_SAFETY_ORDERS must be >= 0');
  process.exit(1);
}
if (config.TAKE_PROFIT_PCT <= 0) {
  console.error('[CONFIG] TAKE_PROFIT_PCT must be > 0');
  process.exit(1);
}
if (config.DCA_INTERVAL < 1000) {
  console.error('[CONFIG] DCA_INTERVAL must be >= 1000ms');
  process.exit(1);
}
if (config.POLL_INTERVAL < 1000) {
  console.error('[CONFIG] POLL_INTERVAL must be >= 1000ms');
  process.exit(1);
}

module.exports = config;
