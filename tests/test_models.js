// ICC Entry Models: ONE shared ICC cycle (swing lock, phases, resets) that both the ICC Entry
// Model and the GPS Entry Model read, the per-model entry conditions, and their orders.
const { buildSandbox, defaultCfg, run, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const H1 = 3600e3, H4 = 4 * H1, D1 = 24 * H1;
// The last full hour before now: the scenario's continuation candle closes there, so a
// "live" entry is minutes old rather than hours. (Structure bars need not sit on real
// 4H boundaries for the cycle.)
const END = Math.floor(Date.now() / H1) * H1;

// 1H closes in groups of four; each group is one 4H candle. o = previous close, wicks 1.
function series(groups, startTs) {
  const h1 = [], h4 = [];
  let prev = groups[0][0];
  groups.forEach((g, gi) => {
    const gBars = g.map((c, k) => {
      const o = prev; prev = c;
      return { ts: startTs + (gi * 4 + k) * H1, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 100 };
    });
    h1.push(...gBars);
    h4.push({ ts: gBars[0].ts, o: gBars[0].o, h: Math.max(...gBars.map((b) => b.h)),
              l: Math.min(...gBars.map((b) => b.l)), c: gBars[3].c, v: 400 });
  });
  return { h1, h4 };
}
// Extra 1H closes after a series (no new 4H candle closes).
function more(s, closes) {
  let prev = s.h1[s.h1.length - 1].c;
  closes.forEach((c) => {
    const o = prev; prev = c;
    s.h1.push({ ts: s.h1[s.h1.length - 1].ts + H1, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 });
  });
  return s;
}

// The base bullish scenario (closes):
//   G1 104 = swing high, G2 101 = swing low  -> NTZ 104 / 101 locked at G3's close
//   G3 103 / G4 102 = new swings inside      -> ignored
//   G6 closes 109 above 104                  -> INDICATION (bullish)
//   1H 111 swing high, then lower high 108.5 -> CORRECTION
//   1H closes 109.5 above 108.5              -> CONTINUATION, target 110.2 (4H extreme)
const BASE = [
  [99, 100, 100, 100], [102, 104, 104, 104], [103, 102, 101, 101], [102, 103, 103, 103],
  [102, 102, 102, 102], [103, 103.5, 103.5, 103.5], [104.5, 106, 108, 109],
  [110, 111, 110.5, 110.2], [107, 108.5, 107.5, 109.5]
];
const START = END - BASE.length * H4;
// Same shape with the post-break high at 113, so the target sits well above the
// continuation — for scenarios that need price to wander before it is reached.
const WIDE = BASE.slice(0, 7).concat([[110, 114, 113.5, 113], [107, 108.5, 107.5, 109.5]]);

function storeOf(bars, tfMs) {
  const last = bars[bars.length - 1];
  const all = bars.concat([{ ts: (last ? last.ts : END) + tfMs, o: 1, h: 1e9, l: -1e9, c: 1, v: 1 }]);
  return { get length() { return all.length; }, GetCandle(i) { const k = all.length - 1 - i; return k >= 0 ? all[k] : null; } };
}

function modelSandbox(over) {
  const sb = buildSandbox();
  sb.cfg = defaultCfg(Object.assign({
    iccStructTf: "4h", iccSwingStrength: 1, iccSwingSource: "close", iccMaxWait: 20,
    iccModelOn: true, iccModelAlign: false, iccModelTpStruct: true, iccModelSlMode: "pips", iccModelTrail: false,
    gpsModelOn: false, gpsModelAlign: false, gpsModelTpStruct: true, gpsModelSlMode: "pips", gpsModelTrail: false,
    sizingMode: "fixed", fixedLots: 0.1
  }, over || {}));
  sb.priceDecimals = 2;
  sb.isRunning = true;
  sb.managedOrders = {};
  sb.forceCloseQueue = {};
  sb.resetEntryModels();
  return sb;
}
const mods = (sb) => ({
  icc: { on: !!sb.cfg.iccModelOn, align: !!sb.cfg.iccModelAlign },
  gps: { on: !!sb.cfg.gpsModelOn, align: !!sb.cfg.gpsModelAlign }
});
const cycle = (sb, d) => sb.runIccCycle(sb.cycleParams(), d, mods(sb));
const types = (st, kind) => st.events.filter((e) => kind === undefined || e.kind === kind).map((e) => e.type.split("|")[0]);
const shared = (st) => st.events.filter((e) => !e.kind).map((e) => e.type + "@" + e.ts).join(",");
// Feed a series in two steps (everything but the last 1H candle, then all of it) — the
// first is the start-up read, the second is that candle closing live.
function liveFeed(sb, s) {
  const lastTs = s.h1[s.h1.length - 1].ts;
  sb.h4Store = storeOf(s.h4.filter((b) => b.ts + H4 <= lastTs), H4);
  sb.h1Store = storeOf(s.h1.slice(0, -1), H1);
  sb.updateEntryModels();
  sb.h4Store = storeOf(s.h4, H4);
  sb.h1Store = storeOf(s.h1, H1);
  sb.updateEntryModels();
}

// ---------------------------------------------------------------- 1: the shared cycle
{
  const sb = modelSandbox({ gpsModelOn: true });
  const s = more(series(BASE, START), [110.5]);
  const st = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  console.log("===== 1: ONE SHARED CYCLE, BOTH MODELS ON =====");
  st.events.filter((e) => !/IGNORED/.test(e.type)).forEach((e) => console.log(e.text));
  check("1: the NTZ locks once per cycle, shared by both models",
    st.events.find((e) => e.type === "LOCK" && e.kind === null) &&
    /^\[ICC\] Swing high locked: 104\.00 \| Swing low locked: 101\.00/.test(st.events.find((e) => e.type === "LOCK").text));
  check("1: later swings inside the NTZ are IGNORED, the lock holds",
    st.events.some((e) => /New swing detected at 103\.00 — IGNORED/.test(e.text)));
  check("1: one INDICATION on the 4H body close above 104",
    st.events.filter((e) => e.type === "INDICATION").length === 1 &&
    st.events.some((e) => /4H closed above NTZ 104\.00\. Break direction: BULLISH/.test(e.text)));
  check("1: CORRECTION when the 1H turns down — price never came back into the NTZ",
    st.events.some((e) => e.type === "CORRECTION" && /swing high 111\.00/.test(e.text)));
  check("1: CONTINUATION on the 1H close above the lower high, with the 4H target",
    st.events.some((e) => e.type === "CONTINUATION" && /closed above 108\.50\. TP target 110\.20/.test(e.text)));
  const entry = st.events.find((e) => e.type === "ENTRY");
  check("1: the ICC model enters on that same 1H close", !!entry && entry.entry === 109.5 && entry.kind === "icc");
  check("1: the GPS model's engines switch on at that same close",
    st.events.some((e) => e.type === "ACTIVE" && e.kind === "gps" && e.ts === entry.ts));
  check("1: the cycle does NOT end at the entry — it ends when the TP target is hit",
    st.events.filter((e) => e.type === "COMPLETE").every((e) => e.ts > entry.ts));
  check("1: each model logs the brief's completion line",
    st.events.some((e) => e.text === "[ICC ENTRY MODEL] CYCLE COMPLETE — TP target hit at 110.20. Bot reset.") &&
    st.events.some((e) => e.text === "[ICC GPS MODEL] CYCLE COMPLETE — TP target hit at 110.20. Bot reset."));
  check("1: the finished cycle is recorded as COMPLETE, with the ICC entry it took",
    st.lastCycle && st.lastCycle.why === "COMPLETE" && st.lastCycle.iccEntered === true);
  check("1: and the NEXT cycle locks straight away — the NTZ is never left blank",
    st.lockHigh !== null && st.phase === "WAITING" && st.status === "WAITING FOR INDICATION", st.status);
  check("1: the last ICC entry is remembered for the panel", st.lastIccEntry && st.lastIccEntry.price === 109.5);
}

// ---------------------------------------------------------------- 2: the client's bugs
{
  // Alignment ON vs OFF, and GPS model on or off, must give the SAME NTZ and phase path.
  const s = more(series(BASE, START), [110, 110.1]);
  const a = cycle(modelSandbox({ iccModelAlign: false }), { d1: [], h4: s.h4, h1: s.h1 });
  const b = cycle(modelSandbox({ iccModelAlign: true, gpsModelOn: true, gpsModelAlign: true }), { d1: [], h4: s.h4, h1: s.h1 });
  check("2: alignment ON/OFF and either model: identical locks, phases and resets", shared(a) === shared(b),
    shared(a) + "  vs  " + shared(b));
  check("2: same NTZ and phase right now", a.lockHigh === b.lockHigh && a.phase === b.phase && a.dir === b.dir);
  check("2: alignment only changed the ENTRY — blocked with Daily not bullish",
    types(b, "icc").includes("NOTALIGNED") && !types(b, "icc").includes("ENTRY") && types(a, "icc").includes("ENTRY"));
}
{
  // The stuck GPS model: alignment ON, continuation reached, Daily never agrees, price never
  // pulls back. It must not hold the old levels forever — Max wait ends the cycle.
  const g = WIDE.concat([[109.6, 109.7, 109.8, 109.9], [109.9, 109.95, 110, 110.05], [110.06, 110.07, 110.08, 110.09]]);
  const sb = modelSandbox({ iccModelOn: false, gpsModelOn: true, gpsModelAlign: true, iccMaxWait: 3 });
  const s = series(g, START - 3 * H4);
  const st = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  check("2: a continuation that never reaches its target or entry times out and resets",
    types(st).includes("TIMEOUT") && st.events.some((e) => /TIMEOUT — Target not reached after 3 4H candles/.test(e.text)) &&
    st.lastCycle.why === "TIMEOUT" && st.lastCycle.gpsActive === false);
}

// ---------------------------------------------------------------- 3: startup + live
{
  const sb = modelSandbox();
  const s = series(BASE, START);
  liveFeed(sb, s);
  console.log("\n===== 3: START-UP READ, THEN LIVE CONTINUATION =====");
  sb.__logLines.filter((l) => /ICC|ORDER/.test(l)).forEach((l) => console.log(l));
  check("3: on start the phase is where the cycle already is (CORRECTION), not WAITING",
    sb.__logLines.some((l) => /\[ICC\] Session start — Locked NTZ High: 104\.00 \| Locked NTZ Low: 101\.00 \| Current Phase: CORRECTION \(BULLISH\)/.test(l)));
  const o = sb.__orders[0];
  check("3: the live continuation close places ONE market order", sb.__orders.length === 1 && o.tradingAction === "BUY");
  check("3: tagged GPSBOT-ICC", o && o.comment === "GPSBOT-ICC");
  check("3: default stop = fixed pips (100)", o && o.sl && o.sl.pips === 100, o && JSON.stringify(o.sl));
  check("3: default TP = the structure target (110.2 - 109.5 = 7 pips)", o && o.tp && o.tp.pips === 7, o && JSON.stringify(o.tp));
  check("3: the CSV row is labelled ICC ENTRY MODEL", sb.signalLog.length === 1 && sb.signalLog[0].model === "ICC ENTRY MODEL");
  sb.updateEntryModels();
  check("3: a re-read does not trade the same candle twice", sb.__orders.length === 1);
}
{
  const s = series(BASE, START);
  const h1 = modelSandbox({ iccModelSlMode: "h1" }); liveFeed(h1, s);
  check("3: SL = latest 1H swing: below the 107.5 swing's wick (106.5 = 30 pips)",
    h1.__orders[0] && h1.__orders[0].sl.pips === 30, h1.__orders[0] && JSON.stringify(h1.__orders[0].sl));
  const st = modelSandbox({ iccModelSlMode: "struct" }); liveFeed(st, s);
  check("3: SL = latest structure swing: below the 4H swing low's wick",
    st.__orders[0] && st.__orders[0].sl.pips > 30, st.__orders[0] && JSON.stringify(st.__orders[0].sl));
  const tp1 = modelSandbox({ iccModelTpStruct: false }); liveFeed(tp1, s);
  check("3: TP structure OFF = Take profit 1 pips (100)", tp1.__orders[0] && tp1.__orders[0].tp.pips === 100);
  const dry = modelSandbox({ tradingMode: "dry" }); liveFeed(dry, s);
  check("3: Dry Run logs the entry but sends nothing", dry.__orders.length === 0 && dry.__logLines.some((l) => /ENTRY PLACED/.test(l)));
  const nob = modelSandbox({ enableBuys: false }); liveFeed(nob, s);
  check("3: the BUY master switch off blocks the ICC model's buy", nob.__orders.length === 0);
  const flt = modelSandbox({ emaFilterOn: true, iccOn: true }); flt.icc.bias = "NTZ"; liveFeed(flt, s);
  check("3: the 50 EMA / ICC filters do not block the ICC Entry Model", flt.__orders.length === 1);
}

// ---------------------------------------------------------------- 4: trail after TP
{
  const sb = modelSandbox({ iccModelTrail: true, autoTrailingOn: true, trailAfterProfitDollars: 1, profitLockDistanceDollars: 0.5 });
  const s = series(BASE, START);
  liveFeed(sb, s);
  const o = sb.__orders[0];
  check("4: trail ON: the order goes out with NO TP", o && !o.tp, o && JSON.stringify(o));
  // The fill: managed, held for the target, not trailed yet even though it is in profit.
  const order = { orderId: "T1", instrumentId: "XAU/USD", orderType: "BUY", openPrice: 109.5, closePrice: 110.0,
                  profit: 50, sl: 99.5, tp: null, comment: "GPSBOT-ICC" };
  sb.Framework.Orders = { forEach: (fn) => [order].forEach(fn), get: (id) => (id === "T1" ? order : null) };
  sb.Framework.OnOrderOpen(order);
  check("4: the fill is marked as held for the target", sb.managedOrders.T1 && sb.managedOrders.T1.holdForTarget === true);
  const before = sb.__orders.length;
  sb.manageOpenTrades();
  check("4: before the target, the trail does not touch it", sb.__orders.length === before);
  sb.armTrailsAtTarget(110.2);
  check("4: at the target the trail takes over", sb.managedOrders.T1.targetHit === true && sb.__orders.length > before &&
    sb.__logLines.some((l) => /TP target 110\.20 reached — trail active on T1/.test(l)));
}

// ---------------------------------------------------------------- 5: resets
{
  // Disrespect: a 4H close below 101 after the bullish break. The same close is the break the
  // other way, so it re-locks and indicates BEARISH straight away.
  const g = BASE.slice(0, 7).concat([[105, 103, 101, 100.5]]);
  const s = series(g, START);
  const st = cycle(modelSandbox(), { d1: [], h4: s.h4, h1: s.h1 });
  check("5: a 4H body close back through the NTZ is DISRESPECT",
    st.events.some((e) => /LEVEL DISRESPECTED — 4H body closed below 101\.00/.test(e.text)));
  check("5: and that same close is the bearish INDICATION of the next cycle",
    st.dir === "sell" && st.phase === "INDICATION", st.dir + " " + st.phase);
}
{
  const g = BASE.slice(0, 7).concat([[110, 111, 112, 113], [114, 115, 116, 117], [118, 119, 120, 121]]);
  const s = series(g, START - 3 * H4);
  const st = cycle(modelSandbox({ iccMaxWait: 2 }), { d1: [], h4: s.h4, h1: s.h1 });
  check("5: no correction within Max wait is a TIMEOUT",
    st.events.some((e) => /TIMEOUT — No correction detected after 2 4H candles/.test(e.text)) && st.lastCycle.why === "TIMEOUT");
}
{
  const s = series(BASE.slice(0, 7), START);
  const risingH1 = [];
  for (let k = 0; k < 8; k++) {
    const c = 110 + k;
    risingH1.push({ ts: s.h1[s.h1.length - 1].ts + (k + 1) * H1, o: c - 1, h: c + 1, l: c - 2, c, v: 1 });
  }
  const h4 = s.h4.concat([
    { ts: s.h4[6].ts + H4, o: 109, h: 114, l: 108, c: 113, v: 1 },
    { ts: s.h4[6].ts + 2 * H4, o: 113, h: 113, l: 110, c: 111, v: 1 }
  ]);
  const st = cycle(modelSandbox(), { d1: [], h4, h1: s.h1.concat(risingH1) });
  check("5: a new 4H swing beyond the locked high does NOT end the cycle (client rule: only opposite close or max bars)",
    !types(st).includes("INVALIDATED") && st.dir === "buy" && st.lockHigh === 104 && st.lockLow === 101,
    st.dir + " " + st.lockHigh + "/" + st.lockLow);
  check("5: it is logged as ignored, levels stay locked",
    st.events.some((e) => /New swing detected at 113\.00 — IGNORED\. Active cycle in progress\. Levels remain locked/.test(e.text)));
}
{
  // The client's Gold case: bullish break, in CORRECTION, and a new 4H swing high forms above
  // the locked high during the correction move. The cycle must stay in CORRECTION.
  const g = BASE.slice(0, 8).concat([[111, 112, 113, 114], [113.5, 112.5, 112, 111.5]]);
  const s = series(g, START);
  const st = cycle(modelSandbox(), { d1: [], h4: s.h4, h1: s.h1 });
  check("5: a new swing high during CORRECTION leaves the cycle alive in CORRECTION",
    !types(st).includes("INVALIDATED") && st.phase !== "WAITING" && st.dir === "buy" && st.lockHigh === 104,
    st.phase + " " + st.dir);
  check("5: the only cycle-ending events left are disrespect, timeout and completion",
    st.events.filter((e) => ["INVALIDATED"].includes(e.type)).length === 0);
}
{
  // After completion the next NTZ comes from swings that formed after the reset — the old
  // pair is never re-used.
  const g = BASE.concat([[110.5, 112, 111, 110], [109, 108, 107.8, 108.5], [109, 109.5, 109.2, 109.4], [109, 108.8, 108.9, 109]]);
  const s = series(g, START - 4 * H4);
  const st = cycle(modelSandbox(), { d1: [], h4: s.h4, h1: s.h1 });
  const locks = st.events.filter((e) => e.type === "LOCK");
  check("5: after COMPLETE, the next lock uses fresh swings", locks.length === 2 && !/104\.00/.test(locks[1].text),
    locks.map((e) => e.text).join(" || "));
}

// ---------------------------------------------------------------- 6: alignment entries
const dailyBull = [
  { ts: START - 4 * D1, o: 99, h: 101, l: 98, c: 100, v: 1 }, { ts: START - 3 * D1, o: 100, h: 105, l: 99, c: 104, v: 1 },
  { ts: START - 2 * D1, o: 104, h: 104, l: 101, c: 102, v: 1 }, { ts: START - D1, o: 102, h: 111, l: 101, c: 110, v: 1 }
];
{
  // Aligned at the 109.5 continuation -> pullback to the 1H higher low 107.5 ->
  // 110 (no touch), 108 (low 107 touches, bearish), 108.8 (bullish close) = ICC entry.
  const sb = modelSandbox({ iccModelAlign: true, gpsModelOn: true, gpsModelAlign: true });
  const s = more(series(WIDE, START), [110, 108, 108.8]);
  const st = cycle(sb, { d1: dailyBull, h4: s.h4, h1: s.h1 });
  console.log("\n===== 6: ALIGNMENT + PULLBACK =====");
  st.events.filter((e) => !/IGNORED/.test(e.type)).forEach((e) => console.log(e.text));
  check("6: alignment confirmed on the continuation close", st.events.some((e) => e.type === "ALIGNED" && e.kind === "icc"));
  const entry = st.events.find((e) => e.type === "ENTRY");
  check("6: the ICC entry waits for the pullback, then the first bullish 1H close", !!entry && entry.entry === 108.8,
    entry && entry.entry);
  const act = st.events.find((e) => e.type === "ACTIVE" && e.kind === "gps");
  check("6: the GPS engines switch on at the pullback touch", !!act && act.ts < entry.ts);
}
{
  const sb = modelSandbox({ iccModelAlign: true });
  const s = more(series(WIDE, START), [110, 107]);
  const st = cycle(sb, { d1: dailyBull, h4: s.h4, h1: s.h1 });
  check("6: a 1H close below the higher low cancels that pullback, the phase stays CONTINUATION",
    types(st, "icc").includes("PULLBROKEN") && st.phase === "CONTINUATION" && !types(st, "icc").includes("ENTRY"));
}

// ---------------------------------------------------------------- 7: GPS engines through the gate
const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });
function fvgSequence() {
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else bars.push({ ts, o: 2002, h: 2003, l: 2001, c: 2002.5, v: 100 });
  }
  const t0 = asiaOpen + 48 * M5;
  bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 });
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 });
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 });
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 });
  bars.push({ ts: t0 + 4 * M5, o: 2004, h: 2005.0, l: 2003.0, c: 2003.2, v: 100 });
  bars.push({ ts: t0 + 5 * M5, o: 2003, h: 2004.2, l: 2002.9, c: 2004.0, v: 100 });
  bars.push(flat(t0 + 6 * M5, 2004));
  return bars;
}
const gpsCfg = (over) => defaultCfg(Object.assign({ gpsModelOn: true, iccModelOn: false, gpsModelTpStruct: true,
                                                    gpsModelSlMode: "pips", gpsModelTrail: false }, over || {}));
const activeCycle = (dir, target) => ({ phase: "CONTINUATION", dir, target, m: { gps: { active: true }, icc: {} },
                                        latest: { h1Hi: 2010, h1Lo: 1995, sHi: 2030, sLo: 1980 } });
{
  const sb = buildSandbox();
  run(sb, fvgSequence(), gpsCfg());
  check("7: no cycle / engines WAITING: the GPS buy is logged but not ordered",
    sb.signalLog.length === 1 && sb.__orders.length === 0 &&
    sb.__logLines.some((l) => /\[ENGINE 1\] BUY signal fired — NO ORDER SENT — GPS Entry Model: engines WAITING/.test(l)));
}
{
  const sb = buildSandbox();
  sb.iccCycle = activeCycle("buy", 2050);
  run(sb, fvgSequence(), gpsCfg());
  const o = sb.__orders[0], entry = sb.signalLog[0].entry;
  check("7: engines ACTIVE for buys: the GPS buy is ordered", sb.__orders.length === 1);
  check("7: TP = the shared structure target", o && Math.abs(o.tp.pips - (2050 - entry) / 0.1) < 0.11, o && JSON.stringify(o.tp));
  check("7: SL = the fixed pip stop by default", o && o.sl.pips === 100);
  check("7: logged as GPS MODEL ACTIVE — ORDER SENT", sb.__logLines.some((l) => /GPS MODEL ACTIVE — ORDER SENT/.test(l)));
  check("7: CSV row labelled GPS ENTRY MODEL", sb.signalLog[0].model === "GPS ENTRY MODEL");
}
{
  const sb = buildSandbox();
  sb.iccCycle = activeCycle("buy", 2050);
  run(sb, fvgSequence(), gpsCfg({ gpsModelSlMode: "h1" }));
  const o = sb.__orders[0], entry = sb.signalLog[0].entry;
  check("7: SL option 1H swing uses the shared latest 1H swing low", o && Math.abs(o.sl.pips - (entry - 1995) / 0.1) < 0.11,
    o && JSON.stringify(o.sl));
}
{
  const sb = buildSandbox();
  sb.iccCycle = activeCycle("sell", 1900);
  run(sb, fvgSequence(), gpsCfg());
  check("7: engines ACTIVE for sells: a buy is not ordered", sb.__orders.length === 0);
}
{
  const sb = buildSandbox();
  run(sb, fvgSequence(), gpsCfg({ gpsModelOn: false }));
  check("7: GPS model OFF: the engines trade as normal", sb.__orders.length === 1);
}

// ---------------------------------------------------------------- 8: Daily structure
{
  const sb = modelSandbox({ iccStructTf: "daily" });
  const s = series(BASE, START);
  const d1 = s.h4.map((b, i) => Object.assign({}, b, { ts: START - (BASE.length - i) * D1 }));
  const st = cycle(sb, { d1, h4: [], h1: [] });
  check("8: Daily structure locks the Daily swing high / low", st.events.some((e) => e.type === "LOCK" && /NTZ set \(Daily\)/.test(e.text)));
  check("8: and indicates on a Daily close", st.events.some((e) => /Daily closed above NTZ 104\.00/.test(e.text)));
}

// ---------------------------------------------------------------- 8a: 1H structure timeframe
// The whole cycle on 1H candles: swing high 104 / swing low 101 lock, a 1H close at 106 is the
// indication, the 1H swing high 110 starts the correction, a close at 110.5 above the lower
// high 109 is the continuation.
const H1CYCLE = [100, 104, 101, 102, 103, 102.5, 106, 108, 110, 108.5, 107.5, 109, 108, 110.5];
function h1Bars(closes, start) {
  let prev = closes[0];
  return closes.map((c, i) => { const o = prev; prev = c; return { ts: start + i * H1, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 }; });
}
{
  const sb = modelSandbox({ iccStructTf: "1h", gpsModelOn: true });
  const h1 = h1Bars(H1CYCLE, END - H1CYCLE.length * H1);
  const st = cycle(sb, { d1: [], h4: [], h1 });
  console.log("\n===== 8a: 1H STRUCTURE =====");
  st.events.filter((e) => !/IGNORED/.test(e.type)).forEach((e) => console.log(e.text));
  check("8a: 1H structure locks the 1H swing high / low", st.events.some((e) => e.type === "LOCK" &&
    /Swing high locked: 104\.00 \| Swing low locked: 101\.00 — NTZ set \(1H\)/.test(e.text)));
  check("8a: and indicates on a 1H close", st.events.some((e) => /INDICATION — 1H closed above NTZ 104\.00/.test(e.text)));
  check("8a: correction and continuation run the same way", types(st).includes("CORRECTION") && types(st).includes("CONTINUATION"));
  const entry = st.events.find((e) => e.type === "ENTRY");
  check("8a: the ICC Entry Model enters on the 1H continuation close", !!entry && entry.entry === 110.5, entry && entry.entry);
  check("8a: the GPS Entry Model's engines switch on at the same close",
    st.events.some((e) => e.type === "ACTIVE" && e.kind === "gps" && e.ts === entry.ts));
  check("8a: the setting is kept as '1h' (not folded back to 4H)", sb.cycleParams().structTf === "1h");
  check("8a: panels name the timeframe 1H", sb.cycleTfName() === "1H");
}
{
  // Max wait counts 1H bars on 1H structure.
  const sb = modelSandbox({ iccStructTf: "1h", iccMaxWait: 2 });
  const h1 = h1Bars([100, 104, 101, 102, 103, 102.5, 106, 107, 108, 109, 110], END - 11 * H1);
  const st = cycle(sb, { d1: [], h4: [], h1 });
  check("8a: Max wait counts 1H bars", st.events.some((e) => /TIMEOUT — No correction detected after 2 1H candles/.test(e.text)));
}

// ---------------------------------------------------------------- 8b: entry type 2
// After the break at 109 (NTZ 104 / 101): 1H closes 107, 105, 103.5 (back INSIDE the NTZ),
// 103, then 104.5 (back OUT above 104), 106, 107, 108.
const TYPE2 = BASE.slice(0, 7).concat([[107, 105, 103.5, 103], [104.5, 106, 107, 108]]);
{
  const sb = modelSandbox({ iccRequireH1: false, gpsModelOn: true });
  const s = series(TYPE2, START);
  const st = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  console.log("\n===== 8b: ENTRY TYPE 2 — NTZ RE-ENTRY =====");
  st.events.filter((e) => !/IGNORED/.test(e.type)).forEach((e) => console.log(e.text));
  check("8b: type 2: CORRECTION is the 1H close back inside the NTZ",
    st.events.some((e) => e.type === "CORRECTION" && /1H closed back inside the NTZ \(below 104\.00\)/.test(e.text)));
  const entry = st.events.find((e) => e.type === "ENTRY");
  check("8b: type 2: the entry is the 1H body close back out above 104", !!entry && entry.entry === 104.5,
    entry && entry.entry);
  check("8b: type 2: logged as closing back out of the NTZ",
    st.events.some((e) => e.type === "CONTINUATION" && /closed back out of the NTZ, above 104\.00\. TP target 109\.00/.test(e.text)));
  check("8b: type 2: the GPS engines switch on at the same close",
    st.events.some((e) => e.type === "ACTIVE" && e.ts === entry.ts));
}
{
  // The same candles with the check ON (type 1): the 1H swing high 109 is the corrective
  // structure and 108 never closes above it — no entry. Type 2 entered; type 1 does not.
  const sb = modelSandbox({ iccRequireH1: true });
  const s = series(TYPE2, START);
  const st = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  check("8b: type 1 on the same candles waits for the 1H flip (no entry yet)",
    st.phase === "CORRECTION" && !types(st).includes("ENTRY"), st.phase);
}
{
  // Type 1 does not need the NTZ re-entry: the base cycle never goes back below 104 and
  // still enters.
  const sb = modelSandbox({ iccRequireH1: true });
  const s = series(BASE, START);
  const st = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  check("8b: type 1 enters on a shallow pullback that never re-enters the NTZ", types(st).includes("ENTRY"));
  const st2 = cycle(modelSandbox({ iccRequireH1: false }), { d1: [], h4: s.h4, h1: s.h1 });
  check("8b: type 2 does not enter on that shallow pullback", !types(st2).includes("ENTRY"));
}

// ---------------------------------------------------------------- 8c: never blank, never stuck
{
  // The client's overnight case: the swing high is known, the swing low confirms later.
  const sb = modelSandbox();
  const part = series(BASE.slice(0, 3), START);
  const st1 = cycle(sb, { d1: [], h4: part.h4, h1: part.h1 });
  check("8c: with only the swing high confirmed, it is shown and the low is pending",
    st1.lockHigh === null && st1.pendHi === 104 && st1.pendLo === null && st1.status === "SCANNING");
  const full = series(BASE.slice(0, 4), START);
  const st2 = cycle(sb, { d1: [], h4: full.h4, h1: full.h1 });
  check("8c: the moment the swing low confirms, it pairs with the high and the NTZ locks",
    st2.lockHigh === 104 && st2.lockLow === 101 && st2.status === "WAITING FOR INDICATION", st2.status);
}
// After a timeout the most recent swings are the pair that just timed out. It is re-locked
// at once (not blank), but the same break cannot start a new cycle until price has been back
// inside.
const RERUN = [[99, 100, 100, 100], [102, 104, 104, 104], [103, 102, 101, 101], [104.5, 106, 108, 109],
               [110, 111, 112, 113], [114, 115, 116, 117], [118, 119, 120, 121], [122, 123, 124, 125]];
{
  const sb = modelSandbox({ iccMaxWait: 2 });
  const s = series(RERUN, START - 6 * H4);
  const st = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  console.log("\n===== 8c: RE-LOCK AFTER A TIMEOUT =====");
  st.events.filter((e) => !/IGNORED/.test(e.type)).forEach((e) => console.log(e.text));
  check("8c: after the timeout the NTZ is re-locked immediately (never blank)",
    st.lastCycle.why === "TIMEOUT" && st.lockHigh === 104 && st.lockLow === 101);
  check("8c: it is marked as waiting for price back inside",
    st.needsFreshBreak === true && st.status === "WAITING FOR INDICATION");
  check("8c: a close still above the re-used high does NOT start a new cycle", st.phase === "WAITING" && !st.dir);
}
{
  const sb = modelSandbox({ iccMaxWait: 2 });
  const s = series(RERUN.concat([[120, 110, 105, 103]]), START - 7 * H4);
  const st = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  check("8c: once a newer swing confirms it replaces the re-used pair",
    st.lockHigh === 125 && st.needsFreshBreak === false, st.lockHigh + " " + st.needsFreshBreak);
}
{
  // The panel: current status and last cycle are separate, so they never contradict.
  const sb = modelSandbox({ gpsModelOn: true });
  sb.iccCycle = cycle(sb, { d1: [], ...(() => { const s = more(series(BASE, START), [110.5]); return { h4: s.h4, h1: s.h1 }; })() });
  sb.engines = [];
  sb.renderModelPanels();
  const txt = (id) => sb.document.getElementById(id).textContent;
  check("8c: panel — cycle status is the CURRENT cycle", txt("mIccStatus") === "WAITING FOR INDICATION", txt("mIccStatus"));
  check("8c: panel — Last cycle status is COMPLETE (an entry was taken), in silver",
    txt("mIccLastCycle") === "COMPLETE" && /ph-done/.test(sb.document.getElementById("mIccLastCycle").className), txt("mIccLastCycle"));
  check("8c: panel — Last cycle date is its own field", /EST$/.test(txt("mIccLastDate")), txt("mIccLastDate"));
  check("8c: panel — the phase is colour-coded with the 3-dot tracker",
    txt("mIccPhase") === "WAITING  ●○○" && /ph-wait/.test(sb.document.getElementById("mIccPhase").className), txt("mIccPhase"));
  check("8c: panel — cycle expiry is blank until a break", /starts at a break/.test(txt("mIccExpires")));
  check("8c: panel — the NTZ is not blank", !/pending|scanning/.test(txt("mIccNtz")), txt("mIccNtz"));
}

// ---------------------------------------------------------------- 8e: phase colours, dots, new fields
function panelAt(groups) {
  const sb = modelSandbox({ gpsModelOn: true, iccMaxWait: 20 });
  const s = series(groups, START);
  sb.h4Store = storeOf(s.h4, H4); sb.h1Store = storeOf(s.h1, H1);
  sb.iccCycle = cycle(sb, { d1: [], h4: s.h4, h1: s.h1 });
  sb.engines = [];
  sb.renderModelPanels();
  const el = (id) => sb.document.getElementById(id);
  return { sb, txt: (id) => el(id).textContent, cls: (id) => el(id).className };
}
{
  const a = panelAt(BASE.slice(0, 7));                    // just broken: INDICATION
  check("8e: INDICATION is yellow with two dots", a.txt("mIccPhase") === "INDICATION  ●●○" && /ph-ind/.test(a.cls("mIccPhase")),
    a.txt("mIccPhase"));
  check("8e: the break direction names the candle that broke the NTZ",
    /^BULLISH · 4H closed 109\.00 above 104\.00 · .*EST$/.test(a.txt("mIccDir")), a.txt("mIccDir"));
  check("8e: cycle expires in = structure bars left before Max wait (20 - 0 = 20)",
    a.txt("mIccExpires") === "20 4H bars (indication)", a.txt("mIccExpires"));
  check("8e: price position: last 1H close 109 is ABOVE NTZ", a.txt("mIccPos") === "ABOVE NTZ", a.txt("mIccPos"));
  const b = panelAt(BASE.slice(0, 8));                    // 1H turned: CORRECTION
  check("8e: CORRECTION is blue with three dots", b.txt("mGpsPhase") === "CORRECTION  ●●●" && /ph-corr/.test(b.cls("mGpsPhase")),
    b.txt("mGpsPhase"));
  const c = panelAt(BASE.slice(0, 6));                    // locked, inside: WAITING
  check("8e: WAITING is grey with one dot, price INSIDE NTZ",
    c.txt("mIccPhase") === "WAITING  ●○○" && /ph-wait/.test(c.cls("mIccPhase")) && c.txt("mIccPos") === "INSIDE NTZ",
    c.txt("mIccPhase") + " / " + c.txt("mIccPos"));
}

// ---------------------------------------------------------------- 8d: starting with no GPS engines
function startWith(iccModel, gpsModel, before) {
  const sb = buildSandbox();
  if (before) before(sb);
  const el = (id) => sb.document.getElementById(id);
  el("instrumentId").value = "XAU/USD"; el("timeframe").value = "300"; el("tradingMode").value = "dry";
  el("enableBuys").checked = true;
  ["e1", "e2", "e3", "e4", "e5", "e6"].forEach((p) => { el(p + "Enabled").checked = false; });
  el("iccModelOn").checked = iccModel; el("gpsModelOn").checked = gpsModel;
  el("iccStructTf").value = "4h"; el("emaTimeframe").value = "4h"; el("iccSwingSource").value = "close";
  ["sessAsiaTime", "sessLondonTime", "sessNyamTime", "sessNylunchTime"]
    .forEach((id, i) => { el(id).value = ["2000-0000", "0200-0500", "0930-1200", "1200-1300"][i]; });
  sb.startBot();
  const running = sb.isRunning;
  const counts = { signals: sb.signalCount, orders: sb.orderCount, statsSince: sb.statsSince };
  if (running) sb.stopBot();                       // stop the live timers so the test can exit
  return { running, logs: sb.__logLines, counts };
}
{
  const a = startWith(true, false);
  check("8d: ICC Entry Model ON with every GPS engine off: the bot starts", a.running);
  check("8d: and says it is running the ICC Entry Model on its own",
    a.logs.some((l) => /All GPS engines are off — running the ICC Entry Model on its own\./.test(l)));
  check("8d: no misleading 'engines OFF, signals will not match' warning",
    !a.logs.some((l) => /Settings differ from the signed-off engine config/.test(l)));
  const b = startWith(false, false);
  check("8d: no model and no engines: still refuses to start", !b.running &&
    b.logs.some((l) => /there is nothing to run/.test(l)));
  const c = startWith(false, true);
  check("8d: GPS Entry Model alone with no engines: refuses (it trades through the engines)", !c.running &&
    c.logs.some((l) => /the GPS Entry Model trades through the GPS engines/.test(l)));
  const d = startWith(true, true);
  check("8d: both models, no engines: starts for the ICC model, warns the GPS model has nothing to trade",
    d.running && d.logs.some((l) => /GPS Entry Model is ON but has no engines to trade through/.test(l)));
}

// ---------------------------------------------------------------- 9: Aggressive Entry Mode
// Bullish break at 109 (NTZ 104 / 101). Arming needs a 4H BODY close back inside the NTZ.
const ARM1 = BASE.slice(0, 7).concat([[107, 105, 103.5, 103]]);              // 4H closes 103: arms
const ARM2 = ARM1.concat([[105, 104.5, 103.8, 103.6]]);                     // closes inside again: re-arms
const ARM3 = ARM2.concat([[105, 104.4, 103.9, 103.7]]);                     // and again
function aggFeed(sb, groups, extraH1) {
  const s = series(groups, START);
  if (extraH1) more(s, extraH1);
  sb.h4Store = storeOf(s.h4, H4);
  sb.h1Store = storeOf(s.h1, H1);
  sb.updateEntryModels();
  return sb;
}
const aggSb = (over) => modelSandbox(Object.assign({ iccModelAggressive: true }, over || {}));
{
  const sb = aggFeed(aggSb(), BASE.slice(0, 7), [107, 104.5, 103.5]);      // 1H closes inside, no 4H close
  sb.checkAggressiveEntry(103.5); sb.checkAggressiveEntry(104.2);
  check("9: 1H closes / ticks back inside do NOT arm — no entry", sb.__orders.length === 0 && sb.iccCycle.aggArmTs === null);
}
{
  const sb = aggFeed(aggSb(), BASE.slice(0, 7));
  aggFeed(sb, ARM1);                                                         // the 4H close inside happens live
  check("9: a 4H body close back inside the NTZ arms it",
    sb.iccCycle.aggArmTs !== null &&
    sb.__logLines.some((l) => /\[ICC ENTRY MODEL\] AGGRESSIVE ARMED — 4H body closed back inside the NTZ at 103\.00\. Entry fires the moment live price crosses back above 104\.00/.test(l)));
  sb.checkAggressiveEntry(103.5);
  sb.checkAggressiveEntry(104.2);
  console.log("\n===== 9: AGGRESSIVE ENTRY =====");
  sb.__logLines.filter((l) => /AGGRESSIVE/.test(l)).forEach((l) => console.log(l));
  const o = sb.__orders[0];
  check("9: armed + live cross back above 104 fires a BUY immediately", sb.__orders.length === 1 && o.tradingAction === "BUY");
  check("9: tagged GPSBOT-ICCA", o && o.comment === "GPSBOT-ICCA");
  check("9: TP = the 4H extreme since the break (109 - 104.2 = 48 pips)", o && o.tp && o.tp.pips === 48, o && JSON.stringify(o.tp));
  check("9: SL below the entry and tight (inside the swing range / arming candle)",
    o && o.sl && o.sl.pips > 0 && o.sl.pips < 30, o && JSON.stringify(o.sl));
  check("9: logged as ENTRY 1/2", sb.__logLines.some((l) => /AGGRESSIVE ENTRY 1\/2 — price crossed above 104\.00 live\. BUY Entry: 104\.20/.test(l)));

  sb.checkAggressiveEntry(103.5); sb.checkAggressiveEntry(104.3);
  check("9: the same arm is used once — dipping inside again on ticks does not re-arm", sb.__orders.length === 1);
  aggFeed(sb, ARM2);
  sb.checkAggressiveEntry(103.7); sb.checkAggressiveEntry(104.1);
  check("9: another 4H close inside re-arms: entry 2/2", sb.__orders.length === 2 &&
    sb.__logLines.some((l) => /AGGRESSIVE ENTRY 2\/2/.test(l)));
  aggFeed(sb, ARM3);
  sb.checkAggressiveEntry(103.8); sb.checkAggressiveEntry(104.3);
  check("9: max 2 entries per cycle", sb.__orders.length === 2 &&
    sb.__logLines.some((l) => /max 2 entries for this cycle are used/.test(l)));
  check("9: the CSV labels it ICC ENTRY MODEL (AGGRESSIVE)", sb.signalLog.every((r) => r.model === "ICC ENTRY MODEL (AGGRESSIVE)"));
}
{
  // Started with the arm already in history and price already back outside: the cross
  // happened while the bot was off, so it is not chased.
  const sb = aggFeed(aggSb(), ARM1);
  sb.checkAggressiveEntry(104.5); sb.checkAggressiveEntry(104.6);
  check("9: price already outside at start: no entry until it is seen inside first", sb.__orders.length === 0);
  sb.checkAggressiveEntry(103.9); sb.checkAggressiveEntry(104.2);
  check("9: then inside + cross fires", sb.__orders.length === 1);
}
{
  const sb = aggFeed(aggSb({ iccModelAlign: true }), ARM1);
  sb.checkAggressiveEntry(103.5); sb.checkAggressiveEntry(104.2);
  check("9: alignment has no effect in Aggressive mode (Daily not bullish, still enters)", sb.__orders.length === 1);
}
{
  const sb = aggFeed(aggSb({ iccModelTrail: true }), ARM1);
  sb.checkAggressiveEntry(103.5); sb.checkAggressiveEntry(104.2);
  check("9: trail after TP ON: aggressive entry sent with no TP", sb.__orders.length === 1 && !sb.__orders[0].tp);
}
{
  const sb = modelSandbox({ iccModelAggressive: true });
  liveFeed(sb, series(BASE, START));
  check("9: Aggressive mode: the continuation 1H close does NOT place a standard entry",
    sb.__orders.length === 0 && !sb.__logLines.some((l) => /ENTRY PLACED/.test(l)));
}
{
  const sb = aggFeed(aggSb({ iccModelAggressive: false }), ARM1);
  sb.checkAggressiveEntry(103.5); sb.checkAggressiveEntry(104.2);
  check("9: Aggressive OFF: live crosses do nothing", sb.__orders.length === 0);
}

// ---------------------------------------------------------------- 10: session performance stats
{
  // History replay: the signal is rebuilt (log / CSV) but is not a live signal.
  const sb = buildSandbox();
  const bars = fvgSequence();
  sb.cfg = defaultCfg();
  sb.priceDecimals = 2;
  sb.buildEngines();
  sb.isRunning = true;
  sb.tradingStore = {
    ta: [{ GetValue: () => 2.0 }],
    get length() { return bars.length + 1; },
    GetCandle(i) { const k = bars.length - i; return k >= 0 && k < bars.length ? bars[k] : null; }
  };
  sb.replayHistory();
  check("10: a replayed signal is still in the signal log / CSV", sb.signalLog.length === 1);
  check("10: but does NOT count as a signal fired this session", sb.signalCount === 0, "signalCount " + sb.signalCount);
  check("10: nor as an add-on / engine fire", sb.engines.every((e) => e.fires === 0));
}
{
  // The same signal live does count.
  const sb = run(buildSandbox(), fvgSequence(), defaultCfg());
  check("10: a live signal counts", sb.signalCount === 1 && sb.engines.find((e) => e.def.id === 1).fires === 1);
}
{
  // The feed announcing its first candles before the replay has run must not process
  // history as live bars.
  const sb = buildSandbox();
  const bars = fvgSequence();
  sb.cfg = defaultCfg();
  sb.priceDecimals = 2;
  sb.buildEngines();
  sb.isRunning = true;
  sb.historyReplayed = false;
  sb.tradingStore = {
    ta: [{ GetValue: () => 2.0 }],
    get length() { return bars.length + 1; },
    GetCandle(i) { const k = bars.length - i; return k >= 0 && k < bars.length ? bars[k] : null; }
  };
  sb.onNewTradingBar();
  check("10: a new-candle event before the replay processes nothing (no signal, no order)",
    sb.signalCount === 0 && sb.signalLog.length === 0 && sb.__orders.length === 0);
  sb.replayHistory();
  check("10: the replay then rebuilds history without counting it", sb.signalLog.length === 1 && sb.signalCount === 0);
}
{
  // Closed trades from before Start are kept (the circuit breaker totals the day from them)
  // but the session panel only counts those closed since Start.
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  sb.tradeLog = [{ ts: Date.now() - 3600e3, profit: -50 }, { ts: Date.now() + 1000, profit: 20 }];
  sb.statsSince = Date.now();
  sb.refreshStatsDisplay();
  const txt = (id) => sb.document.getElementById(id).textContent;
  check("10: closed trades before Start are not in this session's panel", txt("statTrades") === 1 && txt("statPL") === "20.00",
    txt("statTrades") + " / " + txt("statPL"));
  check("10: but stay in tradeLog for the circuit breaker", sb.tradeLog.length === 2);
}
{
  const t0 = Date.now();
  const a = startWith(true, false, (sb) => { sb.signalCount = 117; sb.orderCount = 3; });
  check("10: Start resets the session counters to 0",
    a.running && a.counts.signals === 0 && a.counts.orders === 0 && a.counts.statsSince >= t0, JSON.stringify(a.counts));
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
