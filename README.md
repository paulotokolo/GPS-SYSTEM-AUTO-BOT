# GPS SYSTEM AUTO BOT

A BUY-only trading bot that replicates the **GPS SYSTEM INDICATOR ALGO** (TradingView Pine Script v6) signal logic in HTML/JavaScript, built on the **FXBlue Framework** for **Liquid Charts Pro** as an external widget.

Every BUY the bot fires is intended to match what the indicator produces on the same pair and timeframe.

The engine has been **verified line by line against the actual Pine source**, and the session windows confirmed against the client's live chart. See [Corrections after source review](#corrections-after-source-review) for what that changed.

---

## ✅ Session windows — confirmed against the live chart

The Pine source ships with `0930-1100` as its NY AM default, while the implementation guide
specified `0930-1200`. That discrepancy has now been **resolved from a screenshot of the
client's own indicator settings**, and the guide was correct:

| Session | Client's chart | Bot | Match |
| :--- | :--- | :--- | :--- |
| Asia | `20:00 – 00:00` | `2000-0000` | ✅ |
| London | `02:00 – 05:00` | `0200-0500` | ✅ |
| NY AM | `09:30 – 12:00` | `0930-1200` | ✅ |
| NY Lunch | `12:00 – 13:00`, **unchecked** | disabled | ✅ |

No change was required — the bot already matched on all four. NY Lunch being unchecked means
it is excluded from the indicator's killzone array entirely, so it never contributes a
reference level; the bot treats it the same way.

All four windows remain editable under *Advanced → Session Windows* should the client ever
change them on their chart.

---

## Contents

| File | Purpose |
| :--- | :--- |
| `gps_bot.html` | The bot. Single self-contained widget — load this into Liquid Charts Pro. |
| `tests/` | Automated test suite (118 assertions). |
| `tests/run-all.js` | Runs every suite and prints a combined tally. |

The Pine source itself is deliberately **not** included here — it is the client's intellectual property, and this is a public repository. It can be added to a private repo on request.

---

## Corrections after source review

The first build was written from the implementation guide's transcription of the signal engine, because the Pine file was not supplied at the time. With the real source now available, the following genuine divergences were found and fixed. Several of them were producing **extra BUY signals that the indicator never generates** — the reported symptom.

### 1. Session opens were resetting the setup — the main cause of wrong BUYs

The guide describes an unconditional reset on session open when no setup is active. The source reads:

```pine
if sig_presession_fvg and (sig.sweep or sig.fvg_found) and not sig.fired
    if na(sig.presess_bar)
        sig.presess_bar := bar_index
else if not sig_persist_session
    sig.sig_reset()
```

**Persist Through Sessions is ON**, so `not sig_persist_session` is false and that reset branch *can never run*. A session opening never resets anything.

The bot was resetting there — which silently cleared `fired` and re-armed the setup a full session early, letting a new BUY fire off a stale reference. Now matches the source, and `Persist Through Sessions` is exposed as its own setting.

### 2. `sig_reset()` clears the reference levels

The guide implied the refs were preserved. The source clears them outright (`s.ref_name := ""`), with every caller reassigning immediately afterwards where needed. Corrected.

### 3. Swing highs use a **1-bar** fractal, not 2

```pine
h_cur = high[i], h_prev = high[i + 1], h_next = high[i - 1]
if h_cur > h_prev and h_cur > h_next and h_cur > above_price
```

The guide never defined a swing high, so a 2-bar fractal was assumed. The source compares against the immediately adjacent bars only. A width of 2 skipped valid levels and shifted **every TP**. Default is now 1, plus the source's mintick de-duplication.

### 4. The retest is marked on the FVG formation bar

This was previously flagged as an open interpretation question — the source settles it. Step 3 runs in the same bar pass as step 2, where `low == fvg_top`, so the zone is marked tested the moment it forms. The stricter reading is now **off by default**; `above_fvg` still prevents any fire on the formation bar.

### 5. FVG invalidation was too destructive

Source: `if sig_invalidate_below and close < sig.fvg_bot` — tests the **close**, and clears only the FVG fields. The sweep and `swing_low` survive, so the setup resumes hunting for a new FVG. The bot was testing the **low** and tearing the whole setup down. (Off by default either way.)

### 6. A 30-minute timeframe limit exists

`tf_limit_is_equal_or_more_chart_tf` gates the entire signal block, with `tf_limit` defaulting to 30 minutes. **Above M30 the indicator produces no signals at all.** The bot now refuses to start above M30 rather than trading setups TradingView never displays.

### 7. Add-on entries do not exist in the indicator

The source contains no add-on logic whatsoever — no cooldown, no `in_zone`, nothing. Add-ons come from the guide alone and are purely bot-side extra entries.

They are now **OFF by default**, so every BUY the bot places corresponds 1:1 with a BUY label on the chart. Turn them on only once signal parity is confirmed, and expect extra entries with no matching label when you do.

### 8. `body_ok` short-circuits at zero

`sig_min_body_above <= 0.0 or body_pct_above >= sig_min_body_above`. Matched.

Also confirmed as already correct: the `America/New_York` timezone, killzone boxes tracking full wick high/low, `_box.get(0)` being the most recently closed session, disabled killzones being excluded from the signal loop entirely, `ta.atr(14)`, and the whole engine running on `barstate.isconfirmed` (bar close only).

---

## Real-time signal state

The Signal State panel previously only redrew when a bar closed — on M5 that is once every five minutes, which reads as a frozen panel.

It now updates **once per second** via a live ticker, showing:

- **Live price** on the forming bar, with its running high and low
- **A countdown** to the current bar's close
- **Carry-over bars** used, with the forming bar shown separately
- **The active session**, tracked from the forming bar
- **A pulsing live indicator** with the last update time

### Green vs amber

- **Green** — confirmed on a closed bar. This is real signal state.
- **Amber (pulsing)** — provisionally true *right now* on the forming bar, not yet confirmed.

**A sweep is announced the instant price trades through the reference low**, with a log line and an audible alert, rather than waiting for the bar to close:

```
⚡ SWEEP FORMING — price 2018.40 is through the ASIA ref_low 2018.55.
   Confirms when this bar closes.
```

The confirmed `SWEEP DETECTED` still follows at bar close.

This distinction is deliberate and important: the indicator evaluates on `barstate.isconfirmed`, so **signals only become real at bar close.** Firing intrabar would produce entries TradingView never shows, and would repaint. The amber state shows what is developing without changing what the bot acts on.

---

## Confirmed settings implemented

Values are the client's confirmed live settings, not the Pine defaults. Settings that differ from the Pine defaults are marked.

### Signal engine

| Setting | Value | Note |
| :--- | :--- | :--- |
| Enable Buy Signals | **ON** | No sell side exists anywhere in the code |
| Persist Through Sessions | **ON** | ⚠️ Pine default OFF — session opens never reset |
| Pre-Session FVG | **ON** | ⚠️ Pine default OFF |
| Max Carry-Over Bars | **50** | |
| Require Bullish Breakout Candle | **ON** | `close > open` |
| Require Retest of FVG | **ON** | Marked on the formation bar, per source |
| Breakout Must Open At/Below FVG Top | **ON** | `open <= fvg_top` |
| Min Body Above FVG | **15%** | ⚠️ Pine default 10% |
| Invalidate FVG If Filled | OFF | |
| Volume Filter | OFF | Not evaluated |
| Candle Size Filter | OFF | Not evaluated |
| Timeframe Limit | **M30** | Bot refuses to start above this |

### Session windows (EST — `America/New_York`, DST automatic)

| Session | Window | Status |
| :--- | :--- | :--- |
| Asia | `2000-0000` | **ENABLED** |
| London | `0200-0500` | **ENABLED** |
| NY AM | `0930-1200` | **ENABLED** — confirmed against the client's chart |
| NY Lunch | `1200-1300` | **DISABLED** — excluded from the signal loop |

All four are editable, to match whatever is set on the client's chart.

### TP / SL

| Setting | Value |
| :--- | :--- |
| Stop Loss | `fvg_swing_low` — low of the **middle** candle of the 3-bar FVG |
| Swing High Lookback | 50 bars |
| Swing Pivot Width | **1** (per source) |
| Min TP Spacing | 0.5 × ATR(14) |
| TP1 / TP2 / TP3 | Nearest / next / third swing high above entry, ascending |

---

## Signal sequence

Each milestone is logged stamped with the **bar's New York time**, to line up directly against the indicator's label:

```
SESSION CLOSE → SWEEP DETECTED → FIRST FVG FOUND → FVG RETEST → BUY SIGNAL
```

---

## Additions beyond the indicator

**Dry Run mode (default).** Runs the full engine and logs every BUY with its SL and TP levels without sending an order. This is the mode for the TradingView comparison. Live trading requires an explicit change plus a second confirming click.

**History replay on start.** Replays recent closed bars to rebuild session references and any in-progress setup, so the bot is not blind until the next session close. Replayed bars never place orders.

**Deviation warnings.** The bot logs a loud warning at startup for any setting that would break parity with TradingView — including add-ons being enabled, a pivot width other than 1, or the stricter retest mode.

---

## Trade management

Beyond producing signals, the bot manages the trades it opens.

### Auto Trailing

Two stages, both measured in account currency rather than ATR multiples:

1. **Breakeven** once floating profit reaches *half* of "Trail after profit". A buffer can be
   added on top, because a stop at the exact entry still costs the spread if it is hit — that is
   a small guaranteed loss, not zero.
2. **Trail** once profit clears "Trail after profit" in full, keeping the stop "Profit lock
   distance" behind price.

Profit comes from the broker's own figure, which also derives the $-per-price ratio — so it keeps
working for a trade re-adopted after a reload, where the original lot size was never captured.

**Trailing only ever tightens.** It can never move the stop further from price than
`fvg_swing_low` put it. A trail that would widen the stop is refused outright.

### Daily circuit breaker

A profit target and a stop loss, in dollars. Hit either and the bot stops trading for the day.

It counts **only this bot's own trades on this instrument** — closed today plus what is floating
right now — not whole-account equity, so a second window trading another pair cannot trip it. The
day boundary is the **EST** day, matching the session windows. It re-arms automatically at the
next one.

Optionally flattens open trades when it fires. A close that gets rejected is retried with a
backoff until it genuinely succeeds, rather than being logged once and abandoned — which matters
most in exactly the away-from-the-desk case the breaker exists for.

### Account size presets

Small / medium / large fill risk %, lot sizes, the hard lot cap, daily limits and the trailing
amounts in one go, and switch trailing on. Starting points, not universal numbers — everything
stays editable.

### Order path test

A **Send test BUY now** button places a plain market order with no SL/TP and no strategy logic,
behind the platform's own confirmation. It stays enabled while the bot is running, because that
is exactly when it is needed: if signals appear in the log but no trade opens, this splits the
problem in half. Works &rarr; the connection is fine and the issue is the signal path or the
SL/TP format. Fails &rarr; the log carries the broker's exact reason.

### SL/TP attach mode

The GPS levels are absolute prices. Absolute prices are only *proven* to work on a modify
request on this platform — sending one on the opening order is unverified, and if the platform
rejects it the whole order fails and no trade opens.

So the default is **After open**: send a plain order, then set the levels immediately. A rejected
stop can never cost the entry itself. **On open** remains available if a broker requires it.

---

## Verification

```bash
node tests/run-all.js
```

```
test_engine        19 pass   0 fail
test_carryover     17 pass   0 fail
test_conditions    11 pass   0 fail
test_replay         9 pass   0 fail
test_sizing         6 pass   0 fail
test_pine_parity   17 pass   0 fail
test_orders        15 pass   0 fail
test_management    24 pass   0 fail
----------------------------------------
TOTAL: 118 pass, 0 fail
```

The suite loads the real engine out of `gps_bot.html` into a stubbed FXBlue sandbox and drives it with synthetic candles. `test_pine_parity.js` specifically locks in each behaviour corrected against the source, with the Pine line cited in the test.

Coverage includes: the full signal sequence with each milestone on its own bar; cross-session carry-over and 50-bar expiry; every fire condition gated independently; a fired setup surviving a session open with persist ON, and being reset with it off; `sig_reset` clearing the refs; invalidation preserving the sweep; configurable session windows; NY Lunch exclusion; EDT resolution; replay placing zero orders; risk sizing against the real stop distance; what actually reaches SendOrder in each attach mode; and the trade-management layer — breakeven, trailing, the never-loosen rule, and the circuit breaker's scope and day boundary.

**Not yet tested against live market data.**

---

## Setup

1. Load `gps_bot.html` into Liquid Charts Pro as an external widget.
2. Set **Instrument** to the broker's exact symbol name (reference test: XAUUSD on M5). If no candles arrive within 20 seconds, this field is almost always why.
3. Leave **Trading mode** on **Dry Run**.
4. Open the GPS indicator on TradingView on the same pair and timeframe.
5. Press **Start Bot**.

### Before going live

- Confirm the log fires in sequence: Session Close → Sweep → First FVG → Retest → BUY
- Confirm each BUY timestamp matches the indicator's label on the same candle
- Confirm the stop loss sits at `fvg_swing_low` — the middle candle of the FVG — **not** the sweep candle low
- Confirm a cross-session setup carries without resetting

Only switch to **Live Trading** once the timestamps line up. Live mode places real orders.

---

## Risk controls

- Dry Run default; live trading needs a deliberate second confirming click
- Fixed-lot or risk-% sizing, measured against the real GPS stop distance
- Hard maximum lot cap; optional cap on entries per day
- Refuses to start above the indicator's M30 timeframe limit
- If the broker drops the SL/TP on the opening request, the bot reattaches them and warns loudly if that fails

---

*Developed for Slow Grind Academy. Signal logic verified against the GPS SYSTEM INDICATOR ALGO Pine v6 source, using the client's confirmed live indicator settings.*
