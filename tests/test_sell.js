// The sell side: engines 4-6 as the exact mirror of 1-3.
//   SESSION CLOSE -> sweep of the reference HIGH -> bearish zone -> retest -> SELL
// plus the master direction toggles, pip levels the right way round, and the sell gate.
const { buildSandbox, defaultCfg, run, eng, st, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);   // NY 20:00, EST
const addBar = (bars, ts, o, h, l, c) => bars.push({ ts, o, h, l, c, v: 100 });

// A full bearish sequence for a SESSION-referenced sell engine. The Asia session makes its
// high at 2010; price then sweeps above it, prints a bearish 3-candle FVG, retests the
// supply zone from below, and closes back under it.
function sellSequence() {
  const bars = [];

  // Quiet history so the rolling methods have something to look at.
  for (let i = 60; i > 0; i--) {
    const ts = asiaOpen - i * M5;
    const base = 2006 + Math.sin(i / 3) * 1.5;
    addBar(bars, ts, base, base + 0.8, base - 0.8, base + 0.1);
  }

  // ASIA 20:00 -> 23:55. The session HIGH must reach 2010 — that is the ref_high.
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) addBar(bars, ts, 2009, 2010.0, 2008.5, 2009.5);   // the ASIA HIGH
    else addBar(bars, ts, 2008, 2009, 2007, 2008.5);
  }

  // After midnight NY the session closes and the sequence runs. Mirror of the buy test.
  const t0 = asiaOpen + 48 * M5;
  addBar(bars, t0 + 0 * M5, 2009,   2011.0, 2008.0, 2010.0); // A: SWEEP (high > ref_high 2010)
  addBar(bars, t0 + 1 * M5, 2010,   2010.5, 2007.0, 2008.0); // B: left bar, low 2007
  addBar(bars, t0 + 2 * M5, 2008,   2008.2, 2004.0, 2004.5); // C: middle -> zone_swing_high 2008.2
  addBar(bars, t0 + 3 * M5, 2005,   2006.5, 2003.5, 2004.0); // D: FVG bar, high 2006.5 < B.low 2007
  addBar(bars, t0 + 4 * M5, 2006,   2007.0, 2005.0, 2006.8); // E: retest (high 2007.0 >= bot 2006.5)
  addBar(bars, t0 + 5 * M5, 2007,   2007.1, 2005.8, 2006.0); // F: SELL (close 2006 < 2006.5)
  addBar(bars, t0 + 6 * M5, 2006,   2006.2, 2005.0, 2005.5); // G
  addBar(bars, t0 + 7 * M5, 2005.5, 2005.8, 2004.6, 2005.0); // H
  return bars;
}

// Engine 5 is the session-referenced sell engine in the signed-off config, so it is the
// one this sequence drives. Min body 5% is easily cleared by bar F.
const sellOnly = (over) => defaultCfg(Object.assign({
  enableBuys: false, enableSells: true,
  engines: { e5: { enabled: true } }
}, over || {}));

// ---------------------------------------------------------------- 1: the sequence
{
  const sb = run(buildSandbox(), sellSequence(), sellOnly());
  const s = st(sb, 5);
  const lines = sb.__logLines;

  console.log("===== 1: SELL SEQUENCE =====");
  lines.filter((l) => /SESSION|SWEEP|FVG|SELL|RETEST/i.test(l)).forEach((l) => console.log(l));
  console.log(JSON.stringify({
    ref_name: s.ref_name, ref_high: s.ref_high, sweep: s.sweep, swing_high: s.swing_high,
    zone_top: s.zone_top, zone_bot: s.zone_bot, zone_swing_high: s.zone_swing_high,
    zone_found: s.zone_found, zone_tested: s.zone_tested, fired: s.fired
  }, null, 2));

  check("1: reference locked from ASIA", s.ref_name === "ASIA");
  check("1: ref_high == 2010", Math.abs(s.ref_high - 2010) < 1e-9, "got " + s.ref_high);
  check("1: sweep of the HIGH detected", s.sweep === true);
  check("1: bearish zone found", s.zone_found === true);
  // Supply zone: top = low[2] = bar B's low 2007, bottom = this bar's high 2006.5
  check("1: zone_top == 2007 (the low two bars back)", Math.abs(s.zone_top - 2007) < 1e-9,
    "got " + s.zone_top);
  check("1: zone_bot == 2006.5 (the FVG bar's high)", Math.abs(s.zone_bot - 2006.5) < 1e-9,
    "got " + s.zone_bot);
  check("1: zone_swing_high == 2008.2 (the MIDDLE candle)",
    Math.abs(s.zone_swing_high - 2008.2) < 1e-9, "got " + s.zone_swing_high);
  check("1: retest registered from below", s.zone_tested === true);
  check("1: SELL fired", s.fired === true);
  check("1: engine counted exactly one fire", eng(sb, 5).fires === 1);

  const line = lines.find((l) => l.includes("GPS SELL —")) || "";
  check("1: the log carries the sell engine label",
    line.includes("[Engine 5: Add-On FVG SELL | SESSION sweep]"), line.slice(0, 80));
  check("1: and its colour emoji", line.includes("🟠"));

  // ---- pip levels, mirrored: SL ABOVE entry, TPs BELOW ----
  const sig = sb.signalLog[0];
  check("1: the signal is recorded as a SELL", !!sig && sig.kind === "SELL");
  check("1: SL is 100 pips ABOVE entry", !!sig && Math.abs(sig.sl - sig.entry - 10.0) < 1e-9,
    sig ? "entry " + sig.entry + " sl " + sig.sl : "");
  check("1: TP1 is 100 pips BELOW entry", !!sig && Math.abs(sig.entry - sig.tp1 - 10.0) < 1e-9);
  check("1: TP2 is 200 pips BELOW entry", !!sig && Math.abs(sig.entry - sig.tp2 - 20.0) < 1e-9);
  check("1: TP3 is 300 pips BELOW entry", !!sig && Math.abs(sig.entry - sig.tp3 - 30.0) < 1e-9);

  // ---- the order itself ----
  const o = sb.__orders[0];
  check("1: exactly one order was sent", sb.__orders.length === 1);
  check("1: the order is a SELL", !!o && o.tradingAction === "SELL");
  check("1: it carries the pip stop", !!o && o.sl && o.sl.pips === 100);
  check("1: the comment tags engine 5", !!o && /-E5$/.test(o.comment), o ? o.comment : "");
}

// ---------------------------------------------------------------- 2: master toggles
{
  const sb = run(buildSandbox(), sellSequence(),
    defaultCfg({ enableBuys: true, enableSells: false, engines: { e5: { enabled: true } } }));
  console.log("\n===== 2: SELLS DISABLED BY THE MASTER TOGGLE =====");
  console.log("engines built:", sb.engines.map((e) => e.def.id).join(",") || "none");
  check("2: no sell engine is built when the master toggle is off",
    sb.engines.every((e) => e.def.dir !== "sell"));
  check("2: and nothing was sold", sb.__orders.length === 0);
}
{
  const sb = run(buildSandbox(), sellSequence(),
    defaultCfg({ enableBuys: false, enableSells: true,
                 engines: { e1: { enabled: true }, e5: { enabled: true } } }));
  check("2: no buy engine is built when buys are off",
    sb.engines.every((e) => e.def.dir !== "buy"));
  check("2: the sell engine still runs", sb.engines.some((e) => e.def.id === 5));
}

// ---------------------------------------------------------------- 3: the sell trend gate
{
  // Trend is unknown in the harness (no trend store), so a sell gate set to "downtrend
  // only" must hold the order back while still recording the signal.
  const sb = run(buildSandbox(), sellSequence(), sellOnly({ trendFilterSellOn: true }));
  console.log("\n===== 3: SELL TREND GATE =====");
  console.log("orders:", sb.__orders.length, "| signals:", sb.signalLog.length);
  check("3: the signal is still recorded", sb.signalLog.length === 1);
  check("3: but no order was sent", sb.__orders.length === 0);
  check("3: and the log says the sell gate is why",
    sb.__logLines.some((l) => /NO ORDER SENT/.test(l) && /sell trend filter/i.test(l)));
}
{
  // The BUY gate must not touch sells — the two are independent.
  const sb = run(buildSandbox(), sellSequence(), sellOnly({ trendFilterOn: true }));
  check("3: the buy gate does not block a sell", sb.__orders.length === 1);
}

// ---------------------------------------------------------------- 4: the 5-candle mirror
{
  // Engine 6: G-R-R-R-G after a sweep of the rolling reference high.
  const bars = [];
  for (let i = 40; i > 0; i--) {
    const ts = asiaOpen - i * M5;
    addBar(bars, ts, 2000, 2000.6, 1999.4, 2000.1);   // flat: rolling high ~2000.6
  }
  const t0 = asiaOpen;
  addBar(bars, t0 + 0 * M5, 2000.5, 2002.0, 2000.2, 2001.5); // sweep: high 2002 > 2000.6
  addBar(bars, t0 + 1 * M5, 2001.0, 2003.0, 2000.8, 2002.5); // C1 GREEN  <- the base candle
  addBar(bars, t0 + 2 * M5, 2002.5, 2002.8, 2001.5, 2001.8); // C2 red
  addBar(bars, t0 + 3 * M5, 2001.8, 2002.0, 2000.5, 2000.8); // C3 red
  addBar(bars, t0 + 4 * M5, 2000.8, 2001.0, 1999.5, 1999.8); // C4 red
  addBar(bars, t0 + 5 * M5, 1999.8, 2000.2, 1999.5, 2000.0); // C5 GREEN -> zone = C1 range
  addBar(bars, t0 + 6 * M5, 2000.0, 2003.2, 1999.8, 2002.9); // retest up into the zone
  addBar(bars, t0 + 7 * M5, 2002.0, 2002.2, 2000.0, 2000.2); // breakdown: close < zone bot 2000.8
  // The newest bar is always the forming one and is never processed, so the breakdown
  // needs one bar after it to become a closed bar the engine actually sees. Exactly one:
  // engine 6 uses the rolling reference, which re-arms itself on the bar AFTER a fire, so
  // a second trailing bar would wipe the state this test is inspecting.
  addBar(bars, t0 + 8 * M5, 2000.2, 2000.5, 1999.0, 1999.4);

  const sb = run(buildSandbox(), bars,
    defaultCfg({ enableBuys: false, enableSells: true,
                 engines: { e6: { enabled: true, minBodyPct: 0 } } }));
  const s = st(sb, 6);
  console.log("\n===== 4: 5-CANDLE SUPPLY ZONE (G-R-R-R-G) =====");
  console.log(JSON.stringify({
    sweep: s.sweep, zone_found: s.zone_found, zone_top: s.zone_top, zone_bot: s.zone_bot,
    zone_swing_high: s.zone_swing_high, zone_tested: s.zone_tested, fired: s.fired
  }, null, 2));

  check("4: the rolling high was swept", s.sweep === true);
  check("4: the G-R-R-R-G base was found", s.zone_found === true);
  check("4: the zone is C1's own range, top 2003", Math.abs(s.zone_top - 2003.0) < 1e-9,
    "got " + s.zone_top);
  check("4: zone bottom is C1's low 2000.8", Math.abs(s.zone_bot - 2000.8) < 1e-9,
    "got " + s.zone_bot);
  check("4: the stop anchor is C1's HIGH", Math.abs(s.zone_swing_high - 2003.0) < 1e-9);
  check("4: SELL fired on the breakdown", s.fired === true);
  check("4: and it counted exactly one fire", eng(sb, 6).fires === 1);
  check("4: its label reads Supply Zone, never FVG",
    sb.__logLines.some((l) => /SUPPLY ZONE/i.test(l) && !/FVG/.test(l)));
}

// ---------------------------------------------------------------- 5: sell trade management
{
  // Trailing and breakeven for a short: the stop moves DOWN, and only ever down.
  const sb = buildSandbox();
  sb.cfg = defaultCfg({ autoTrailingOn: true, trailAfterProfitDollars: 20,
                        profitLockDistanceDollars: 5, breakevenBufferDollars: 2 });
  sb.priceDecimals = 2;

  const sent = [];
  sb.Framework.Orders = {
    get: (id) => sb.__order[id] || null,
    forEach() {}
  };
  sb.Framework.SendOrder = (req, cb) => { sent.push(req); cb({ result: { isOkay: true } }); };

  // A short at 2000 now trading at 1995: 5 points in its favour.
  sb.__order = { S1: { orderId: "S1", instrumentId: "XAU/USD", closePrice: 1995,
                       profit: 25, sl: 2010, tp: null } };
  sb.managedOrders = { S1: { entryPrice: 2000, dir: "sell", lots: 0.1,
                             breakevenApplied: false, dollarPerPriceUnit: null, mgmtRetryAt: 0 } };

  sb.manageOpenTrades();
  console.log("\n===== 5: SELL TRAILING =====");
  console.log(JSON.stringify(sent, null, 2));

  // profit $25 >= half of $20, so breakeven fires first. $2 buffer at $5/point = 0.4.
  const be = sent[0];
  check("5: a short moves to breakeven first", !!be && be.tradingAction === "CHANGE");
  check("5: breakeven sits BELOW entry for a short",
    !!be && be.sl < 2000, be ? "sl " + be.sl : "");
  check("5: and it is entry minus the buffer", !!be && Math.abs(be.sl - 1999.6) < 1e-6,
    be ? "sl " + be.sl : "");

  // Second pass: breakeven done, profit clears the full trail threshold, so it trails.
  sent.length = 0;
  sb.managedOrders.S1.breakevenApplied = true;
  sb.__order.S1.sl = 1999.6;
  sb.manageOpenTrades();
  const tr = sent[0];
  check("5: then it trails", !!tr, "sent " + sent.length);
  check("5: the trailing stop is ABOVE price for a short",
    !!tr && tr.sl > 1995, tr ? "sl " + tr.sl : "");
  check("5: at the lock distance — price + $5/point", !!tr && Math.abs(tr.sl - 1996) < 1e-6,
    tr ? "sl " + tr.sl : "");

  // Third pass: a stop that would WIDEN must be refused.
  sent.length = 0;
  sb.__order.S1.sl = 1996;
  sb.__order.S1.closePrice = 1998;      // price moved back against the short
  sb.__order.S1.profit = 10;
  sb.manageOpenTrades();
  check("5: a trail that would loosen the stop is refused", sent.length === 0,
    "sent " + sent.length);
}

// ---------------------------------------------------------------- 6: both sides at once
{
  const sb = run(buildSandbox(), sellSequence(),
    defaultCfg({ enableBuys: true, enableSells: true,
                 engines: { e1: { enabled: true }, e5: { enabled: true } } }));
  console.log("\n===== 6: BOTH SIDES RUNNING =====");
  console.log("engines:", sb.engines.map((e) => "E" + e.def.id + " " + e.def.dir).join(", "));
  check("6: both sides are built together", sb.engines.length === 2 &&
    sb.engines.some((e) => e.def.dir === "buy") && sb.engines.some((e) => e.def.dir === "sell"));
  check("6: the sell engine still fires with a buy engine alongside it",
    st(sb, 5).fired === true);
  check("6: the buy engine kept its own independent state",
    st(sb, 1).fired === false);
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
