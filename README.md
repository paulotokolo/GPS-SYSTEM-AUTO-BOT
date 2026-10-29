# GPS SYSTEM AUTO BOT

A **bi-directional** trading bot that replicates the **GPS SYSTEM INDICATOR ALGO** (TradingView Pine Script v6) signal logic in HTML/JavaScript, built on the **FXBlue Framework** for **Liquid Charts Pro** as an external widget.

Every signal the bot fires is intended to match what the indicator produces on the same pair and timeframe.

The engine tracks the **updated GPS PRO source**, which generalises the original single setup into a configurable pair of choices — where the sweep reference comes from, and what shape the zone is. The client runs **six engines at once** off those choices: three on the buy side and their exact mirror on the sell side.

---

## The six engines

The updated source lets the reference low come from a **closed killzone session** or from a **rolling lowest-low**, and lets the demand zone be a **3-candle FVG gap** or a **5-candle Red-Green-Green-Green-Red base**. Each combination the client trades is one engine, and they run simultaneously on the same instrument and timeframe.

They are fully independent: each keeps its own state, its own sweep, its own zone, and places its own trades. **Engines firing on the same bar are separate entries**, and one engine resetting never touches another.

### Master direction toggles

Two switches sit above every engine, under **Trade Direction**. With a side off, none of its engines is built at all, whatever that engine's own toggle says.

| Toggle | Default | Effect |
| :--- | :--- | :--- |
| Enable BUY signals | **ON** | Engines 1–3 run |
| Enable SELL signals | **OFF** | Engines 4–6 run |

Sells default off so nothing changes for an existing user until they deliberately switch them on and test them. With both on, the bot takes whichever side sets up, and the Trend Settings (50 EMA + ICC) are what stop it fighting the higher timeframe.

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

### The sell side — engines 4 to 6

Engines 4–6 are the **exact mirror** of 1–3. The state machine is shared, with one `dir` flag flipping every comparison, so the two sides cannot drift apart in maintenance:

| | **Buy** | **Sell** |
| :--- | :--- | :--- |
| Reference swept | the **low** (`low < ref`) | the **high** (`high > ref`) |
| Zone | demand, below price | supply, above price |
| FVG condition | `low > high[2]` | `high < low[2]` |
| 5-candle pattern | R-G-G-G-R | G-R-R-R-G |
| Retest | `low <= zone top` | `high >= zone bottom` |
| Fires on | `close > zone top` | `close < zone bottom` |
| Stop anchor | zone swing **low** | zone swing **high** |

| | **Engine 4 — Priority FVG SELL** | **Engine 5 — Add-On FVG SELL** | **Engine 6 — Supply Zone SELL** |
| :--- | :--- | :--- | :--- |
| Sell colour | 🔷 Cyan | 🟠 Orange | 🟣 Purple |
| Reference high | Rolling Lookback | Killzone Session | Rolling Lookback |
| Zone method | FVG Gap (3-candle) | FVG Gap (3-candle) | 5-Candle (G-R-R-R-G) |
| Reference lookback | 50 | 40 | 25 |
| Persist through sessions | ON | ON | ON |
| Require retest | ON | ON | ON |
| Min body below zone | 0% | 5% | 0% |
| Open at/above zone bottom | ON | ON | ON |
| Invalidate if filled | **ON** | OFF | OFF |
| Max zones tracked | 5 | 10 | 5 |
| Require fresh sweep | OFF | OFF | OFF |
| Max zone age | ON — 50 bars | ON — 50 bars | **OFF** — 50 bars |
| Pre-session zone | ON — 50 bars | ON — 50 bars | **OFF** — 50 bars |
| Volume filter | OFF (10, 1) | OFF (10, 1) | OFF (10, 1) |
| Candle size filter | OFF (10, 1) | OFF (10, 1) | OFF (10, 1) |

```
🔷 GPS SELL — [Engine 4: Priority FVG SELL | Rolling sweep]
🟠 GPS SELL — [Engine 5: Add-On FVG SELL | SESSION sweep]
🟣 GPS SELL — [Engine 6: Supply Zone SELL | Rolling sweep]
```

> **Where these defaults came from.** The sell defaults above are the client's **own TradingView settings**, read off the screenshots they sent for each engine. They differ from the prose in the upgrade brief in a few places — the brief has engine 4 on a session reference and engine 5 on rolling (the screenshots have them the other way round), and gives engine 6 fresh-sweep ON, max-age 39 and invalidate ON. Every one of these is a UI setting, so either can be dialled in without a code change; the live config was taken as the more current of the two. **Worth confirming with the client before sign-off.**

### Rolling Lookback

The reference is the lowest low of the last N bars, tracked continuously, so the engine never waits for a killzone to close. It is **frozen the moment a sweep fires** so the target does not slide while the engine waits for its zone, and it resumes trailing once the cycle resets.

A rolling engine also **re-arms itself** after firing: with no session boundary to reset it, the tracking state is cleared on the next bar so it can hunt a fresh setup. Session engines instead hold `fired` until their next session close.

### The 5-candle zone

After the sweep, a buy engine watches for Red, Green, Green, Green, Red; a sell engine watches for Green, Red, Red, Red, Green. The zone is **the first candle's own high-to-low range** — a tight, single-candle zone rather than a gap. Only the first match after each sweep is taken.

### Zone lifetime

A zone that ages past its cutoff without a breakout **expires**: the zone is dropped and the engine keeps hunting. Whether the sweep survives that (and survives an invalidation) is what *Require fresh sweep before next zone* controls — ON means price must sweep a new extreme — a lower low for a buy engine, a higher high for a sell — before another zone can be marked.

### Dynamic label names

Every zone-related label follows the method **and** the direction the engine is set to. Choose **FVG Gap** and the labels read *FVG*; choose **5-Candle Pattern** and a buy engine reads *Demand Zone* while a sell engine reads *Supply Zone*. Sell engines also flip *above*→*below* and *top*→*bottom* throughout, and ask for a **bearish** breakout candle. Engines 3 and 6 are the named-zone engines and their method never changes.

---

## Trend filters — 50 EMA + ICC

The **4H identifies** the trend, the **1H confirms** it, the **5M only triggers** the entry. The bot requests a 1H and a 4H candle feed alongside the 5M; neither ever drives a GPS engine, they only update the trend state. Nothing reads the 5M for direction — the 5M price is used only as "where is price right now" against the 1H/4H values.

Both filters are independent toggles under **Trend Settings**. With both on, both must agree.

> **Upgrading from an earlier version:** the 50 EMA filter now defaults **ON** (4H) and replaces the old *Only take BUYs in an uptrend / SELLs in a downtrend* switches. Buys are held while price is below the 4H 50 EMA, so signals that used to place trades may now log `NO ORDER SENT — EMA filter`. Untick *Enable 50 EMA filter* to trade as before. The bot says this in the log on load and at the first Start for anyone with settings saved by an older version.

| Setting | Default | |
| :--- | :--- | :--- |
| Enable 50 EMA filter | **ON** | Buys only above the EMA, sells only below it |
| EMA timeframe | **4H** | 1H / 4H / Both (both must agree) |
| EMA period | 50 | Computed from closed 1H/4H bars |
| Enable ICC filter | **OFF** | Reads the shared ICC cycle (below) |
| Swing strength (bars each side) | 3 | Used on every ICC timeframe |
| Swing source | **Close** | Candle body rule: swings and phases use closes. *Wick* measures highs/lows, matching Liquid's *Swing Prices* labels |
| Pause GPS on opposite bias | **ON** | Bullish break pauses sells; bearish pauses buys |
| Auto close on ICC invalidation | **OFF** | Live only; closes trades the NTZ is disrespected against |

**ICC Filter — one NTZ for the whole bot.** The filter has no structure scan of its own: it reads the **shared ICC cycle** described under *ICC Entry Models* — the same locked NTZ high and low, the same break, the same phase — so the filter and the entry models can never disagree about where the NTZ is. (It used to measure its own NTZ from the low that *started* the rally to the high; the client asked for one consistent NTZ everywhere.)

- **Bias** is the cycle's break direction. `NTZ` while the levels are locked but unbroken, `NEUTRAL` while the cycle is scanning for a fresh swing high and low (e.g. right after a cycle completes). Both hold every GPS order.
- **1H structure** is `CONFIRMED` once the cycle reaches Continuation; the break direction is only allowed from then (whichever entry type *1H continuation check* selects).
- **Invalidation**: when the cycle logs `LEVEL DISRESPECTED` against an open trade, the filter warns (`ICC INVALIDATION WARNING — …`) and, with *Auto close* ON in Live mode, closes it.

The cycle's structure timeframe (1H / 4H / Daily), *Max wait*, *Swing strength* and *Swing source* are shared by the filter and both models. The cycle runs whenever the filter or either model is on, and logs as `[ICC] …`.

**The gates stop the order, not the signal.** They run in the brief's order — EMA, ICC 4H bias, ICC 1H continuation — and a held signal is still logged and exported with the exact reason (`NO ORDER SENT — GPS signal held — ICC bias is NTZ…`). Blocking the engine itself would desynchronise its state from the indicator's and later signals would stop matching TradingView.

The Signal State panel shows **4H EMA** and **1H EMA** (value, ABOVE/BELOW), then an **ICC FILTER** section: **ICC bias**, **ICC phase** (INDICATION / CORRECTION / CONTINUATION / GPS ARMED), the **shared NTZ** and **1H structure** (CONFIRMED / WAITING), refreshed every second. The **Market trend** read-out above them (UPTREND / DOWNTREND / RANGING, price vs EMA *and* slope) is unchanged and follows the EMA timeframe; it is information only.

## ICC Entry Models — GPS Entry Model and ICC Entry Model

Two separately toggled entry models (both **OFF** by default) that read **one shared ICC cycle**. The NTZ, the phase and the resets are calculated once, on one structure timeframe (**1H, 4H or Daily**, shared; default 4H), with the **1H** as the entry layer — so both models always show the same levels and phase. They differ only in how they enter. The structure timeframe only changes which candles the NTZ, the indication, disrespect and *Max wait* read; every rule is the same on all three. On **1H** structure the NTZ swings, the break and the correction/continuation all come from the 1H, so the ICC Entry Model enters on the 1H and the GPS Entry Model's FVG engine switches on (5M / 15M) once 1H continuation is confirmed. The ICC Filter above reads this same cycle; neither model is blocked by it.

**The shared cycle**

1. **Lock.** The most recent confirmed structure-TF swing high and swing low (*Swing strength* bars each side, measured on *Swing source*) become the NTZ. **Until the break, the NTZ always follows the most recent swings**: each newly confirmed swing high or low replaces its side at once (logged `NTZ UPDATED`, panel label *NTZ levels (latest)*) and that same close is checked against the new levels, so a close already outside them is the indication. From the indication on, the levels are frozen until the cycle ends (*NTZ levels (locked)*); later swings are logged `IGNORED`. The panel label also names where the swings come from (e.g. *1H swings (7, wick)*) — to match Liquid's *Swing Prices (n)* labels, set the structure timeframe to the chart's timeframe, *Swing strength* to n and *Swing source* to Wick. There is no waiting for "fresh" swings: on Start, and the moment a cycle ends, the most recent pair is locked at once, and if only one half exists yet it is shown with the other *pending* and the pair locks the moment the missing half confirms. The one exception: if the most recent pair is the very pair a cycle just finished on (target hit or timed out), it is drawn but a new break only counts once price has closed back inside it, or once a newer swing replaces one side — so the same move is never traded twice.
2. **Indication.** A structure-TF candle **body closes** outside the NTZ. Wicks never count.
3. **Correction** and 4. **Continuation** depend on *1H continuation check* (shared setting, default ON):

   | Entry type | Correction | Continuation (the entry, for the ICC Entry Model) |
   | :--- | :--- | :--- |
   | **1 — check ON** | The 1H turns against the break (a 1H swing high after a bullish break). Price does **not** have to come back into the NTZ — a shallow pullback qualifies | A 1H body close back in the break direction, beyond the latest corrective swing |
   | **2 — check OFF** | **Live** price crosses back **into** the NTZ through the broken level — no close needed; the panel shows CORRECTION on the tick (in history, a 1H candle opened after the break whose low/high went inside) | A **structure-TF** body close back **out** through the NTZ level in the break direction |
   | **3 — Aggressive Entry Mode** | Price back inside the NTZ (live) | The moment live price crosses back out — no candle close (ICC Entry Model only; see below) |

   The panel phase always follows the entry type selected here; Aggressive mode only changes how the ICC Entry Model triggers. **The GPS Entry Model always needs a structure-TF body close beyond the NTZ**: on type 2 that is the continuation close itself; on type 1 the FVG engine goes on at that same moment if the structure candle also closed beyond the NTZ, otherwise at the next structure close that does (logged as waiting). Only 1H candles that open after the continuation close can hit the target.

   The TP target is fixed at continuation and never moves: the **most recent pre-existing structure-TF swing beyond the NTZ and the trigger** — a swing high above for buys, a swing low below for sells, already confirmed on the chart when continuation happens. The level is that swing candle's **wick** (its high on a swing high, its low on a swing low) whatever the *Swing source* — that is where the liquidity is; *Swing source* only decides which candles are swings. If there is none, TP1 pips from the trigger. Aggressive entries, which come before continuation, look the target up the same way from the entry price.
5. **Complete.** Price **touches** the target — live, on the forming 1H candle, no close needed (only 1H candles that open after the continuation close count): `✅ CYCLE COMPLETE — SWING TARGET REACHED at … on the 1H candle of …. Bot reset.` in each model's log, one *CYCLE COMPLETE* row in the signal log / CSV (target price and that candle's time), and *Cycle status: COMPLETE ✅ — target … reached* until the next cycle breaks out (*Last cycle status* keeps COMPLETE after that).

**Resets** — besides completing, an active cycle ends on exactly two things: **disrespect** (a structure-TF candle *body* closing through the opposite side of the locked NTZ — below the low on a bullish cycle, above the high on a bearish one; wicks never count, and that same close can start the opposite cycle) or **timeout** (a phase reaching *Max wait* structure candles without progressing, default 20). New swings — even ones beyond the locked level, e.g. during the correction — never end a cycle; they are logged as ignored. After any reset the next NTZ is locked straight away (see *Lock*).

**Panel.** Each ICC section has a coloured header bar (ICC Filter teal, ICC Entry Model purple, GPS Entry Model navy). The phase is colour-coded with a 3-dot progress tracker — WAITING grey ●○○, INDICATION yellow ●●○, CORRECTION blue ●●●, CONTINUATION green ●●● — and WAITING means no structure close has broken the NTZ yet; the break direction names the candle that broke it. *NTZ levels (live / locked)*, *Price position* (INSIDE / ABOVE / BELOW NTZ, live) and *Cycle expires in* (structure bars left before *Max wait* ends the phase; the timer starts at a break) sit alongside.

*Cycle status* is only ever the current cycle — `SCANNING` (no swing pair yet), `WAITING FOR INDICATION` (NTZ locked, no break) or `ACTIVE` — and separate *Last cycle status* / *Last cycle date* boxes show how the previous one ended — COMPLETE (silver; "· no entry" in grey if that model never entered it), DISRESPECTED / TIMED OUT (red) — so the panel never contradicts itself.

The cycle is replayed from history on every update, so on Start the phase is wherever the cycle already is — it never shows WAITING just because the bot started.

**Per-model settings**

| Setting | Default | |
| :--- | :--- | :--- |
| Require all timeframe alignment | OFF | Entry condition only — never changes the NTZ or phase. ON: in Continuation, Daily and 4H must agree, then price pulls back to the latest 1H swing (higher low / lower high) before the model enters |
| TP = structure swing high/low | **ON** | OFF = Take profit 1 (pips) |
| Stop loss | **Fixed pip stop** | or the latest 1H swing high/low, or the latest structure swing high/low (wick); falls back to pips if the swing is not on the right side |
| Trail after TP | OFF | ON: no TP is placed; the trade is not trailed until price reaches the target, then **Auto Trailing** takes over and the bot moves on |

**ICC Entry Model** runs without the GPS engines: with it ON the bot starts even with every engine switched off (only the GPS Entry Model, which trades through the engines, needs at least one). The continuation 1H close (alignment OFF) or the first trend-direction 1H close off the pullback (alignment ON) is the entry: one market order per cycle, tagged `GPSBOT-ICC`. It follows the master direction switches, Dry Run, sizing, the daily cap, circuit breaker and trading window, but not the 50 EMA / ICC filter. History never trades — only the 1H candle that just closed.

**ICC Entry Model — Aggressive Entry Mode** (toggle, default OFF). Same shared cycle; only the trigger changes. After the indication the model **arms only when a structure-TF candle body (1H, 4H or Daily, whichever the cycle uses) closes back inside the NTZ** — a tick, a wick or a close on a lower timeframe never arms it — and the entry fires the moment **live** price crosses back out through the broken level (above the NTZ high on a bullish cycle, below the low on a bearish one) — no candle close, no structure confirmation, no pullback wait, and **alignment has no effect** (use Standard for alignment). SL sits inside the 1H swing range: the midpoint of the latest 1H swing high and swing low, or halfway to the arming candle's low (high on sells) if that midpoint is not below the entry. TP is the structure target; Trail after TP works as in Standard. Each arm is used once; another structure-TF close back inside re-arms it — **max 2 entries per cycle**. Live price has to be seen inside after an arm before a cross counts, so a bot started with price already outside never chases a cross that happened while it was off. Orders are tagged `GPSBOT-ICCA`; the panel's *Entry mode* row shows ARMED / waiting and entries used.

**GPS Entry Model — the ICC FVG engine.** A standalone entry engine for ICC continuation; it does **not** use the six standard GPS engines (no sweeps, kill zones, add-ons or rolling references), and they no longer route through it — with both on, the standard engines trade their own signals independently (the start log warns about this; switch them off to run the FVG engine alone, which needs no standard engine).

| Setting | Default | |
| :--- | :--- | :--- |
| FVG entry timeframe | **15M** | 5M or 15M — the engine's own candle feed |
| Max entries per cycle | **2** | 1–10; after it, TP monitoring |
| Stop loss mode | **Fixed pip** | *Fixed pip*, or *Structure TF swing* — just beyond the NTZ level continuation broke back from: the low of the NTZ swing-low candle on buys, the high of the swing-high candle on sells (falls back to the pip amount if that is not beyond the entry) |
| Fixed pip SL amount | 100 | this model's own pip stop; shown only in Fixed pip mode |
| Volume confirmation | **ON** | OFF: a tap and close back out is enough, no volume spike needed |
| Volume lookback | 20 | candles in the volume baseline (shown while volume confirmation is ON) |
| Volume multiplier | 1.5 | the exit candle's volume must be above this × the baseline average |

- **TP monitoring panel:** while the engine waits for the target, *TP target* (the cycle's structure target) and *TP distance* (live price to the target, in points and pips, refreshed every second) are shown; they are hidden otherwise.
- **Dormant** until the shared cycle reaches continuation **and** a structure-TF body close beyond the NTZ has confirmed it (with alignment ON: Daily/4H agree and price pulls back to the latest 1H swing).
- **Tracking:** every FVG in the break direction on the entry TF formed since the continuation candle opened — bullish (low above the high two candles back) on a bullish cycle, bearish on a bearish one.
- **Entry:** price comes back **into** an FVG, then a candle **closes back out** of it in the break direction on a volume spike — entry at that close, market order tagged `GPSBOT-GPSM`. A tap that exits without the volume is logged and does not count; the FVG stays live and needs price back inside before the next exit can.
- **Replacement:** a new bullish FVG forming entirely below a tracked one replaces it (bearish: above). Nothing else retires an FVG except its own entry.
- **Max entries:** once used, the engine stops tracking and the cycle runs to its TP target (*TP monitoring*), then resets with the shared cycle.
- **TP:** every entry in the cycle aims at the same structure TF swing target (the cycle's target); *Trail after TP* works as in the ICC Entry Model. Not filtered by the 50 EMA. Only an FVG exit on the candle that just closed after the engine went live is traded — history never is.
- **Cycle end:** target hit, structural failure (a structure-TF body close through the wrong side of the NTZ) or Max wait — then the engine resets and waits for the next continuation.

The panel's *Engine status* reads DORMANT / ACTIVE — tracking N FVGs · entries x/max / TP MONITORING.

Each model has its own Signal State panel: phase, cycle status, break direction, locked NTZ, Daily / 4H / 1H alignment (✅/❌, when alignment is on), engine status / entry TF (GPS) and last entry. On Start the bot logs `[ICC] Session start — Locked NTZ High … | Current Phase …`. The signal CSV has a **Model** column.

## TP / SL — pip distances

The swing-high TP system is gone. Stops and targets are now **pip distances from the entry price**, shared by all six engines:

| Setting | Default |
| :--- | :--- |
| Stop loss | 100 pips |
| Take profit 1 | 100 pips |
| Take profit 2 | 200 pips |
| Take profit 3 | 300 pips |

A buy stops below its entry and targets above it; a sell is the mirror. 0 switches a level off. One order goes out per signal carrying **TP1**; TP2 and TP3 are logged and exported with the signal as the levels to scale out at — the bot never splits one signal into three orders.

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
| `tests/` | Automated test suite (568 assertions). |
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

## Performance (this session)

Every counter starts at 0 when the bot goes live and only counts live activity. The start-up history replay rebuilds the signal log and CSV (that is what the TradingView comparison needs) but never adds to *Signals fired* or the add-on count, and live bar processing only begins once that replay has run — so history can never be counted, or traded, as live. Closed trades from before Start stay in the trade history the daily circuit breaker totals the day from; the panel just counts the ones closed since Start (or since *Reset stats*, which no longer wipes that history).

## Real-time signal state

The Signal State panel previously only redrew when a bar closed — on M5 that is once every five minutes, which reads as a frozen panel.

It now updates **once per second** via a live ticker, showing:

- **Live price** on the forming bar, with its running high and low
- **A countdown** to the current bar's close
- **Zone age** against its cutoff, and the **active engine**
- **Session P/L** — closed this session plus what is floating right now
- **Market trend** on the higher timeframe, and the **4H / 1H 50 EMA** with price ABOVE / BELOW
- **ICC FILTER** — bias, phase, the shared NTZ and 1H structure
- **ICC Entry Model** and **GPS Entry Model** panels (when on) — phase, cycle status, break direction, locked NTZ, alignment, entry mode / engine status, entry TF and last entry
- **The active session**, tracked from the forming bar
- **A pulsing live indicator** with the last update time

### Reading the log

The log is laid out as **dated blocks**, because it is read while looking at a chart:

- A **sticky heading each time the trading day changes** — `WEDNESDAY 9TH SEPTEMBER 2026`. Dates are spelled out, never `09/09`, which means something different depending on where you live.
- One **padded block per event**, carrying the wall-clock time it was written and the **bar's own New York time** (`00:25 EST`) — the second is the one that has to line up with the indicator's label.
- Levels sit on their **own indented lines** under the headline rather than trailing off the end of it, so a BUY reads as entry, then SL, then each TP with its pip distance.
- Key phrases are badged in colour. The badge shows the words **verbatim** — it only adds colour, so the panel never disagrees with the exported CSV or with anything you search for.

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

Pip distances, shared by all six engines — see [TP / SL — pip distances](#tp--sl--pip-distances) above.

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

## Trading session window

A plain clock gate on **new** orders, sitting on top of everything else. Default **OFF**, in which case the bot trades any time exactly as before.

| Setting | Default |
| :--- | :--- |
| Enable session window | **OFF** |
| Start trading at | 08:00 AM |
| Stop trading at | 11:00 AM |
| Your timezone | Eastern / Central / Mountain / Pacific |
| Flatten open trades at window end | **OFF** |

It changes **none** of the GPS logic. Every engine still tracks its sessions, locks its references, detects its sweeps and logs its signals. A signal blocked by the window is still written to the log and the CSV — what the window stops is the **order**.

Management is untouched too. Anything already open keeps being trailed, moved to breakeven and covered by the daily circuit breaker, because a trade that is running still needs its stop moved whatever the clock says. *Flatten at window end* is the opt-in that closes the book instead.

Three details worth knowing:

- **It is not the same thing as the killzone Session Windows** further down the panel. Those decide where a reference level comes from and are part of the strategy. This decides when an order is allowed out, and is not.
- **A window whose end is before its start runs overnight** — 10:00 PM to 2:00 AM is read as one window crossing midnight, not an empty one.
- **A window it cannot read fails open.** Unparseable times or an unknown timezone mean the window is ignored and trading continues, with a warning. The alternative — failing closed — would silently block every trade for a day.

The edge is checked on a one-second clock rather than on price, so a window that closes into a dead market still closes, and still flattens if asked.

---

### Trade continuity across a reconnect

Liquid Charts Pro can throw a **rejected by broker** error on a connection glitch while the trade is actually live on the broker. Refreshing the app to reconnect wipes the widget, and the bot used to come back with an empty managed-orders list — so a position that was still open got no trailing, no breakeven and no circuit-breaker cover.

The bot no longer assumes it placed everything it manages. It asks the broker what is actually open:

- **On Start**, before the candle replay. A trade that survived a refresh is live money sitting unmanaged right now; it should not wait on a few thousand bars of history.
- **Every 15 seconds** after that. This is deliberately a sweep rather than a connection event — the platform exposes no reconnect callback this widget can rely on, and one sweep covers a reconnect, a missed `OnOrderOpen`, and a trade opened from another window with no dependency on an API that might not exist. Where the framework *does* expose a connection callback it is hooked as well, so recovery is instant rather than up to one sweep late.

Adoption is **idempotent** — a trade already tracked is left exactly as it is, so the sweep can run as often as it likes.

```
🔄 RE-ADOPTED — XAU/USD open trade detected
     Side        SELL  0.10 lots
     Entry       2004.00
     Current P/L +42.50
     Stop        2014.00
     Trailing and breakeven management resumed
```

**Breakeven state is re-earned, not guessed.** An adopted trade starts with `breakevenApplied` unset, and the next management pass derives it from the position itself: if the stop is already at or beyond breakeven it is marked done without touching anything; if the trade is already past the trigger the stop moves straight away. Management runs once on the adoption pass itself, so a reconnect that lands on a quiet market does not wait for the next price tick.

| Setting | Default | |
| :--- | :--- | :--- |
| Pick up existing trades | **ON** | Master switch for the whole feature |
| Only ones this bot placed | **OFF** | Every order is tagged (`GPSBOT-E4`), so the bot can tell its own trades from a manual one. OFF adopts anything open on the instrument, which is what hands-free running needs. ON if you also trade the symbol by hand. |

Manual trades are managed the same way — management and logging follow the existence of an open trade, not who opened it. A manual trade opened while the bot is running is picked up on `OnOrderOpen` without taking a queued bot entry's levels.

- A trade **with no SL/TP** gets them from your Stop loss / Take profit 1 (pips) settings, measured from that trade's own entry. A level already set by hand is never overwritten; a level price has already passed is reported and skipped rather than sent to be rejected. With *Attach stop-loss* off, a trade with no stop is flagged loudly and left as it is.
- **Dry Run sends nothing**, including stop modifications. Adopted trades are tracked and shown in the panel, and the log says plainly that nothing will be moved. A stop modification is an order, and Dry Run's contract is that it never sends one.

### The circuit breaker survives a refresh

A tripped breaker is written to the saved settings stamped with the EST day it belongs to, so *stop trading for the rest of the day* no longer means *stop trading until someone reloads the app*. On Start the bot re-trips if the stored day is still today, puts any adopted trade back on the close queue, and continues a flatten that the app going down had interrupted. It lapses by itself at the next EST day.

### Direction and trade management

Every management feature works on both sides, reversed:

| | **Buy (long)** | **Sell (short)** |
| :--- | :--- | :--- |
| In profit when | price rises | price falls |
| Breakeven stop | entry **+** buffer | entry **−** buffer |
| Trailing stop | price **−** lock distance | price **+** lock distance |
| "Only ever tighten" means | the stop may only **rise** | the stop may only **fall** |

The buffer always lands on the profitable side of the entry, so breakeven is a small win rather than a small loss once the spread is paid. The circuit breaker and the performance tiles count both directions together.

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
test_sell          49 pass   0 fail
test_adopt         53 pass   0 fail
test_window        33 pass   0 fail
test_icc           68 pass   0 fail
test_models       182 pass   0 fail
----------------------------------------
TOTAL: 568 pass, 0 fail
```

The suite loads the real engine out of `gps_bot.html` into a stubbed FXBlue sandbox and drives it with synthetic candles. `test_pine_parity.js` specifically locks in each behaviour corrected against the source, with the Pine line cited in the test.

Coverage includes: the full signal sequence with each milestone on its own bar; all six engines running independently on one series and firing separate entries; the sell side as the exact mirror of the buy side, with the master direction toggles gating each; sell-side trailing and breakeven reversing correctly and refusing to loosen; the Rolling Lookback reference and its self re-arm; both 5-candle zones (R-G-G-G-R and G-R-R-R-G) and how they differ from the FVG gap on identical candles; zone max-age expiry and the require-fresh-sweep rule; pip-based SL/TP on both attach paths; the higher-timeframe trend read; the 50 EMA gate on 1H, 4H and Both, computed from 1H/4H bars only; swing detection on closes (body rule) or wicks at any swing strength, matching Liquid's *Swing Prices* labels; the one shared ICC cycle — swing lock and ignored swings, body-close indication, correction and continuation for entry types 1 and 2 (type 2's live correction on the forming 1H and structure-TF continuation, the GPS model's structure-close confirmation on type 1), completion at the TP target, disrespect (and the same close starting the opposite cycle), Max wait timeouts in every phase, and new swings (even beyond the locked level) never ending a cycle — with the ICC Filter, both entry models and alignment ON/OFF all reading identical levels and phases; the filter's opposite-bias pause, invalidation warning and auto close; the ICC Entry Model's market entry, SL and TP options, trail after TP and one trade per cycle, and Aggressive Entry Mode's live-cross trigger, tight stop and two-entry cap; the GPS Entry Model's ICC FVG engine — FVG tracking from the continuation candle, tap-and-exit entries only on a volume spike, the no-volume exit, replacement by a lower (higher) FVG, the max-entry cap and TP monitoring, both stop-loss modes, volume confirmation OFF, the structure target, both directions, dormant before continuation, and the standard engines staying independent; history never placing an order; the gates holding the order but not the signal; adopted and manual trades getting SL/TP from settings; session P/L scoping; the restart freeze; cross-session carry-over and its expiry; every fire condition gated independently; a fired setup surviving a session open with persist ON, and being reset with it off; `sig_reset` clearing the refs; invalidation preserving the sweep; configurable session windows; NY Lunch exclusion; EDT resolution; replay placing zero orders; risk sizing against the real stop distance; what actually reaches SendOrder in each attach mode; and the trade-management layer — breakeven, trailing, the never-loosen rule, and the circuit breaker's scope and day boundary.

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
- Confirm the 4H/1H EMA values match a 50 EMA on the 4H/1H chart
- With ICC (filter or entry models) on, confirm that before a break the NTZ in the panels is the most recent swing high and swing low on the structure chart (and updates as new swings confirm), that it freezes once broken, that every ICC panel shows the same levels, and that the bias only changes on a structure-TF close
- With the ICC Entry Model on, confirm in Dry Run that its entry, SL and TP log lines match the entry type you chose (1H continuation check ON / OFF, or Aggressive)

Only switch to **Live Trading** once the timestamps line up. Live mode places real orders.

---

## Risk controls

- Dry Run default; live trading needs a deliberate second confirming click
- Fixed-lot or risk-% sizing, measured against the real pip stop distance
- Hard maximum lot cap; optional cap on entries per day
- Refuses to start above the indicator's M30 timeframe limit
- If the broker drops the SL/TP on the opening request, the bot reattaches them and warns loudly if that fails
- Trend gates: 50 EMA on the 1H/4H, and the ICC Filter on the shared ICC cycle
- ICC entry models: one ICC Entry Model trade per cycle (two in Aggressive mode), never from history, never off a 1H candle more than an hour old; every cycle times out after *Max wait* structure candles per phase
- Refuses to start with every engine switched off, and warns when the stop is set to 0 pips

---

*Developed for Slow Grind Academy. Signal logic verified against the GPS SYSTEM INDICATOR ALGO Pine v6 source, using the client's confirmed live indicator settings.*
