# MEXC DCA Bot

A Dollar Cost Averaging (DCA) trading bot for the MEXC exchange with safety orders,
take profit, and crash recovery.

## How DCA with Safety Orders Works

```
  Price
    ^
    |
    |  Entry @ $100 -----> [Base Order: 50 USDT]
    |      |
    |      |  -2.0% drop
    |      v
    |  $98.00 -----------> [Safety Order #1: 100 USDT]
    |      |                  New avg entry: ~$98.67
    |      |  -3.0% more
    |      v
    |  $95.00 -----------> [Safety Order #2: 150 USDT]
    |      |                  New avg entry: ~$96.33
    |      |  -4.5% more
    |      v
    |  $90.50 -----------> [Safety Order #3: 225 USDT]
    |      |                  New avg entry: ~$93.42
    |      |  -6.75% more
    |      v
    |  $83.75 -----------> [Safety Order #4: 337.50 USDT]
    |      |                  New avg entry: ~$89.06
    |      |  -10.125% more
    |      v
    |  $73.63 -----------> [Safety Order #5: 506.25 USDT]
    |                         New avg entry: ~$83.28
    |
    |
    +---------------------------------------------------> Time

  After safety orders lower the average, a smaller bounce triggers TP:

    Price
    ^
    |
    |             +1.5% TP triggered!
    |            / ~~~~~~ SELL ALL ~~~~~~> Profit!
    |           /
    |    avg---*
    |         /
    |   -----
    |  /  <-- Price recovers
    | /
    +---------------------------------------------------> Time
```

### The Key Insight

When price drops, safety orders buy MORE at the lower price, pulling your
average entry down significantly. You only need a small bounce from the
average (not back to the original entry) to hit take profit.

```
  Without Safety Orders:        With Safety Orders:
  Need +1.5% from $100          Need +1.5% from $83.28
  TP = $101.50                  TP = $84.53

  Price must recover to          Price only needs to bounce
  $101.50 (full recovery)        to $84.53 (much less!)
```

### Martingale Sizing

Each safety order is larger than the last, weighted toward lower prices:

```
  +------+----------+------------+-----------+
  | SO # | Drop %   | Order Size | Cumulative|
  +------+----------+------------+-----------+
  | Base | 0%       | 50 USDT    | 50 USDT   |
  | SO-1 | -2.00%   | 100 USDT   | 150 USDT  |
  | SO-2 | -5.00%   | 150 USDT   | 300 USDT  |
  | SO-3 | -9.50%   | 225 USDT   | 525 USDT  |
  | SO-4 | -16.25%  | 337.50 USDT| 862.50 USDT|
  | SO-5 | -26.38%  | 506.25 USDT| 1368.75 USDT|
  +------+----------+------------+-----------+
```

## Setup

1. Clone this repository

2. Install dependencies:
   ```bash
   cd mexc-dca-bot
   npm install
   ```

3. Create your configuration:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` with your settings:
   - Add your MEXC API key and secret
   - Choose your trading pair (default: BTCUSDT)
   - Configure order sizes and safety order parameters
   - Set take profit percentage

## Configuration Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `MEXC_API_KEY` | - | Your MEXC API key |
| `MEXC_API_SECRET` | - | Your MEXC API secret |
| `SYMBOL` | BTCUSDT | Trading pair |
| `BASE_ORDER_SIZE` | 50 | Quote amount for recurring DCA buys |
| `SAFETY_ORDER_SIZE` | 100 | Quote amount for first safety order |
| `SAFETY_ORDER_MULTIPLIER` | 1.5 | Multiply SO size each level |
| `SAFETY_ORDER_DEVIATION` | 2 | % drop for first safety order |
| `SAFETY_ORDER_STEP_SCALE` | 1.5 | Multiply deviation each level |
| `MAX_SAFETY_ORDERS` | 5 | Maximum safety orders per deal |
| `TAKE_PROFIT_PCT` | 1.5 | Sell all at this % above avg entry |
| `DCA_INTERVAL` | 3600000 | Time between base orders (ms) |
| `POLL_INTERVAL` | 10000 | Price check interval (ms) |
| `DRY_RUN` | true | Simulate trades with live prices |

## Running

### Dry Run Mode (recommended first)

```bash
npm run dry-run
```

### Live Trading

Set `DRY_RUN=false` in your `.env` file, then:

```bash
npm start
```

## Deal Lifecycle

```
  START
    |
    v
  [Place Base Order] -------> Buy X USDT worth
    |
    v
  [Monitor Price] <-----------+
    |                          |
    |--- Price >= TP -------> [SELL ALL] --> Profit! --> [New Deal]
    |                          |
    |--- Price drops X% ----> [Safety Order] --> recalc avg --> back to monitor
    |                          |
    |--- DCA timer fires ---> (only if no active deal)
    |
    v
  [SIGINT/SIGTERM] --> Save state --> Exit
```

## State Persistence

The bot saves its state to `dca-state.json` after every trade and on shutdown.
On restart, it automatically resumes any active deal. This file tracks:

- All entry positions (price, quantity, type)
- Safety orders placed
- Average entry price and take profit target
- Completed deals and total profit

## Risk Warning

- This bot executes real trades when `DRY_RUN=false`
- Maximum capital at risk equals base order + all safety orders combined
- Always test in dry run mode first
- Never risk more than you can afford to lose
- Past performance does not guarantee future results
