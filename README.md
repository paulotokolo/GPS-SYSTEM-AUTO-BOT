# GPS SYSTEM AUTO BOT

A BUY-only trading bot that replicates the **GPS SYSTEM INDICATOR ALGO** (TradingView Pine Script v6) signal logic in HTML/JavaScript, built on the **FXBlue Framework** for **Liquid Charts Pro** as an external widget.

Every BUY the bot fires is intended to match what the indicator produces on the same pair and timeframe.

The engine tracks the **updated GPS PRO source**, which generalises the original single setup into a configurable pair of choices — where the sweep reference comes from, and what shape the demand zone is. The client runs **three engines at once** off those choices.

---

## The three engines

The updated source lets the reference low come from a **closed killzone session** or from a **rolling lowest-low**, and lets the demand zone be a **3-candle FVG gap** or a **5-candle Red-Green-Green-Green-Red base**. Each combination the client trades is one engine, and all three run simultaneously on the same instrument and timeframe.

They are fully independent: each keeps its own state, its own sweep, its own zone, and places its own trades. **Three engines firing on the same bar is three separate entries**, and one engine resetting never touches another.

| | **Engine 1 — Priority FVG** | **Engine 2 — Add-On FVG** | **Engine 3 — Demand Zone** |
| :--- | :--- | :--- | :--- |
| Buy colour | 🔵 Cyan | 🟡 Yellow | 🔴 Red |
| Reference low | Killzone Session | Rolling Lookback | Killzone Session |
| Zone method | FVG Gap (3-candle) | FVG Gap (3-candle) | 5-Candle (R-G-G-G-R) |
| Reference lookback | 24 | 24 | 24 |
| Persist through sessions | ON | ON | ON |
| Require retest | ON | ON | ON |
| Min body above zone | 15% | 15% | 0% |
| Open at/below zone top | ON | ON | ON |
| Invalidate if filled | OFF | OFF | **ON** |
| Max zones tracked | 10 | 10 | 5 |
| Require fresh sweep | ON | **OFF** | ON |
| Max zone age | ON — 27 bars | ON — 30 bars | ON — 39 bars |
| Pre-session zone | ON — 15 bars | ON — 30 bars | **OFF** — 30 bars |
| Volume filter | OFF (10, 1) | OFF (10, 1) | OFF (10, 1) |
| Candle size filter | OFF (5, 1.5) | OFF (10, 1) | OFF (10, 1) |

Each engine has its own collapsible settings block with an ON/OFF master toggle, and each logs under its own label:

```
🔵 GPS BUY — [Engine 1: Priority FVG | SESSION sweep]
🟡 GPS BUY — [Engine 2: Add-On FVG | Rolling sweep]
🔴 GPS BUY — [Engine 3: Demand Zone | SESSION sweep]
```

Every order carries the engine in its comment (`GPSBOT-E1`), so a fill can always be traced back to what produced it.

Any drift from the table above is called out loudly in the log at Start — silent drift is what makes a bot stop matching its indicator.

### Rolling Lookback

The reference is the lowest low of the last N bars, tracked continuously, so the engine never waits for a killzone to close. It is **frozen the moment a sweep fires** so the target does not slide while the engine waits for its zone, and it resumes trailing once the cycle resets.

A rolling engine also **re-arms itself** after firing: with no session boundary to reset it, the tracking state is cleared on the next bar so it can hunt a fresh setup. Session engines instead hold `fired` until their next session close.

### The 5-candle demand zone

After the sweep, the engine watches for Red, Green, Green, Green, Red. The zone is **the first red candle's own high-to-low range** — a tight, single-candle zone rather than a gap. Only the first match after each sweep is taken.

### Zone lifetime

A zone that ages past its cutoff without a breakout **expires**: the zone is dropped and the engine keeps hunting. Whether the sweep survives that (and survives an invalidation) is what *Require fresh sweep before next zone* controls — ON means price must sweep a new low before another zone can be marked.

### Dynamic label names

Every zone-related label follows the method the engine is set to. Choose **FVG Gap** and the labels read *FVG*; choose **5-Candle Pattern** and they read *Demand Zone*. Engine 3 is the demand-zone engine and its labels never change.

---

## Market trend

The GPS BUY is a with-trend setup, so the bot requests a **second candle feed** at H1 (or H4) purely to answer *what market am I in right now*. The Signal State panel shows **UPTREND ▲ / DOWNTREND ▼ / RANGING ◆**, derived from price against an EMA **and** that EMA's own slope — a market that has merely popped above a still-falling average is not called an uptrend, and the slope has to clear 2 basis points so noise around a flat average does not read as direction.

It is **information by default**. Turning on *Only take BUYs in an uptrend* makes it a hard gate: the signal is still logged and exported, but the order is refused and the log says the filter is why.

---

## TP / SL — pip distances

The swing-high TP system is gone. Stops and targets are now **pip distances from the entry price**, shared by all three engines:

| Setting | Default |
| :--- | :--- |
| Stop loss | 100 pips |
| Take profit 1 | 100 pips |
| Take profit 2 | 200 pips |
| Take profit 3 | 300 pips |

0 switches a level off. One order goes out per signal carrying **TP1**; TP2 and TP3 are logged and exported with the signal as the levels to scale out at — the bot never splits one signal into three orders.

Because the levels are pips, they can ride on the **opening request**, which is the one form this platform is proven to accept (it is exactly what the manual test trade sends). That is now the default. *After open* remains available for brokers that refuse them on the open: the order goes out plain and the levels are attached from the fill price immediately afterwards.

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

NY Lunch being unchecked means it is excluded from the indicator's killzone array entirely, so
it never contributes a reference level; the bot treats it the same way.

All four windows remain editable under *Advanced → Session Windows* should the client ever
change them on their chart.

---

## Contents

| File | Purpose |
| :--- | :--- |
| `gps_bot.html` | The bot. Single self-contained widget — load this into Liquid Charts Pro. |
| `tests/` | Automated test suite (183 assertions). |
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

### 3. Swing highs use a **1-bar** fractal, not 2 — *superseded*

This was a real divergence at the time: the source compares `high[i]` against its immediately adjacent bars only, and the assumed width of 2 shifted every TP.

It no longer applies. **The swing-high TP system has been removed entirely** in favour of pip distances, so there is no fractal width left to get wrong.

### 4. The retest is marked on the FVG formation bar

This was previously flagged as an open interpretation question — the source settles it. Step 3 runs in the same bar pass as step 2, where `low == fvg_top`, so the zone is marked tested the moment it forms. The stricter reading is now **off by default**; `above_fvg` still prevents any fire on the formation bar.

### 5. FVG invalidation was too destructive

Source: `if sig_invalidate_below and close < sig.fvg_bot` — tests the **close**, and clears only the FVG fields. The sweep and `swing_low` survive, so the setup resumes hunting for a new FVG. The bot was testing the **low** and tearing the whole setup down. (Off by default either way.)

### 6. A 30-minute timeframe limit exists

`tf_limit_is_equal_or_more_chart_tf` gates the entire signal block, with `tf_limit` defaulting to 30 minutes. **Above M30 the indicator produces no signals at all.** The bot now refuses to start above M30 rather than trading setups TradingView never displays.

### 7. Add-on entries do not exist in the indicator — *superseded*

The original source contained no add-on logic at all, so the bot-side add-on feature (cooldown, `in_zone`, extra entries off one setup) was pure invention from the implementation guide and shipped OFF by default.

**That feature has been removed.** The updated architecture replaces it with **Engine 2 — Add-On FVG**, which is a real engine off the Rolling Lookback reference rather than extra entries stacked on another engine's setup. The `ADD-ONS USED` tile in the Signal State panel is Engine 2's entry count.

### 8. `body_ok` short-circuits at zero

`sig_min_body_above <= 0.0 or body_pct_above >= sig_min_body_above`. Matched.

Also confirmed as already correct: the `America/New_York` timezone, killzone boxes tracking full wick high/low, `_box.get(0)` being the most recently closed session, disabled killzones being excluded from the signal loop entirely, `ta.atr(14)`, and the whole engine running on `barstate.isconfirmed` (bar close only).

---

## Real-time signal state

The Signal State panel previously only redrew when a bar closed — on M5 that is once every five minutes, which reads as a frozen panel.

It now updates **once per second** via a live ticker, showing:

- **Live price** on the forming bar, with its running high and low
- **A countdown** to the current bar's close
- **Zone age** against its cutoff, and the **active engine**
- **Session P/L** — closed this session plus what is floating right now
- **Market trend** on the higher timeframe
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

### Signal engines

Per-engine values live in [the three-engine table](#the-three-engines) above — that is the signed-off configuration, and the bot warns loudly at Start about every field that no longer matches it.

Two settings are global rather than per engine:

| Setting | Value | Note |
| :--- | :--- | :--- |
| Enable Buy Signals | **ON** | No sell side exists anywhere in the code |
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

Pip distances, shared by all three engines — see [TP / SL — pip distances](#tp--sl--pip-distances) above.

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

### Floating trade tracking

Open trades are tracked whether or not Auto Trailing is on — knowing what is open and what it
is worth matters even when nothing is being moved. The Performance panel carries live **Open
trades** and **Floating P/L** tiles, and each order reports to the log at most once every three
seconds:

```
Order 1 floating: $30.00 | entry 2000.00 | now 2003.00 | SL 1995.00 | TP none
```

That throttle matters — the account-metrics callback can fire many times a second and would
otherwise bury the signal log entirely.

### Order path test

A **Test Trade — BUY** button places a plain market order with no strategy logic behind it,
behind the platform's own confirmation. It stays enabled while the bot is running, because that
is exactly when it is needed: if signals appear in the log but no trade opens, this splits the
problem in half. Works &rarr; the connection is fine and the issue is the signal path or the
SL/TP format. Fails &rarr; the log carries the broker's exact reason.

It also takes an optional **stop-loss in pips**. That is deliberate: a pip distance is the format
the reference bot proves works on an opening order, so setting it above 0 tests whether SL-on-open
is accepted at all. If a pip stop works here but the bot's absolute-price stop fails, the format
is the culprit and the answer is to leave the attach mode on *After open*.

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
test_engine        24 pass   0 fail
test_engines3      32 pass   0 fail
test_carryover     17 pass   0 fail
test_conditions    11 pass   0 fail
test_replay         9 pass   0 fail
test_sizing         5 pass   0 fail
test_pine_parity   19 pass   0 fail
test_orders        17 pass   0 fail
test_management    32 pass   0 fail
test_trend         17 pass   0 fail
----------------------------------------
TOTAL: 183 pass, 0 fail
```

The suite loads the real engine out of `gps_bot.html` into a stubbed FXBlue sandbox and drives it with synthetic candles. `test_pine_parity.js` specifically locks in each behaviour corrected against the source, with the Pine line cited in the test.

Coverage includes: the full signal sequence with each milestone on its own bar; all three engines running independently on one series and firing three separate entries; the Rolling Lookback reference and its self re-arm; the 5-candle demand zone and how it differs from the FVG gap on identical candles; zone max-age expiry and the require-fresh-sweep rule; pip-based SL/TP on both attach paths; the higher-timeframe trend read and the optional trend gate; session P/L scoping; the restart freeze; cross-session carry-over and its expiry; every fire condition gated independently; a fired setup surviving a session open with persist ON, and being reset with it off; `sig_reset` clearing the refs; invalidation preserving the sweep; configurable session windows; NY Lunch exclusion; EDT resolution; replay placing zero orders; risk sizing against the real stop distance; what actually reaches SendOrder in each attach mode; and the trade-management layer — breakeven, trailing, the never-loosen rule, and the circuit breaker's scope and day boundary.

**Not yet tested against live market data.**

---

## Setup

1. Load `gps_bot.html` into Liquid Charts Pro as an external widget. **Liquid Charts Pro stores a copy of the HTML** — it does not read the file live, so re-paste the widget source after every change.
2. Set **Instrument** to the broker's exact symbol name (reference test: XAUUSD on M5). If no candles arrive within 20 seconds, this field is almost always why.
3. Leave **Trading mode** on **Dry Run**.
4. Check the three engine toggles — all three ON is the signed-off configuration.
5. Set the pip stop and targets under *Advanced → TP / SL*.
6. Open the GPS indicator on TradingView on the same pair and timeframe.
7. Press **Start Bot**.

### Before going live

- Confirm the log fires in sequence: Session Close → Sweep → First zone → Retest → BUY
- Confirm each BUY timestamp matches the indicator's label on the same candle, for each engine
- Confirm each engine logs under its own label and colour, and that its order comment carries `-E1` / `-E2` / `-E3`
- Confirm the stop and target land at the pip distances you set
- Confirm a cross-session setup carries without resetting
- Confirm the Market Trend tile reads sensibly against the H1 chart

Only switch to **Live Trading** once the timestamps line up. Live mode places real orders.

---

## Risk controls

- Dry Run default; live trading needs a deliberate second confirming click
- Fixed-lot or risk-% sizing, measured against the real pip stop distance
- Hard maximum lot cap; optional cap on entries per day
- Refuses to start above the indicator's M30 timeframe limit
- If the broker drops the SL/TP on the opening request, the bot reattaches them and warns loudly if that fails
- Optional higher-timeframe trend gate: BUYs only in a confirmed uptrend
- Refuses to start with every engine switched off, and warns when the stop is set to 0 pips

---

*Developed for Slow Grind Academy. Signal logic verified against the GPS SYSTEM INDICATOR ALGO Pine v6 source, using the client's confirmed live indicator settings.*
