# GPS SYSTEM AUTO BOT

A BUY-only trading bot that replicates the **GPS SYSTEM INDICATOR ALGO** (TradingView Pine Script v6) signal logic in HTML/JavaScript, built on the **FXBlue Framework** for **Liquid Charts Pro** as an external widget.

Every BUY the bot fires is intended to match what the indicator produces on the same pair and timeframe.

---

## ⚠️ Please read first — missing source file

`GPS_SYSTEM_INDICATOR_ALGO_v8.txt` was **not included** in the files provided.

The implementation guide instructs the developer to read the Pine Script signal engine at lines 820–907 before implementing. That file was not in the folder, so **this engine was implemented from the guide's transcription of that logic alone.**

The transcription is detailed and the implementation follows it precisely, but it has not been diffed against the actual Pine source. **If you can send `GPS_SYSTEM_INDICATOR_ALGO_v8.txt`, I will diff it against the engine and correct any divergence.** Two places where the guide left genuine ambiguity are documented under [Interpretation decisions](#interpretation-decisions) below — those are the most likely spots for a mismatch.

---

## Contents

| File | Purpose |
| :--- | :--- |
| `gps_bot.html` | The bot. Single self-contained widget — load this into Liquid Charts Pro. |
| `tests/` | Automated test suite for the signal engine (62 assertions). |
| `tests/run-all.js` | Runs every suite and prints a combined tally. |

---

## Confirmed settings implemented

All values are taken from the client's live TradingView screenshots, **not** the Pine Script defaults. The three settings that differ from Pine defaults are marked.

### Signal engine

| Setting | Value | Note |
| :--- | :--- | :--- |
| Enable Buy Signals | **ON** | Always active — no sell side exists anywhere in the code |
| Persist Through Sessions | **ON** | ⚠️ Pine default is OFF |
| Pre-Session FVG | **ON** | ⚠️ Pine default is OFF — changes all session boundary behaviour |
| Max Carry-Over Bars | **50** | |
| Require Bullish Breakout Candle | **ON** | `close > open` |
| Require Retest of FVG | **ON** | Price must tap the zone first |
| Breakout Candle Must Open At/Below FVG Top | **ON** | `open <= fvg_top` |
| Min Body Above FVG | **15%** | ⚠️ Pine default is 10% |
| Invalidate FVG If Filled | OFF | Zone is never invalidated |
| Volume Filter | OFF | Not evaluated at all |
| Candle Size Filter | OFF | Not evaluated at all |

### Session windows (EST — `America/New_York`)

Handled with `Intl.DateTimeFormat`, so **EST/EDT daylight saving is automatic**.

| Session | Open | Close | Status |
| :--- | :--- | :--- | :--- |
| Asia | 20:00 | 00:00 | **ENABLED** |
| London | 02:00 | 05:00 | **ENABLED** |
| NY AM | 09:30 | 12:00 | **ENABLED** |
| NY Lunch | 12:00 | 13:00 | **DISABLED** — never produces signals |

### TP / SL

| Setting | Value |
| :--- | :--- |
| Stop Loss | `fvg_swing_low` — the low of the **middle** candle of the 3-bar FVG |
| Swing High Lookback | 50 bars |
| Min TP Spacing | 0.5 × ATR(14) |
| TP1 / TP2 / TP3 | Nearest / next / third swing high above entry, ascending |

### Add-on entries

| Setting | Value |
| :--- | :--- |
| Max Add-Ons | 3 |
| Cooldown Bars | 3 |
| Trigger | `in_zone` → close back above `fvg_top` |
| Add-On Stop Loss | Same `fvg_swing_low` |
| Add-On TP | Next remaining swing high |

---

## Signal sequence

The bot logs each milestone stamped with the **bar's New York time**, so it can be lined up directly against the indicator's label on the chart:

```
SESSION CLOSE → SWEEP DETECTED → FIRST FVG FOUND → FVG RETEST → BUY SIGNAL
```

The `sig` state object mirrors the one specified in the guide field for field: `ref_high`, `ref_low`, `ref_name`, `sweep`, `swing_low`, `fvg_top`, `fvg_bot`, `fvg_bar`, `fvg_swing_low`, `fvg_found`, `fvg_tested`, `in_zone`, `fired`, `presess_bar`, `addons`.

One implementation note worth stating explicitly: **`sig_reset()` deliberately preserves `ref_high` / `ref_low` / `ref_name`.** The reference levels are locked session data, not part of the setup. Pine calls `sig_reset()` on session open without reassigning a ref afterwards — wiping the refs there would leave the engine permanently unable to detect a sweep.

---

## Additions beyond the specification

Two features were added specifically to support the verification steps in the guide:

**Dry Run mode (default).** Runs the complete engine and logs every BUY with its SL and TP levels, but never sends an order. This is the mode to use for the TradingView side-by-side comparison. Live trading requires an explicit mode change plus a second confirming click.

**History replay on start.** On Start the engine replays recent closed bars to rebuild session references and any setup already in progress, so the bot is not blind until the next session close. Replayed bars never place orders. Depth is configurable (default 1500 bars).

The bot also warns loudly at startup if any setting has been changed away from the confirmed indicator configuration, since silent drift is what breaks parity with TradingView.

---

## Two bugs found and fixed during testing

**Add-on fired on the same bar as the initial BUY.** The signal candle satisfies the add-on trigger by definition — it dips into the zone and closes above the top, which is what makes it the signal. That stacked a second entry onto the same candle as the initial entry. Add-ons now require a later bar, and the cooldown counts from the last *entry*, the initial one included.

**"FVG RETEST" was logged on the FVG formation bar.** `fvg_top` is set to that bar's own low, so `low <= fvg_top` is trivially true the instant the zone forms. The retest was being marked satisfied before any actual retest happened. The tap must now come from a later bar.

---

## Interpretation decisions

Two points where the guide left genuine ambiguity. Both are configurable, and both are worth confirming against the Pine source.

**1. Retest timing.** A literal reading of the Pine line marks the zone "tested" the moment it forms, which makes the Require Retest setting filter nothing at all. The guide describes it as *"price must tap into the zone first"* and lists FVG Found and FVG Retest as two separate events in the verification sequence, so the stricter reading was used as the default. A **"Retest must be a later bar"** toggle reverts to literal behaviour.

The practical impact is narrow: it only changes outcomes when *Open At/Below FVG Top* is disabled, because that gate already forces the signal candle to tap the zone.

**2. Swing high definition.** The guide specifies a 50-bar lookback and 0.5 × ATR spacing but never defines what qualifies as a swing high. A 2-bar fractal is used — a high that exceeds the two bars either side. This is configurable via **Swing pivot width**.

---

## A note on carry-over across sessions

The guide gives this example: *"A sweep from Asia can still produce an FVG during London and fire a BUY during NY AM."*

On **M5 this specific chain cannot occur.** The carry-over clock starts at the first session open after the setup begins, and 02:00 → 09:30 is roughly 90 bars — past the 50-bar limit, so the setup correctly expires first. Asia → London works and is covered by a test.

This is the 50-bar rule behaving exactly as specified, not a defect. It simply means that particular three-session example needs a higher timeframe. Flagging it so the behaviour is not mistaken for a bug during review.

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
----------------------------------------
TOTAL: 62 pass, 0 fail
```

The suite loads the real engine out of `gps_bot.html` into a stubbed FXBlue sandbox and drives it with synthetic candles. Coverage:

- Full signal sequence, each milestone landing on its own distinct bar
- Cross-session carry-over — Asia sweep, London FVG, BUY across the boundary with no reset
- 50-bar carry-over expiry, and that reference levels survive the reset
- Every fire condition gated independently, including that a 10% body is rejected but the same candle fires once the threshold is lowered to 10 — proving the 15% value is what rejects it
- NY Lunch excluded as a signal session; EDT resolved correctly
- History replay rebuilds state and places zero orders
- Risk-based sizing against the real GPS stop distance

The FXBlue API surface was verified against the live framework script rather than assumed. That caught that instruments expose `digits`, `minLot` and `lotStep` — not `decimals`, `minVolume` and `volumeStep` — and that `minVolume` is denominated in volume units, not lots.

**Not yet tested against live market data.**

---

## Setup

1. Load `gps_bot.html` into Liquid Charts Pro as an external widget.
2. Set the **Instrument** to your broker's exact symbol name (the guide's reference test is XAUUSD on M5). If no candles arrive within 20 seconds, this field is almost always the reason.
3. Leave **Trading mode** on **Dry Run**.
4. Open the GPS indicator on TradingView on the same pair and timeframe.
5. Press **Start Bot** and let it run through a session.

### Before going live

Per the guide's verification steps:

- Confirm the log fires in sequence: Session Close → Sweep → First FVG → Retest → BUY
- Confirm each BUY timestamp matches the indicator's BUY label on the same candle
- Confirm the stop loss sits at `fvg_swing_low` — the middle candle of the FVG — and **not** the sweep candle low
- Test a cross-session setup and confirm no reset occurs at the boundary

Only switch to **Live Trading** once the timestamps line up. Live mode places real orders on the connected account.

---

## Risk controls

- Dry Run is the default; live trading requires a deliberate second confirming click
- Fixed-lot or risk-% sizing, the latter measured against the real GPS stop distance rather than an ATR estimate
- Hard maximum lot cap
- Optional cap on entries per day
- If the broker drops the SL/TP supplied on the opening request, the bot detects it and reattaches them immediately, warning loudly if that repair fails

---

*Developed for Slow Grind Academy. Signal logic per the GPS Signal Implementation Guide v2, using the client's confirmed live indicator settings.*
