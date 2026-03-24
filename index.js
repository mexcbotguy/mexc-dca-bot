#!/usr/bin/env node

// Load config first (loads .env)
const config = require('./src/config');
const dcaBot = require('./src/dca-bot');

// ---------------------------------------------------------------------------
//  Banner
// ---------------------------------------------------------------------------

console.log('');
console.log('  ================================================================');
console.log('  |                                                              |');
console.log('  |       __  __ _______  ______    ____   ____    _             |');
console.log('  |      |  \\/  |  ___\\ \\/ / ___|  |  _ \\ / ___|  / \\            |');
console.log('  |      | |\\/| | |_   \\  / |      | | | | |     / _ \\           |');
console.log('  |      | |  | |  _|  /  \\ |___   | |_| | |___ / ___ \\          |');
console.log('  |      |_|  |_|_|   /_/\\_\\____|  |____/ \\____/_/   \\_\\         |');
console.log('  |                                                              |');
console.log('  |              Dollar Cost Average Trading Bot                 |');
console.log('  |                    MEXC Exchange                             |');
console.log('  |                                                              |');
console.log('  ================================================================');
console.log('');

if (config.DRY_RUN) {
  console.log('  *** DRY RUN MODE - No real trades will be executed ***');
  console.log('');
}

// ---------------------------------------------------------------------------
//  Signal Handling
// ---------------------------------------------------------------------------

let shuttingDown = false;

function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[SIGNAL] Received ${signal}`);
  dcaBot.stop();
  process.exit(0);
}

process.on('SIGINT',  () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  dcaBot.stop();
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  dcaBot.stop();
  process.exit(1);
});

// ---------------------------------------------------------------------------
//  Start
// ---------------------------------------------------------------------------

try {
  dcaBot.start();
} catch (err) {
  console.error('[FATAL] Failed to start bot:', err.message);
  console.error(err.stack);
  process.exit(1);
}
