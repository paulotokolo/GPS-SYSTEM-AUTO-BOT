// ICC Entry Models: the GPS Entry Model and the ICC Entry Model — swing lock, the three
// phases on the structure TF + 1H, alignment and pullback, the four resets, and orders.
const { buildSandbox, defaultCfg, run, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const H1 = 3600e3, H4 = 4 * H1, D1 = 24 * H1;
// The last full hour before now: the scenario's continuation candle closes there, so a
// "live" entry is minutes old rather than hours. (Structure bars need not sit on real
// 4H boundaries for the model.)
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

// The base bullish scenario (closes):
//   G1 104 = swing high, G2 101 = swing low  -> NTZ 104 / 101 locked at G3's close
//   G3 103 / G4 102 = new swings inside      -> ignored
//   G6 closes 109 above 104                  -> INDICATION (bullish)
//   1H 111 swing high, then lower high 108.5 -> CORRECTION
//   1H closes 109.5 above 108.5              -> CONTINUATION
const BASE = [
  [99, 100, 100, 100], [102, 104, 104, 104], [103, 102, 101, 101], [102, 103, 103, 103],
  [102, 102, 102, 102], [103, 103.5, 103.5, 103.5], [104.5, 106, 108, 109],
  [110, 111, 110.5, 110.2], [107, 108.5, 107.5, 109.5]
];
const START = END - BASE.length * H4;

function storeOf(bars, tfMs) {
  const last = bars[bars.length - 1];
  const all = bars.concat([{ ts: (last ? last.ts : END) + tfMs, o: 1, h: 1e9, l: -1e9, c: 1, v: 1 }]);
  return { get length() { return all.length; }, GetCandle(i) { const k = all.length - 1 - i; return k >= 0 ? all[k] : null; } };
}

function modelSandbox(over) {
  const sb = buildSandbox();
  sb.cfg = defaultCfg(Object.assign({
    iccSwingStrength: 1, iccSwingSource: "close", iccMaxWait: 20,
    gpsModelOn: false, gpsModelStructTf: "4h", gpsModelAlign: false, gpsModelActiveWindow: 20,
    iccModelOn: true, iccModelStructTf: "4h", iccModelAlign: false,
    sizingMode: "fixed", fixedLots: 0.1
  }, over || {}));
  sb.priceDecimals = 2;
  sb.isRunning = true;
  sb.managedOrders = {};
  sb.forceCloseQueue = {};
  sb.resetEntryModels();
  return sb;
}
const params = (sb, kind) => sb.modelParams(kind);
const runModel = (sb, kind, d) => sb.runIccModel(kind, params(sb, kind), d);
const types = (st) => st.events.map((e) => e.type.split("|")[0]);

// ---------------------------------------------------------------- 1: the full cycle
{
  const sb = modelSandbox();
  const { h1, h4 } = series(BASE, START);
  const st = runModel(sb, "icc", { d1: [], h4, h1 });
  console.log("===== 1: ICC ENTRY MODEL — FULL CYCLE =====");
  st.events.forEach((e) => console.log(e.text));
  const t = types(st);
  check("1: the NTZ locks on the swing high and the swing low", t[0] === "LOCK" &&
    /Swing high locked: 104\.00 \| Swing low locked: 101\.00/.test(st.events[0].text));
  check("1: later swings inside the NTZ are IGNORED, the lock holds",
    t.filter((x) => x === "IGNORED").length >= 2 && st.events.some((e) => /New swing detected at 103\.00 — IGNORED/.test(e.text)));
  check("1: a 4H body close above the locked high is the INDICATION",
    st.events.some((e) => e.type === "INDICATION" && /4H closed above NTZ 104\.00\. Break direction: BULLISH/.test(e.text)));
  check("1: the 1H turning down is the CORRECTION (price never re-entered the NTZ)",
    st.events.some((e) => e.type === "CORRECTION" && /swing high 111\.00/.test(e.text)));
  const entry = st.events.find((e) => e.type === "ENTRY");
  check("1: a 1H close above the lower high 108.5 is the entry", !!entry && entry.entry === 109.5,
    entry ? entry.text : "no entry");
  check("1: SL is below the latest 1H swing low (its wick)", !!entry && entry.sl === 106.5, entry && entry.sl);
  check("1: TP is the 4H extreme since the break", !!entry && entry.tp === 110.2, entry && entry.tp);
  check("1: the cycle completes and resets", t[t.length - 1] === "COMPLETE" && st.status === "RESET" && st.phase === "WAITING");
  check("1: the last entry is remembered for the panel", st.lastEntry && st.lastEntry.dir === "BUY" && st.lastEntry.price === 109.5);
  check("1: after a reset it does not force a new cycle — no NTZ until fresh swings form", st.lockHigh === null);
}

// ---------------------------------------------------------------- 2: history never trades; live does
{
  const sb = modelSandbox();
  const { h1, h4 } = series(BASE, START);
  // Everything up to the bar before the continuation candle: the start-up read.
  sb.h4Store = storeOf(h4.slice(0, -1), H4);
  sb.h1Store = storeOf(h1.slice(0, -1), H1);
  sb.updateEntryModels();
  check("2: the first read logs the session-start state", sb.__logLines.some((l) =>
    /\[ICC ENTRY MODEL\] Session start — Locked NTZ High: 104\.00 \| Locked NTZ Low: 101\.00 \| Current Phase: CORRECTION/.test(l)));
  check("2: and sends nothing", sb.__orders.length === 0);
  // The continuation candle closes.
  sb.h4Store = storeOf(h4, H4);
  sb.h1Store = storeOf(h1, H1);
  sb.updateEntryModels();
  console.log("\n===== 2: LIVE CONTINUATION =====");
  sb.__logLines.filter((l) => /ICC ENTRY MODEL|ORDER/.test(l)).forEach((l) => console.log(l));
  const o = sb.__orders[0];
  check("2: the continuation close places ONE market order", sb.__orders.length === 1 && o.tradingAction === "BUY");
  check("2: tagged GPSBOT-ICC", o && o.comment === "GPSBOT-ICC");
  check("2: SL sent as the distance to the 1H swing (109.5 - 106.5 = 30 pips)", o && o.sl && o.sl.pips === 30, o && JSON.stringify(o.sl));
  check("2: TP sent as the distance to the structure target (110.2 = 7 pips)", o && o.tp && o.tp.pips === 7, o && JSON.stringify(o.tp));
  check("2: the log carries the brief's ENTRY PLACED line",
    sb.__logLines.some((l) => /\[ICC ENTRY MODEL\] CONTINUATION — 1H candle body close confirmed\. ENTRY PLACED\. BUY Entry: 109\.50 \| SL: 106\.50 \| TP: 110\.20/.test(l)));
  check("2: and CYCLE COMPLETE", sb.__logLines.some((l) => /\[ICC ENTRY MODEL\] CYCLE COMPLETE/.test(l)));
  check("2: the CSV row is labelled ICC ENTRY MODEL",
    sb.signalLog.length === 1 && sb.signalLog[0].model === "ICC ENTRY MODEL");
  sb.updateEntryModels();
  check("2: a re-read does not trade the same candle twice", sb.__orders.length === 1);
}
{
  const sb = modelSandbox({ tradingMode: "dry" });
  const { h1, h4 } = series(BASE, START);
  sb.h4Store = storeOf(h4.slice(0, -1), H4); sb.h1Store = storeOf(h1.slice(0, -1), H1); sb.updateEntryModels();
  sb.h4Store = storeOf(h4, H4); sb.h1Store = storeOf(h1, H1); sb.updateEntryModels();
  check("2: Dry Run logs the entry but sends nothing",
    sb.__orders.length === 0 && sb.__logLines.some((l) => /ENTRY PLACED/.test(l)) && sb.__logLines.some((l) => /DRY RUN/.test(l)));
}
{
  const sb = modelSandbox({ enableBuys: false });
  const { h1, h4 } = series(BASE, START);
  sb.h4Store = storeOf(h4.slice(0, -1), H4); sb.h1Store = storeOf(h1.slice(0, -1), H1); sb.updateEntryModels();
  sb.h4Store = storeOf(h4, H4); sb.h1Store = storeOf(h1, H1); sb.updateEntryModels();
  check("2: the BUY master switch off blocks the ICC model's buy", sb.__orders.length === 0 &&
    sb.__logLines.some((l) => /BUY signals are switched off/.test(l)));
}
{
  // The EMA filter does NOT block the ICC Entry Model.
  const sb = modelSandbox({ emaFilterOn: true, iccOn: true });
  sb.icc.bias = "NTZ";
  const { h1, h4 } = series(BASE, START);
  sb.h4Store = storeOf(h4.slice(0, -1), H4); sb.h1Store = storeOf(h1.slice(0, -1), H1); sb.updateEntryModels();
  sb.h4Store = storeOf(h4, H4); sb.h1Store = storeOf(h1, H1); sb.updateEntryModels();
  check("2: the 50 EMA / ICC filters do not block the ICC Entry Model", sb.__orders.length === 1);
}

// ---------------------------------------------------------------- 3: resets
{
  // Disrespect: a 4H close below the locked low 101 after the bullish break.
  const g = BASE.slice(0, 7).concat([[105, 103, 101, 100.5]]);
  const sb = modelSandbox();
  const s = series(g, START);
  const st = runModel(sb, "icc", { d1: [], h4: s.h4, h1: s.h1 });
  check("3: a 4H body close back through the NTZ is DISRESPECT",
    types(st).includes("DISRESPECT") && st.events.some((e) => /LEVEL DISRESPECTED — 4H body closed below 101\.00/.test(e.text)));
  check("3: which resets the cycle with no entry", !types(st).includes("ENTRY") && st.phase === "WAITING");
}
{
  // Timeout: after the break the 1H just keeps rising — no correction within Max wait.
  const g = BASE.slice(0, 7).concat([[110, 111, 112, 113], [114, 115, 116, 117], [118, 119, 120, 121]]);
  const sb = modelSandbox({ iccMaxWait: 2 });
  const s = series(g, START - 3 * H4);
  const st = runModel(sb, "icc", { d1: [], h4: s.h4, h1: s.h1 });
  check("3: no correction within Max wait candles is a TIMEOUT",
    types(st).includes("TIMEOUT") && st.events.some((e) => /TIMEOUT — No correction detected after 2 4H candles/.test(e.text)));
  check("3: the status reads TIMED OUT", st.status === "TIMED OUT", st.status);
}
{
  // New swing beyond the locked level while still waiting for the correction.
  const sb = modelSandbox();
  const s = series(BASE.slice(0, 7), START);
  const risingH1 = [];
  for (let k = 0; k < 8; k++) {
    const c = 110 + k;
    risingH1.push({ ts: s.h1[s.h1.length - 1].ts + (k + 1) * H1, o: c - 1, h: c + 1, l: c - 2, c, v: 1 });
  }
  const h4 = s.h4.concat([
    { ts: s.h4[6].ts + H4, o: 109, h: 114, l: 108, c: 113, v: 1 },     // swing high 113 (> locked 104)
    { ts: s.h4[6].ts + 2 * H4, o: 113, h: 113, l: 110, c: 111, v: 1 }
  ]);
  const st = runModel(sb, "icc", { d1: [], h4, h1: s.h1.concat(risingH1) });
  check("3: a new 4H swing beyond the locked high before any correction INVALIDATES the cycle",
    types(st).includes("INVALIDATED") && st.events.some((e) => /New swing formed beyond locked level at 113\.00/.test(e.text)));
}
{
  // The same new 4H swing AFTER the correction started is not an invalidation.
  const sb = modelSandbox();
  const s = series(BASE, START);
  const st = runModel(sb, "icc", { d1: [], h4: s.h4, h1: s.h1 });
  check("3: once correcting, a new 4H swing is ignored rather than invalidating", !types(st).includes("INVALIDATED"));
}

// ---------------------------------------------------------------- 4: alignment ON
// Daily bias BULLISH: swing high 104 on day 1, closed above on day 3 — well before the 1H.
const dailyBull = [
  { ts: START - 4 * D1, o: 99, h: 101, l: 98, c: 100, v: 1 }, { ts: START - 3 * D1, o: 100, h: 105, l: 99, c: 104, v: 1 },
  { ts: START - 2 * D1, o: 104, h: 104, l: 101, c: 102, v: 1 }, { ts: START - D1, o: 102, h: 111, l: 101, c: 110, v: 1 }
];
{
  const sb = modelSandbox({ iccModelAlign: true });
  const s = series(BASE, START);
  const st = runModel(sb, "icc", { d1: [], h4: s.h4, h1: s.h1 });
  check("4: alignment ON with Daily not bullish: NOT ALIGNED, entry blocked",
    types(st).includes("NOTALIGNED") && !types(st).includes("ENTRY") &&
    st.events.some((e) => /TF ALIGNMENT CHECK — Daily: NTZ \| 4H: BULLISH \| 1H: BULLISH — NOT ALIGNED\. Entry blocked/.test(e.text)));
  check("4: and it stays in CORRECTION", st.phase === "CORRECTION", st.phase);
}
function pullbackSeries(after) {
  const s = series(BASE, START);
  let prev = s.h1[s.h1.length - 1].c;
  after.forEach((c, k) => {
    const o = prev; prev = c;
    s.h1.push({ ts: s.h1[s.h1.length - 1].ts + H1, o, h: Math.max(o, c) + 1, l: Math.min(o, c) - 1, c, v: 1 });
  });
  return s;
}
{
  // Aligned at the 109.5 close -> wait for a pullback to the 1H higher low 107.5 ->
  // 110 (no touch), 108 (low 107 touches, bearish), 108.8 (bullish close) = entry.
  const sb = modelSandbox({ iccModelAlign: true });
  const s = pullbackSeries([110, 108, 108.8]);
  const st = runModel(sb, "icc", { d1: dailyBull, h4: s.h4, h1: s.h1 });
  console.log("\n===== 4: ALIGNMENT + PULLBACK =====");
  st.events.filter((e) => !/IGNORED/.test(e.type)).forEach((e) => console.log(e.text));
  check("4: Daily + 4H + 1H aligned confirms the correction complete", st.events.some((e) =>
    e.type === "ALIGNED" && /1H structure shifted BULLISH\. All TFs aligned\. CONTINUATION phase triggered/.test(e.text)));
  const entry = st.events.find((e) => e.type === "ENTRY");
  check("4: no entry on the alignment candle itself — it waits for the pullback",
    !!entry && entry.entry !== 109.5);
  check("4: entry is the first bullish 1H close after the pullback touched the higher low",
    !!entry && entry.entry === 108.8, entry && entry.entry);
  check("4: logged as the brief's alignment entry",
    !!entry && /CORRECTION COMPLETE — All TFs aligned\. 1H pullback confirmed\. ENTRY PLACED/.test(entry.text));
}
{
  // A 1H CLOSE below the higher low breaks the structure: back to correction, no entry.
  const sb = modelSandbox({ iccModelAlign: true });
  const s = pullbackSeries([110, 107]);
  const st = runModel(sb, "icc", { d1: dailyBull, h4: s.h4, h1: s.h1 });
  check("4: a 1H close below the higher low sends it back to CORRECTION",
    types(st).includes("PULLBROKEN") && st.phase === "CORRECTION" && !types(st).includes("ENTRY"));
}

// ---------------------------------------------------------------- 5: GPS Entry Model
{
  const sb = modelSandbox({ iccModelOn: false, gpsModelOn: true });
  const s = series(BASE, START);
  const st = runModel(sb, "gps", { d1: [], h4: s.h4, h1: s.h1 });
  console.log("\n===== 5: GPS ENTRY MODEL =====");
  st.events.filter((e) => !/IGNORED/.test(e.type)).forEach((e) => console.log(e.text));
  check("5: continuation switches the engines ON (no order of its own)",
    st.active && st.phase === "CONTINUATION" && !types(st).includes("ENTRY") &&
    st.events.some((e) => /\[ICC GPS MODEL\] CONTINUATION — 1H closed above 108\.50\. BUY engines ACTIVE on M5\. Target 110\.20/.test(e.text)));
  sb.modelState.gps = st;
  check("5: buys are allowed while active", sb.gpsModelGateReason(false) === null);
  check("5: sells are not", /ACTIVE for BUYS only/.test(sb.gpsModelGateReason(true)));

  // Target hit on the next 1H: the cycle completes and the engines switch off.
  const s2 = pullbackSeries([110.5]);
  const st2 = runModel(sb, "gps", { d1: [], h4: s2.h4, h1: s2.h1 });
  check("5: reaching the structure target completes the cycle and turns the engines OFF",
    !st2.active && st2.events.some((e) => /CYCLE COMPLETE — target 110\.20 reached\. Engines OFF/.test(e.text)));
}
{
  const sb = modelSandbox({ iccModelOn: false, gpsModelOn: true });
  const s = series(BASE.slice(0, 7), START);
  const st = runModel(sb, "gps", { d1: [], h4: s.h4, h1: s.h1 });
  sb.modelState.gps = st;
  check("5: before continuation the engines are WAITING",
    /engines WAITING \(ICC phase INDICATION\)/.test(sb.gpsModelGateReason(false)));
}

// GPS engines firing through the model gate, on the harness FVG buy (entry ~2004).
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
const gpsCfg = (over) => defaultCfg(Object.assign({ gpsModelOn: true, iccModelOn: false }, over || {}));
{
  const sb = buildSandbox();
  sb.modelState.gps = null;
  run(sb, fvgSequence(), gpsCfg());
  check("5: with the model WAITING, a GPS buy signal is logged but not ordered",
    sb.signalLog.length === 1 && sb.__orders.length === 0 &&
    sb.__logLines.some((l) => /\[ENGINE 1\] BUY signal fired — NO ORDER SENT — GPS Entry Model: engines WAITING/.test(l)));
}
{
  const sb = buildSandbox();
  sb.modelState.gps = { active: true, dir: "buy", target: 2050, phase: "CONTINUATION" };
  run(sb, fvgSequence(), gpsCfg());
  const o = sb.__orders[0];
  console.log("\n===== 5: GPS MODEL ACTIVE ORDER =====");
  console.log(JSON.stringify(o));
  check("5: with the model ACTIVE for buys, the GPS buy is ordered", sb.__orders.length === 1);
  check("5: its TP is the structure target (2050 from ~2004)", o && o.tp && Math.abs(o.tp.pips - (2050 - sb.signalLog[0].entry) / 0.1) < 0.11,
    o && JSON.stringify(o.tp));
  check("5: its SL is the normal pip stop", o && o.sl && o.sl.pips === 100);
  check("5: logged as GPS MODEL ACTIVE — ORDER SENT",
    sb.__logLines.some((l) => /\[ENGINE 1\] BUY signal fired — GPS MODEL ACTIVE — ORDER SENT · TP = structure target 2050\.00/.test(l)));
  check("5: the CSV row is labelled GPS ENTRY MODEL", sb.signalLog[0].model === "GPS ENTRY MODEL");
}
{
  const sb = buildSandbox();
  sb.modelState.gps = { active: true, dir: "sell", target: 1900, phase: "CONTINUATION" };
  run(sb, fvgSequence(), gpsCfg());
  check("5: a buy while the model is active for SELLS is not ordered", sb.__orders.length === 0);
}
{
  const sb = buildSandbox();
  sb.modelState.gps = null;
  run(sb, fvgSequence(), gpsCfg({ gpsModelOn: false }));
  check("5: with the GPS model OFF the engines trade as normal", sb.__orders.length === 1);
}

// ---------------------------------------------------------------- 6: Daily structure
{
  // The same shape on Daily candles: the NTZ, indication and target all come from Daily.
  const sb = modelSandbox({ iccModelStructTf: "daily" });
  const s = series(BASE, START);
  const d1 = s.h4.map((b, i) => Object.assign({}, b, { ts: START - (BASE.length - i) * D1 }));
  const st = runModel(sb, "icc", { d1, h4: [], h1: [] });
  check("6: Daily structure locks the Daily swing high / low",
    st.events.some((e) => e.type === "LOCK" && /NTZ set \(Daily\)/.test(e.text)));
  check("6: and indicates on a Daily close", st.events.some((e) => /Daily closed above NTZ 104\.00/.test(e.text)));
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
