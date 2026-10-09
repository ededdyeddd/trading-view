# Discrepancies and assumptions

Sources: the Alloy snapshot (the main visual reference, a static DOM of one state), production TradingView Paper Trading (inspected on 2026-10-09, without submitting orders), and the Figma file for step 2 (calculation annotations only).

## Snapshot vs production

| Area | Alloy snapshot | Production | Prototype |
|---|---|---|---|
| Panel width | 315 px | ~400 px (resizable) | **320 px**, resizable from 300 to 480 (per the task) |
| Exits (SL/TP) | toggles | toggles | toggles (the task said "checkboxes"; the snapshot wins) |
| Exits order | Take profit, then Stop loss | same | same (in Figma SL comes first — that is for step 2) |
| "Order info" block (Trade value, Available margin…) | none | none | **not added**: below quantity there is only the Tick value row, as in both sources. Value, margin and real risk are computed in `TicketView.qty` for the new panel |
| Submit button text | `1 AIR @ 190.20 LIMIT` | `27 TSLA MARKET` / `@ … STOP` | as in production: `MARKET` / `LIMIT` / `STOP` (the task's example said `MKT`) |
| Shift+T | — | opens the bottom Paper Trading panel | **opens/closes the order panel** (per the task) |
| Trade button in the header | present | opens the order panel | opens the order panel (the task listed it as a stub) |
| Upgrade button in the header | present | present | replaced with **Publish** (stub), as listed in the task |
| Symbol | AIR (EUR, BME) | TSLA | AAPL by default; the watchlist has three groups: Stocks / Crypto / Forex (indices and futures removed by agreement) |
| "Time to upgrade?" pop-up, FullStory | present | — | not carried over |

## Production behaviors reproduced deliberately (control variant)

- The price **does not follow the market** after the ticket opens, and is not recalculated when the side or type changes. So switching to Sell Stop easily leaves the price above Bid: the field turns red, a tooltip reads "Selected price isn't valid for this order type", and the button is disabled.
- **Buy Limit above Ask** (or Sell Limit below Bid) executes immediately at Ask/Bid and the panel shows no warning. `TicketView.price.fillsNow` exists for the new panel, but `current` ignores it.
- The hint in the price field shows the offset in ticks: `Ask`, `Ask − 13`, `Bid + 15`.
- An untouched TP in `price` mode follows the entry at +75 ticks; SL defaults to 25 ticks.
- Quantity units: Shares / USD / % balance / Risk USD / Risk % balance. The right side of the field shows the equivalent; risk units without a SL show ∅.
- When both SL and TP are on, the panel shows **Risk / Reward** and **+ Add level**.

## Simplifications (agreed: not overbuilding the current panel)

- **⇆** (Price ↔ Price offset, Shares ↔ USD) is drawn but does nothing. Inputting in other units is available through the unit dropdowns.
- **DOM**, **+ Add level**, the "⋯" menu (Undock, Trading settings, "SL enables quantity in risk") and the **Fill outside RTH** checkboxes are stubs (the checkbox state is stored but the engine ignores it).
- Drawing tools, Indicators, Alert, Replay, the date ranges under the chart, Publish — stubs.
- Analytics, Balance history and Trade history from production are not built. The bottom panel has the tabs from the task: Positions, Orders, History, Account Summary, Notifications log.
- The order Modify dialog changes quantity and price. Bracket legs change price only.

## Engine (paperEngine) — assumptions

- Balance 100,000 USD; balance = initial + realized P&L, no commissions.
- Margin: stocks 2% of value; crypto and forex use the symbol's `leverage` (BTC/ETH ×2, forex ×50). Account margin is computed at the current price; Orders margin covers working entry orders.
- Unrealized P&L is marked at the price where the position would close (long at Bid, short at Ask), so straight after a market fill the P&L is negative by the spread.
- Market: Buy fills at Ask, Sell at Bid. Marketable Limit fills immediately at Ask/Bid. A resting Limit fills **at its own price** once Ask ≤ limit (Buy) or Bid ≥ limit (Sell). Stop triggers at Ask ≥ stop (Buy) or Bid ≤ stop (Sell) and fills at Ask/Bid (slippage on a gap is possible).
- Validation: a Buy Stop must be above Ask and a Sell Stop below Bid; SL/TP must be on the correct side of entry; margin is checked against Available funds. Violations become a `Rejected` order and a toast.
- Brackets: after the entry fills, a TP (Limit) and a SL (Stop) are created on the opposite side with the same quantity, linked by OCO. Bracket legs never expire (GTC). If the position goes flat (closed by button or by a bracket), the remaining legs are cancelled.
- Changing an entry's price shifts its SL/TP by the same distance (like dragging the line on the chart).
- Positions are netted per symbol (averaged entry, partial close, reversal).
- TIF: Day = until 23:59:59 local time today; Week = until the end of the day 7 days later (production shows "Week · Oct 15" for Oct 8); Month = +1 calendar month; GTD = end of the chosen day. Market orders have no expiry. Expiry is checked once a second and on load.
- State (orders, positions, history, notifications log) is stored in `localStorage` (`paper-trading:v1`), with every access wrapped in try/catch. Reset account is in Account Summary and in the debug menu.

## Data

- Quotes from every source pass through a single store and are flushed once per frame (rAF, with a 100 ms fallback for background tabs). The chart, watchlist, quick-trade buttons, ticket, P&L and engine all read the same quote.
- The chart's live candle is built from `last`. The quick-trade buttons and ticket show Bid/Ask.
- `Quote` has an extra optional `size` field (trade volume) used to grow the volume of the live candle.
- The sim's volatility is boosted 3× relative to the realistic intraday level so prices visibly move and limit/stop orders fill within a short session.
- Finnhub Bid/Ask: `bid = floor((last − 0.005) / tick) × tick`, `ask = bid + 0.01`, which keeps both on the tick grid.
- The lightweight-charts attribution logo (Apache 2.0) is left in the corner of the chart, as the library requires. No TradingView assets or logos are used: symbol logos are generated letter circles, and icons come from Lucide.
- The time axis is UTC (as in production, "10:55:41 UTC").

## Figma (step 2) — what the model already covers

The calculation tables from the annotations (quantity in 5 units, Limit offset from Ask, SL/TP in 5 units, "from entry", Real risk with rounding down, R:R) are covered by `orderMath` and `deriveTicket` tests using the same numbers (entry 201.57, balance 99,953.90, SL 197.50 → 98 / 122 shares, 398.86 / 496.54 USD …). The disabled-button texts from the mockups ("Enter quantity to buy AAPL", "Enter price and quantity", "Set stop loss to calculate size") are available in `TicketView.disabledText`.
