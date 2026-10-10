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
- **New-panel defaults**: quantity is empty; enabling a level fills SL −2% / TP +4% from entry (rounded to the tick); ~~disabling clears it~~ — since the 2a/2b follow-up, disabling keeps the value as the grey placeholder (see below). `current` keeps its own defaults (1 share, TP 75 / SL 25 ticks).
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

Dashed lines: entry (blue, "Buy LMT 100"), SL (red, "SL −400.00 USD"), TP / TP1–3 (green, "+800.00 USD"). The price scale stretches to keep every line in view. A line is dragged with the mouse (±6 px from the line): the panel field updates in its current unit (price, ticks, %, USD), and a level is never dragged past the entry. The flag works the same for both panels.

## Panel switch instead of a study mode

A study mode with its own URLs (`?study=1`, a task strip, Done, a timer, result export) was built and then removed at the designer's request: time and metrics are not collected for now. Instead, a floating **Order panel: Current / New** switch sits in the bottom-left corner. It switches panels without a reload, the ticket starts over with the chosen panel's defaults (the account is untouched), and the choice is kept in `localStorage`, while `?panel=` takes priority. The order panel (Trade) is open when the app loads. The ticket event log (`?debug=1`) stays and records `panel_switch`.

## e2e (Playwright, `npm run e2e`)

`e2e/scenarios.spec.ts`: 3 scenarios × 2 panels — fill the ticket through the panel UI, submit, check the order the engine accepted (side, type, price, quantity, SL, TP, time in force), and check that the console has no errors. Plus a test of the floating switch and of the panel being open by default.

## Typography and disabled SL/TP (after 2b)

- **Weights**: Figma uses SF Pro 510 (Medium) / 590 (Semibold). Chrome's `-apple-system` renders those off-grid weights close to Bold, and 500 the same as 400. The tokens are 500 / 600, as in the current panel; 600 matches the Figma semibold side by side.
- **Click on a disabled SL/TP field** turns the level on and focuses the field, as in production (both panels; in `new` also the TP "% of position" field).
- The summary above the button stays `SL −407.00 USD · TP +943.00 USD` (PRD FR-8.1); the Filled mockup has `SL: … · TP: …`.

## 2a/2b follow-up: live menu values, live placeholders (PRD FR-4.1, FR-4.2, FR-5.1, FR-6.3)

- **Slow view.** `useOrderTicket()` also returns `slowView`: the same `deriveTicket` over a quote held for 500 ms. Unit-menu values, grey placeholders and the grey money of switched-off SL/TP read it, so they follow the market at most every 500 ms, while user edits apply at once. At Limit the menu values depend on the market only through Ticks from Ask/Bid.
- **Menu values** follow the PRD table literally: numbers without unit words (`20,157.00`, `20.17%`, `407`, `257 below`). The selected unit shows what was typed; in risk modes Risk USD shows the real risk after rounding. "—" when not computable, "Needs SL" for risk units without a stop loss; items stay clickable.
- **ⓘ texts** are in the PRD in Russian; the UI is English, so they are translated one to one ("Shares × entry price", "Loss if triggered", …). Tooltip on hover of the icon.
- **Click to substitute.** `ValueField.fill`: on focus of an empty field the value is written to the DOM, selected and committed in the same handler (writing it only through React raced Playwright's `fill()` and gave "1100").
- **Quantity placeholder** = `minQty` in the current unit. What a click substitutes in USD / % balance / risk units is rounded **up** to the cent (`0.20%` shown, `0.21` substituted), otherwise rounding down to the step would give 0 shares. The right side is grey: `201.57 USD` for Shares, `1 share` for the other units.
- **Price in ticks**: an empty field shows `0`; a click substitutes 0 ticks = Ask/Bid (0 ticks is now a valid input).
- **Switched-off SL/TP**: numeric grey placeholder (last value, else −2% / +4% of entry; a limit without a price counts from Ask/Bid). Money units without a quantity have no number to show and keep the text placeholder ("Enter amount").
- **"Fills now" / "Triggers now"** use the strict `beyondMarket` check. A Buy Stop exactly at Ask has no warning but still executes at once in the engine (production treats it as already triggered).
- **Risk sizing and exit units.** While Quantity is in Risk USD / Risk % balance, the money units of SL and TP (Risk/Reward USD, Risk/Reward % balance) are disabled in the menus, with a hover reason. Switching Quantity to a risk unit moves an SL/TP that was in a money unit to price, keeping the level. `MenuItem` now uses `aria-disabled` instead of native `disabled`, so the reason tooltip shows.
- **Default order type** of the new panel is **Limit** (was Market). `current` keeps Limit too, as in production.
- **Empty Limit / Stop price**: the right side shows a grey "Ask" (Sell: "Bid") — what the placeholder is; in ticks mode the grey price. Replaces the earlier "right side empty while the placeholder shows".
- **Suggested Limit / Stop price** (the grey placeholder, what a click substitutes) is Ask / Bid moved **0.1% of the price** (rounded to ticks, at least 1) to the side where the order rests: Buy Limit / Sell Stop below, Sell Limit / Buy Stop above (AAPL: 20 ticks, `201.37 · Ask − 0.20`). A placeholder exactly at the market kept tripping "Fills now" / "Triggers now" as soon as the price moved. Changes PRD FR-4.2 ("placeholder = Ask/Bid"). Exits and the quantity placeholder of an empty-price limit count from this suggested price. The constant is `DEFAULT_PRICE_OFFSET_PERCENT` in `orderMath.ts`.

---

# Price field: defaults and validation (2026-10-09)

Implemented from the "Order price field: defaults and validation rules" spec, for the new panel only (`current` keeps production behavior). Rules live in `order-ticket/priceField.ts` as pure patches; the store applies them on ticks, commits, side / type / symbol changes and submit. Constants: `DEFAULT_OFFSET_PCT = 1` (`lib/orderMath.ts`), commit debounce `PRICE_COMMIT_MS = 600`.

- **Replaces** the earlier empty field with a live grey placeholder (Ask/Bid ± 0.1%). The field is now prefilled; an emptied field shows the same default in grey.
- **Fills / Triggers now at the market price too** (≥ Ask / ≤ Bid), as the spec says; this replaces the earlier "strictly beyond" rule. The status comes from the last commit, not the live market.
- **Default mode also recomputes a crossed price**, not only one outside the 0.5×–2× band: a single jump larger than the band could otherwise leave a default on the wrong side.
- **Spec test case 3** ("market then drops below 201.60") can only show a stale warning if the market *rises* above 201.60; a drop keeps the price a real "fills now". Both directions are covered in `priceField.test.ts`.
- **Not built:** BID / MID / ASK chips and Reset (a "Reset to default" menu item was tried and removed at the user's request), so only a symbol change returns the price to the default. There are no stepper buttons, so arrow keys and the mouse wheel count as stepper clicks.
- **Enter submits**, so it is handled as a submit (re-validates, can hold the first click), not as a commit.
- **Mock market:** `?walk=calm` (±2 ticks / 500 ms) and `?walk=volatile` (±20 ticks / 200 ms), plus a "Volatile" checkbox in the debug menu (`?debug=1`). The default sim walk is unchanged.

# Risk mode linkage (2026-10-09)

Implemented from the "Risk mode linkage" spec for the new panel. Agreed with the user; replaces earlier decisions:

- **No "Real risk" anywhere.** The Quantity caption in risk modes is "Margin … · Tick …" like other modes. The actual risk (after rounding shares down) shows only on the SL field's right side and in the summary ("SL −398.86 USD").
- **Unit menu:** the Risk USD / Risk % balance items show the typed risk converted between the two (400.00 ↔ 0.40%), not the actual risk (was 398.86).
- **SL menu hides** Risk USD / Risk % balance while Quantity is in a risk mode (they were disabled with a tooltip). **TP keeps its Reward items disabled** with the tooltip — the spec only covers SL.
- **Shares = 0:** "0 shares", caption "Risk too small for 1 share (min 4.07 USD)", the same text on the disabled button (was "Risk is below 1 share").
- **Default risk:** 1% of balance (Risk USD rounded to whole USD: 1,000; Risk % balance 1.00), set when switching into a risk mode and shown as the grey placeholder of an empty field. Between the two risk units the typed risk converts. Previously the current position's risk carried over and the placeholder was the risk of 1 share.
- **Switching Quantity to Risk USD / Risk % balance turns SL on** with its placeholder (the last value, else −2% from entry). "Turn on stop loss to calculate shares" now appears only if the user switches SL off in a risk mode.
- Shares on the right are pluralized ("1 share", "2 shares").
- The stage prompts in the PRD appendices are left as historical text.

# Figma update of 9 Oct: ⇆, empty states, colours, exits (new panel only)

Source: the Figma frames `4116:117479` (Market / Limit · Empty / Filled, unit-menu cards) and the "Правки панели new по макетам от 9 октября" prompt. `?panel=current` is untouched.

**Done**

- **⇆ replaces the price-unit dropdown** (Limit price / Stop price). Two modes only, so the mode is switched by the ⇆ in the field, the label follows it: `Limit price` ↔ `Offset from Ask` (Sell: `Offset from Bid`). Tooltip: "Enter as offset from Ask" / "Enter as price". The offset is a **signed price** (−2.57), not ticks; the order price is kept on a switch. Reverses the earlier "no ⇆" decision in PRD FR-4.1 and the "Ticks from Ask" menu row.
- **The price is no longer prefilled.** An empty field shows a grey placeholder (Limit 1%, Stop 1.5% from Ask / Bid, away from the market, on the round step: Buy Limit 199.00, Sell Limit 204.00, Buy Stop 205.00, Sell Stop 198.00); grey right side "Ask − 2.57"; a click substitutes it, selected; the button stays disabled ("Enter price and quantity") until a price is typed. Removed: `defaultPricePatch`, `tickPatch`, `priceSource`, `defaultPriceStale` and the hysteresis — the placeholder is derived from the live quote, nothing is written into the state. Replaces PRD FR-4.2 and the "Price field: defaults" section above.
- **Colours.** Money on the right of the SL / TP fields is grey (#707070). Summary: `SL` #e78a00, `TP` #089981, amounts #131722, separator #707070. Tokens `--color-sl`, `--color-tp`, `--color-warning` (+ `--nt-summary-amount`) in `styles/tokens.css`.
- **SL menu** shows Risk USD / Risk % balance **disabled** (with a tooltip) while Quantity is in a risk mode, as in the Figma card "Risk picked in Quantity field" (was hidden). **The TP menu does not change**: its Reward items are no longer disabled in risk modes (they were, in the earlier risk-linkage step). Switching Quantity to a risk mode moves an SL in Risk units to Price with the same level; TP is left alone.
- Texts: `Limit price` / `Stop price` (sentence case), `% of price`; the "Enter price" fallback in empty SL / TP is "—" (normally a numeric placeholder shows).

**Already in place before this step** (checked against the prompt, no change needed): quantity placeholder 1 · `201.57 USD`, "Available margin …", SL / TP numeric placeholders and grey money (only with a quantity), no "Real risk", `Margin … USD · Tick … USD`, "+ Add level" only with TP on, U+2212 minus, "Needs SL" / "—" in menus.

**Not done / differences from the prompt**

- **Stop Limit** (prompt section 3: tab, engine, toasts, tests) is **not built**. The user said in the first message of this task that the Stop Limit tab stays in Figma only. The engine, `OrderType` and the tabs are unchanged.
- **Panel width.** The Figma frames are 360 px wide; the prototype stays at **320 px** (resizable 300–480, an earlier agreed decision), so widths differ by 40 px. The inner metrics (field 34, radius 6, paddings 16, footer block) follow the frames.
- **Section 8 (Market · Risk USD + SL):** the Quantity field keeps the unit in the label ("Risk USD ▾"), so the left value is `407.00` without " USD"; right `100 shares`.
- Figma "Limit · Filled" shows `Margin 398.00 · Tick 1.00 USD`; we show `Margin 398.00 USD · Tick 1.00 USD` (currency always, per the prompt).

- **"Add level" renamed to "Add partial exit"** in the new panel (Figma 4111:97248). Current panel keeps "Add level".

# Exit levels (partial exits), 10 Oct (new panel only)

"Add partial exit" opens the **Exit levels** screen (reference: the screenshot of the production screen, adapted to our atoms). Decisions:

- **Model.** Level 1 = the main SL / TP with the shares that remain; every extra level (`TicketState.partials`, up to 4) has its own shares (units, or % of the position via ⇆), take profit and stop loss, each in its own unit; an empty leg is not sent. This **replaces the earlier TP 2 / TP 3 with "% of position"** (`tpLevels`, `tpPercent`, `splitQty`, `weightedAverage`, `takeProfits` in the ticket; the engine keeps `takeProfits` for its old tests).
- **Engine.** `OrderDraft.exitLevels` creates a TP (limit) and an SL (stop) leg per level, linked OCO inside the level (`Order.exitGroup`); a fill cancels only its own level's other leg. Before, one SL covered the whole position and shrank with every TP.
- **Defaults.** A new level takes half of Level 1's shares (at least the minimum lot) and copies Level 1's TP / SL.
- **Risk sizing** still uses Level 1's stop-loss distance for the whole quantity; partial stops do not change the share count (the real risk of the order is the sum of the SL money, shown in the summary).
- **Totals.** Summary = sum of SL money and of TP money over the levels that have the leg. R:R = total reward / total risk, only when every level has both legs. Protected size = share of the position with a stop loss.
- **Edits apply live** (chart lines follow, the main fields show Level 1's money); Discard / back / × restore the snapshot taken when the screen opened, Confirm keeps it. The main button then reads "Partial exits · N levels".
- **Not built:** level 1 cannot be deleted (no trash on its row); the "Add level" link inside the screen keeps the label of the screenshot; per-leg ⇆ and the second dropdown on the right of TP / SL fields from the screenshot are replaced by our label menu + grey money.

## Levels on the ticket (Figma 4135:149017)

- With partial exits the **Exits block replaces the SL / TP fields and Risk / Reward** with: "Protected size ∙ 100.00%" + bar (green at 100%, orange below), a row per level ("Level 1 ∙ 50%" over a pill "TP 50 @ 206.00 ∙ SL 50 @ 197.50" with a trash button) and "Add partial exit" (always this label now; disabled at 5 levels or without shares to split). A pill opens the Exit levels screen. Metrics match the frame (progress 50, levels 100 / 170 / 240, button 322 inside the Exits block).
- Because the main fields are hidden, **Level 1 is edited on the Exit levels screen** too (TP / SL fields bound to the main state; its shares are read-only: the rest of the position; clearing a leg switches it off). Level 1's SL keeps the "Risk" items disabled in risk sizing.
- **Trash:** on Level 2+ removes the level; on **Level 1 the next level is promoted** (its TP / SL become the main ones, the removed shares join Level 1's remainder). The last trash returns the plain SL / TP fields. Not in the frame — my reading.
- **Summary** with several levels: `SL −407.00 USD · TP up to +943.00 USD · 3 exits` (SL / TP are totals over the levels). SL in a pill is `#ff9800` (the frame), in the summary `#e78a00` (earlier prompt); two tokens, `--nt-pill-sl` and `--color-sl`.

- **Price warnings are red.** "Fills now" / "Triggers now" (field border, right text, caption) use the error colour although they do not block the button (user, 10 Oct). Warnings in the order summary ("N shares without SL/TP", "No stop loss") stay orange.

# Exits: levels per the 10 Oct spec (replaces the "Exit levels" screen with Level 1 / Level 2)

The spec pasted on 10 Oct changed the model; where it differs from the earlier steps above, **this is current**:

- **Every level has explicit shares** (`TicketState.levels`, each a *fraction of the order* + TP / SL legs). One level = the plain SL / TP fields (`levels` is empty, never of length 1). Level quantities are derived: `scaleLevels(fracs, orderQty)` rounds down per level and gives the rounding leftover to Exit 1, so a floating order quantity (risk sizing at Market) never drifts the levels. A user edit of one level's shares keeps what the others show now; shares can add up to less than the order (unprotected, orange warning) or more (error).
- **Rows** on the panel are sorted by TP (nearest first), headed "Exit n · 50 shares · 50%"; a row opens the **level editor** (shares, TP, SL, "Remove exit"); "+ Add partial exit" splits the last level and opens the editor of the new one. This replaces the screen with Level 1 / Level 2 cards and the "Level 1 ∙ 50%" headings of Figma 4135:149017.
- **Protected size** = Σ level shares / order (no longer "shares with an SL"); text "Protected size · 100%" (≤ 2 decimals, no trailing zeros).
- **Removing** a level gives its shares to the previous row (the next one for the first); removing down to one level restores the SL / TP fields with that level's values. 0 shares in the editor removes the level on Confirm. Confirm is never disabled: problems show in the list and on the button.
- ~~"Add partial exit" is disabled when the last level has fewer than 2 lot steps~~ — **reversed on 10 Oct at the user's request**: the link stays active. A last level under 2 steps (1 share) is not split; the new exit starts at **0 shares** with the copied SL and the next TP, and the user types its shares (above the order → "Exits exceed the order by 1 share"; confirming at 0 drops it). Without a quantity a click focuses Quantity (level shares are stored as fractions of the order, so they cannot exist without one). Disabled only at 5 exits ("Up to 5 exits").
- Without a typed limit / stop price, the first split now takes SL / TP from the price placeholder (was "Off" / "Off").
- **Summary** (pure `exitsSummary`): `SL −407.00 USD · TP up to +818.00 USD · 3 exits`, orange warnings `20 shares without SL/TP` / `No stop loss`, "N exits" dropped first when the line does not fit (at 320 px it often is), R:R not shown. The reason strings: `Reduce exits to 100 shares`, `Stop loss must be below entry`, `Take profit must be above entry`.
- **Risk sizing** with levels uses the share-weighted average stop distance (levels without an SL do not count). Stop losses of levels cannot use Risk USD / Risk % balance while Quantity is in a risk mode (same as the single SL).
- Up to 5 levels (`MAX_LEVELS`; the spec gives no limit). Chart lines: `SL1…` / `TP1…` per level, draggable.

# Expires (replaces Time in force), 10 Oct

- Row "Expires" with the date only; menu Day / Week / Month / On date (GTD) with the dates on the right; Figma 4111:95338 and 4135:151783. Button: Limit / Stop "· till Oct 15", Day "· till 4:00 PM", GTD "· till Oct 24" (date only), Market no term.
- **paperEngine untouched:** Day still expires at the end of the local day, Week / Month at the end of that day. "4:00 PM" is the session close **as displayed** (stocks; 24 h markets say 11:59 PM). Only GTD actually uses it: a date without a time expires at 16:00 local (rule `expiresAtSessionClose`, new panel only — `current` keeps the end of the day). It is local time, not ET.
- "On date" without a date blocks Limit / Stop ("Pick an expiry date"); the menu no longer pre-fills tomorrow.
- Date and time fields (from the platform screenshots): a calendar (Mo–Su, today underlined, chosen day dark, days before tomorrow off) and a list of quarter-hour times, both also typeable.

# Forex: pips instead of ticks (new panel), 10 Oct

- `SymbolSpec.pipSize` (EURUSD / GBPUSD 0.0001, USDJPY 0.01) switches the *distance step* from the tick to the pip: SL / TP menu item "Pips", input with one decimal, caption "−40.0 pips (−0.37%) from entry", Quantity caption "Margin 2,169.04 USD · Pip 10.00 USD". The pip value is `qty × pipSize × pointValue` converted to the account currency (USDJPY from JPY at the current rate). Stocks and crypto have no `pipSize` and are unchanged. The ExitUnit stays `'ticks'` internally; `ExitLevel.ticks` and `QtyView.tickValue` hold pips / pip value for forex.
- Forex lots: `minQty` = `qtyStep` = 1,000 (was 1) — this also applies to the `current` panel for these symbols. Quantity placeholder "1,000"; texts come from the spec ("Enter quantity to buy EURUSD", "1,000 units" / "1 unit").
- Expires: Day shows "Today, 5:00 PM" for forex (the rollover, **display only** — the engine is untouched; GTD without a time defaults to 17:00 local).
- The spread is not converted to pips; the "Turn on stop loss to calculate units" caption does not exist any more (the button says "Set stop loss to calculate size"), so there is no such text to localise.
- The price field's ⇆ offset stays in price ("Ask − 0.00020"), not pips — the prompt only covers SL / TP.

## Switched-off SL / TP: "Set at {value}" (FR-6.3, 10 Oct)

- The off field is a text action, not an `<input>` placeholder: `div role="button"` with `aria-label` "Stop loss off. Activate to set at 197.54", grey `#707070`, hover / keyboard focus `#131722` on the hover fill (`ExitLevel`, `ActionField` in `ui/atoms.tsx`). It keeps the test id `nt-sl-input` / `nt-tp-input`; once the level is on, the same id is the input. No money on the right and no caption when off, even with a quantity.
- Money units without a quantity have no value: the text is "Set at —".
- **Stop Limit** does not exist in this panel (Market / Limit / Stop only). The "Stop Limit 205.20 → 201.10 / 213.41" row is covered with a Stop at 205.20 (same entry maths).
- **Quantity in Risk with SL turned off by the user:** the prompt says the caption "Turn on stop loss to calculate shares" exists "as now", but it never did (the earlier decision was no caption or link under the field; a test pins it). I left Quantity and the button as they are: "—" on the right, no caption, button "Set stop loss to calculate size" (disabled). Say if the caption should be added.
- Focus: any user turn-on (field, switch, Space / Enter) focuses the input with the value selected; the panel turning SL on itself (FR-5.4) does not.
- `?exitsRow=1` was not built in this branch, so there is nothing to keep for comparison.
- Switch off state follows Figma 4135:159173: track `#ddd` (`--nt-switch-off`), 14 px dot with a `0 1px 1px rgba(0,0,0,.04)` shadow. Only the new panel; the on state and the `current` panel are unchanged.
- `docs/PRD.md` FR-6.3 replaced with the current wording from the source document. Other places in the PRD (Appendix D tables with grey money for off levels) are left as history; the prompt of 10 Oct wins.
- Cursor over a switched-off field is the text cursor (like an input), not pointer as the 10 Oct prompt said — changed at the user's request.
