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

---

# Step 2a — new panel (`?panel=new`), Market

Sources: the 2a prompt and Figma (`4086:71721` Market · Empty, `4086:72133` Market · Filled, DS error state `4106:78213`). There is no `docs/PRD.md` in the repo; we agreed to work from the prompt and Figma. Frame screenshots are in `reference/figma/`, ours are in `docs/screenshots/new/`.

## Decisions agreed with the designer

- **Field radius** is 6 px everywhere (in Empty the quantity field is 8, everywhere else 6).
- **Active Sell** mirrors Buy: solid `#f23645` with white text (not in the mockup).
- **Field error**: the DS state is a 2 px `#f23645` border with no icon, plus red caption text under the field that repeats the button's reason. Warning is the same with an orange border (`#f57c00`) and caption (`#e65100`); in 2a it only shows in the sandbox.
- **New-panel defaults**: quantity is empty; enabling a level fills SL −2% / TP +4% from entry (rounded to the tick); disabling clears it. `current` keeps its own defaults (1 share, TP 75 / SL 25 ticks).
- **Toasts**: in `new`, a market fill shows "Bought 100 AAPL at 201.57" with a **Close position** button for 8 s. In `current`, toasts stay as in production.
- **Time in force**: English, format `Week · Oct 16`, where the date is today + 7 days (Figma shows Oct 15 because the mockup was made on Oct 8). Periods: Day / Week / Month / GTD; 2a uses Week and the row does not expand.
- **Logo**: the mockup has the TradingView logo, which we don't copy, so we show a generated letter. The "≈" status icon (data not official) is drawn with tokens.
- **Not enough margin** is checked in the ticket model (`view.marginExceeded`), and the button is disabled before submit. In `current`, as in production, the order goes through and the engine rejects it.

## Discrepancies and clarifications

- **SL table, row "Risk % balance 0.41 % → −407.00 USD"**: 0.41 % of 99,953.90 is 409.81 USD, which gives level 197.47 / −409.00 USD. The table numbers come from 197.50 (0.407 %) with the display rounded to 0.41. The tests enter 0.4072 and check that the display reads "0.41 % of balance"; the same applies to TP 0.94 % (0.9434).
- **Sell**: "mirrors signs" is read as follows. The money of a level keeps its meaning (SL is always −, TP always +), while the caption shows the real price change from entry. For a Sell SL above entry that is "+4.07 (+2.19%) from entry".
- **"Close position" in the toast** undoes exactly the order that was just sent: it cancels its SL/TP and sends an opposite market order for the same quantity. If the position already existed, the earlier part stays — otherwise the button would close more than the user just bought.
- **Validation messages**: `Stop loss must be below entry` (without "price"), `Take profit must be above entry`, `Not enough margin`. Check order: quantity → SL → TP → margin. The quantity field shows `Not enough margin · Available … USD`.
- **Limit / Stop** tabs are visible but do not switch; clicking shows "Limit and Stop are coming soon" (2b). **Risk USD / Risk % balance** in the quantity menu are disabled with the label "Soon". **+ Add level** shows a "Coming soon" tooltip; it appears once at least one level is on (as in Filled; there is none in Empty).
- **Summary above the button** shows only valid levels and only when the order can be submitted (the table has no summary on errors).
- **Risk / Reward** reads `1 : 2.32`, with thin spaces around "/" in the label as in the mockup.
- When the symbol changes, the new panel clears quantity and levels but keeps side, type and units.

## Geometry check (`?sandbox=panel&panel=new&freeze=1`, 320 × 762)

Element y-coordinates match the Figma frames exactly:

| | Figma | Prototype |
|---|---|---|
| Order/DOM · Sell/Buy · tabs | 48 · 98 · 166 | 48 · 98 · 166 |
| Quantity: label · field · caption | 210 · 234 · 268 | 210 · 234 · 268 |
| Exits · SL label · SL field | 308 · 338 · 364 | 308 · 338 · 364 |
| Empty: TP label · field · Time in force · Extra | 414 · 440 · 494 · 532 | 414 · 440 · 494 · 532 |
| Filled: SL caption · TP label · TP field · TP caption | 398 · 430 · 456 · 490 | 398 · 430 · 456 · 490 |
| Filled: R:R · Add level · Time in force · Extra | 520 · 562 · 600 · 638 | 520 · 562 · 600 · 638 |
| Footer: block 96, button inside at +36, 16 below | ✓ | ✓ |

Fixed during the check: switch row height (+2 px), "Add level" row height (+3 px), gap between summary and button (8 → 10).

Remaining visual differences (not geometry): the logo (agreed), the system font instead of SF Pro in Figma (identical on macOS), lucide icons instead of TradingView icons.

---

# Step 2b — Limit, Stop, risk-first, study readiness

Source: `docs/PRD.md` (exported from the PRD doc, Appendix C is the 2b prompt) + Figma `4086:72785` / `4086:72830`. The PRD version of the prompt adds block 7 "Submitting Limit and Stop" (toast with Cancel), so the blocks are renumbered: 8 — chart lines, 9 — study.

## New Figma frames (checked with get_metadata)

- `4108:37852` "Volume selection dropdown": 4 items (Shares, USD ⓘ, % balance ⓘ, Risk USD ⓘ), no live values. **Decision: 5 items with live values** (as in 2a and PRD FR-5.1, "Menu… with live values" — "later").
- `4105:78057` — Exits on a grey container. **Decision: keep the approved Market/Limit Filled.**
- `4105:77647` — a copy of Market · Filled, no changes.

## Decisions and discrepancies

- **Button reason texts** follow the prompt / PRD FR-8.5 ("Stop loss must be below entry", "Not enough margin"…), not the Figma note format ("Set stop loss below 201.57", "Reduce to 495 shares").
- **Ticks from Ask/Bid**: the input is always positive, the direction is fixed by type and side ("257 ticks below" for Buy Limit, "… above" for Buy Stop / Sell Limit). In tick mode the price follows the market (an offset is an offset); a price that "fills now" can only be entered as a price.
- **Max shares by margin**: `floor(99,953.90 / (201.57 × 2%)) = floor(24,793.84) = 24,793`. The prompt says 24,794 (rounded rather than floored); we follow the PRD formula with `floor`.
- **"Margin 398.00 · Tick 1.00 USD"** in Figma Limit · Filled is missing "USD" after the margin — treated as a typo, we show "Margin 398.00 USD".
- **The "% balance" suffix** for quantity stays "%" (the 2a table: "20 %"); "Risk % balance" shows "% of balance" (the 2b table: "0.5 % of balance").
- **Not enough margin** now reads as in PRD FR-5.5 in every quantity mode: "Not enough margin for {shares} shares · max {maxShares}" (2a showed "Available …").
- **Risk is below 1 share**: button "Risk is below 1 share" (FR-8.5 has no text for this; we took the caption's wording).
- **A Stop beyond the market** (Buy Stop ≤ Ask, Sell Stop ≥ Bid): in `new` this is an orange "Triggers now…" warning and the order goes through and executes at the touch. **Changed in the engine:** it used to reject such a stop, now it triggers immediately. `current` still blocks the button, as in production.
- **Risk modes at Market**: the quantity is recomputed no more than once every 500 ms (the derivation uses a throttled quote; the Bid/Ask buttons stay live).
- **Several TP levels** (no mockups): "+ Add level" → TP 2 / TP 3 below TP 1. Each level has a "% of position" field; by default 100 → 50/50 → 33/33/34. A level cannot be set above what remains (the input is capped); "12% left" appears when the levels add up to less than 100. A new level's default price is one more TP 1 distance further out. Levels share TP 1's unit (a single menu). Remove with ✕. In the engine every TP leg reduces the SL by its quantity, and the SL cancels every remaining TP. The summary is "TP +… USD (3 levels)", and R:R uses the quantity-weighted TP distance.
- **Time in force**: the row opens a menu "Day · till Oct 9 / Week · till Oct 16 / Month · till Nov 9 / GTD · pick a date". GTD offers date and time fields, earliest tomorrow; with no time set the order lasts to the end of the day. Limit/Stop: "till Oct 16" (GTD with a time: "till Oct 20 14:30") on the button. `?expireFast=1`: Day = 1 min, Week = 3 min, Month = 10 min.
- **Market closed**: `?market=closed`, or real US equity hours (09:30–16:00 ET, Mon–Fri) for the `finnhub`/`live` feeds. The banner reads "Market is closed · opens Fri 15:30" in local time. A Market button gets "· at open"; such an order is queued (`activateAt`) and executes at the first quote after the open. The banner is only in `new`; `current` has none, but the queuing in the engine is shared.
- **Limit/Stop toasts**: "Buy limit 100 AAPL at 199.00 placed" + **Cancel**. A limit that fills at once gets "Bought …" + Close position.
- **New atoms**: `Banner` (no 2a atom is a notice above the form) and `DateTimeField` (`ValueField` is a numeric field with a suffix and a right-hand value and cannot hold native date/time pickers with a min date). Extended: `ValueField` (warning tone on the right), `FieldCaption` (link action), `ExitLevel` (a field to the right — "% of position"), `TextButton` (onClick), plus `IconButton` (✕).
- **Panel scrollbar** is hidden (Figma uses an overlay scrollbar; a classic one shifted the layout by 11 px). Wheel and trackpad scrolling still work.

## Chart lines (`?chartLines=1`, both panels)

Dashed lines: entry (blue, "Buy LMT 100"), SL (red, "SL −400.00 USD"), TP / TP1–3 (green, "+800.00 USD"). The price scale stretches to keep every line in view. A line is dragged with the mouse (±6 px from the line): the panel field updates in its current unit (price, ticks, %, USD), and a level is never dragged past the entry. The study turns the flag on for both panels.

## Study (`?study=1`)

Setup screen: participant ID, panel (Current / New / both in random order), scenarios 1–3. Each run has its own URL: `?study=run&pid=…&panel=…&scenario=…&seed=…&chartLines=1`. A run starts from a clean paper account, and the simulator seed is fixed per scenario (1001/1002/1003), so the market repeats. The strip above the interface shows the task, a timer, the submit count and **Done**. Done auto-checks the last submitted `OrderDraft` (side, type, price, quantity ±1, SL, TP, time in force) and opens the next run. The results screen shows a table and exports JSON/CSV; the same exports are in the debug menu (`?debug=1`). Metrics: open → submit time, run start → submit time, submits, validation errors (`validation_error` + engine rejections), cancels/closes.

Scenario 3 ("1 USD above the market") is checked against the Bid at the moment of submit (logged with the `submit` event) with a ±0.25 tolerance (the simulated market moves while the participant types).

## e2e (Playwright, `npm run e2e`)

`e2e/scenarios.spec.ts`: 3 scenarios × 2 panels through the real study flow (setup → run → panel UI → Done → auto-check "yes" → CSV), plus a check that the console has no errors. The final test compares open → submit time for Market (scenario 1): on the last run `current` 400 ms, `new` 234 ms.
