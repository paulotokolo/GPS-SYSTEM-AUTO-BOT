// Trend filter system: the 50 EMA on the 1H/4H and the ICC filter (4H No Trade Zone,
// 4H bias, 1H continuation), and how they gate GPS orders.
const { buildSandbox, defaultCfg, run, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const H4 = 4 * 3600 * 1000, H1 = 3600 * 1000;
const T0 = Date.UTC(2025, 0, 6, 0, 0, 0);

// A candle store over `bars` (oldest first). The real store is newest-first with index 0
// the still-forming bar, so a forming bar is appended that must never be read.
function storeOf(bars, formingClose) {
  const last = bars[bars.length - 1];
  const tf = bars.length > 1 ? bars[1].ts - bars[0].ts : H4;
  // The forming candle so far: from the last close to `formingClose` (live price), no wicks.
  const lc = last ? last.c : 100, fc = formingClose || lc;
  const forming = { ts: (last ? last.ts : T0) + tf, o: lc, h: Math.max(lc, fc), l: Math.min(lc, fc), c: fc, v: 1 };
  const all = bars.concat([forming]);
  return {
    get length() { return all.length; },
    GetCandle(i) { const k = all.length - 1 - i; return k >= 0 ? all[k] : null; }
  };
}
const B = (ts, o, h, l, c) => ({ ts, o, h, l, c, v: 100 });


function iccSandbox(over) {
  const sb = buildSandbox();
  sb.cfg = defaultCfg(Object.assign({
    emaFilterOn: false, emaTimeframe: "4h", trendEmaLen: 50,
    // The cycle sections use 1-bar swings on closes; section 11 covers strength 3 on wicks.
    iccOn: true, iccStructTf: "4h", iccMaxWait: 20, iccSwingStrength: 1, iccSwingSource: "close",
    iccRequireH1: true, iccPauseOpposite: true, iccAutoClose: false,
    iccModelOn: false, gpsModelOn: false
  }, over || {}));
  sb.priceDecimals = 2;
  sb.isRunning = true;
  sb.managedOrders = {};
  sb.forceCloseQueue = {};
  sb.resetTrendFilters();
  sb.resetEntryModels();
  return sb;
}
function feed(sb, h4, h1) {
  sb.h4Store = storeOf(h4);
  sb.h1Store = h1 ? storeOf(h1) : null;
  sb.updateTrendFilters();
}


// The ICC filter reads the one shared ICC cycle (the same one the entry models use). These
// sections drive that cycle with candles and check what the filter makes of it.
//
// 1H closes in groups of four; each group is one 4H candle (o = previous close, wicks 1).
function series(groups, startTs) {
  const h1 = [], h4 = [];
  let prev = groups[0][0];
  groups.forEach((g, gi) => {
    const gBars = g.map((c, k) => {
      const o = prev; prev = c;
      return B(startTs + (gi * 4 + k) * H1, o, Math.max(o, c) + 1, Math.min(o, c) - 1, c);
    });
    h1.push(...gBars);
    h4.push(B(gBars[0].ts, gBars[0].o, Math.max(...gBars.map((x) => x.h)), Math.min(...gBars.map((x) => x.l)), gBars[3].c));
  });
  return { h1, h4 };
}
function extend(s, closes) {
  let prev = s.h1[s.h1.length - 1].c;
  closes.forEach((c) => {
    const o = prev; prev = c;
    s.h1.push(B(s.h1[s.h1.length - 1].ts + H1, o, Math.max(o, c) + 1, Math.min(o, c) - 1, c));
  });
  return s;
}
// Swing high 104 then swing low 101 -> NTZ 104 / 101; 4H closes 109 -> bullish break;
// 1H swing high 111 then lower high 108.5 -> correction; 1H close 109.5 -> continuation.
const CYCLE = [
  [99, 100, 100, 100], [102, 104, 104, 104], [103, 102, 101, 101], [102, 102, 102, 102],
  [102, 102.5, 102.5, 102.5], [103, 103.5, 103.5, 103.5], [104.5, 106, 108, 109],
  [110, 111, 110.5, 110.2], [107, 108.5, 107.5, 109.5]
];
const feedS = (sb, s) => feed(sb, s.h4, s.h1);

// ---------------------------------------------------------------- 1: INDICATION
{
  const sb = iccSandbox();
  feedS(sb, series(CYCLE.slice(0, 6), T0));
  console.log("===== 1: NO TRADE ZONE (shared cycle) =====");
  console.log(JSON.stringify(sb.icc));
  check("1: the filter's NTZ is the shared cycle's locked high / low",
    sb.icc.ntz_high === 104 && sb.icc.ntz_low === 101 &&
    sb.iccCycle.lockHigh === 104 && sb.iccCycle.lockLow === 101, sb.icc.ntz_high + "/" + sb.icc.ntz_low);
  check("1: no break yet = bias NTZ", sb.icc.bias === "NTZ", sb.icc.bias);
  check("1: no break yet = phase WAITING (INDICATION only after a structure close outside)", sb.icc.phase === "WAITING", sb.icc.phase);
  check("1: buys are held inside the NTZ", /ICC bias is NTZ/.test(sb.trendGateReason(false, 102)));
  check("1: and sells too", /ICC bias is NTZ/.test(sb.trendGateReason(true, 102)));
  check("1: the master gates are both shut", !sb.icc.gps_buy_unlocked && !sb.icc.gps_sell_unlocked);
}
{
  const sb = iccSandbox();
  feedS(sb, series(CYCLE.slice(0, 2), T0));
  check("1: with no swing pair yet the bias is NEUTRAL", sb.icc.bias === "NEUTRAL", sb.icc.bias);
  check("1: and NEUTRAL holds signals", /ICC bias is NEUTRAL/.test(sb.trendGateReason(false, 110)));
}

// ---------------------------------------------------------------- 2: BULLISH BREAK
{
  const sb = iccSandbox();
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  check("2: a 4H close above the locked high sets BULLISH", sb.icc.bias === "BULLISH", sb.icc.bias);
  check("2: the broken level is the locked high", sb.icc.break_level === 104);
  check("2: before continuation the buy is held, waiting for the 1H",
    /4H confirmed bullish but 1H continuation not yet confirmed/.test(sb.trendGateReason(false, 109)));
  check("2: sells are paused on the opposite bias", /against this sell/.test(sb.trendGateReason(true, 109)));
}
{
  // 1H continuation check OFF (entry type 2): the break alone is not enough — price has to
  // come back into the NTZ and close back out.
  const sb = iccSandbox({ iccRequireH1: false });
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  check("2: check OFF: the buy is held after the break, waiting for the NTZ re-entry",
    /has not yet corrected into the NTZ and closed back out/.test(sb.trendGateReason(false, 109)));
  // (kept below the 109 target, so the cycle is still live)
  feedS(sb, series(CYCLE.slice(0, 7).concat([[107, 105, 103.5, 103], [104.5, 105, 105.5, 106]]), T0));
  check("2: check OFF: after a 1H close back inside and back out, the buy is open",
    sb.trendGateReason(false, 106) === null && sb.icc.gps_buy_unlocked);
  check("2: and the phase reads CONTINUATION, GPS armed", sb.icc.phase === "CONTINUATION" && sb.icc.armed, sb.icc.phase);
}
{
  const sb = iccSandbox({ iccPauseOpposite: false });
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  check("2: with 'Pause on opposite bias' OFF a sell is not blocked by ICC", sb.trendGateReason(true, 109) === null);
}

{
  // The client's report: CORRECTION must never show without an INDICATION first. After the
  // break but before any correction the filter reads INDICATION, not CORRECTION.
  const sb = iccSandbox();
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  check("2: just after the break the filter phase is INDICATION (it used to say CORRECTION)",
    sb.iccCycle.phase === "INDICATION" && sb.icc.phase === "INDICATION", sb.icc.phase);
}

// ---------------------------------------------------------------- 3: CORRECTION -> CONTINUATION -> COMPLETE
{
  const sb = iccSandbox();
  feedS(sb, series(CYCLE.slice(0, 8), T0));
  check("3: the 1H turning down is the CORRECTION phase", sb.icc.correction_active && sb.icc.phase === "CORRECTION",
    sb.icc.phase);
  feedS(sb, series(CYCLE, T0));
  check("3: the cycle's continuation confirms the 1H", sb.icc.h1_confirmed === true && sb.icc.h1_state === "CONFIRMED");
  check("3: the buy gate is open", sb.trendGateReason(false, 109.5) === null && sb.icc.gps_buy_unlocked);
  check("3: the phase is CONTINUATION, GPS armed", sb.icc.phase === "CONTINUATION" && sb.icc.armed, sb.icc.phase);
  feedS(sb, extend(series(CYCLE, T0), [110.5]));
  check("3: when the cycle completes at its target the NEXT NTZ is locked at once (not blank)",
    sb.icc.bias === "NTZ" && sb.icc.ntz_high !== null && /ICC bias is NTZ/.test(sb.trendGateReason(false, 111)),
    sb.icc.bias + " " + sb.icc.ntz_high);
}

// ---------------------------------------------------------------- 4: one NTZ everywhere
{
  // The client's case: the filter used the low that STARTED the rally to the high, the
  // models the most recent swing low. Now both read the same lock.
  const sb = iccSandbox({ iccModelOn: true, gpsModelOn: true });
  const s = series(CYCLE.slice(0, 8), T0);
  feedS(sb, s);
  check("4: filter NTZ high === entry models' locked high", sb.icc.ntz_high === sb.iccCycle.lockHigh);
  check("4: filter NTZ low === entry models' locked low", sb.icc.ntz_low === sb.iccCycle.lockLow);
  check("4: filter bias matches the models' break direction",
    sb.icc.bias === (sb.iccCycle.dir === "buy" ? "BULLISH" : "BEARISH"));
  check("4: filter phase matches (CORRECTION)", sb.icc.correction_active && sb.iccCycle.phase === "CORRECTION");
}
{
  // With only the filter on, the shared cycle still runs (and logs as [ICC]).
  const sb = iccSandbox();
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  check("4: the shared cycle runs for the filter alone", !!sb.iccCycle && sb.iccCycle.dir === "buy");
}

// ---------------------------------------------------------------- 5: DISRESPECT + INVALIDATION
function flipScenario(over) {
  const sb = iccSandbox(over);
  const orders = {
    B1: { orderId: "B1", instrumentId: "XAU/USD", orderType: "BUY", openPrice: 108, closePrice: 100.5 },
    S1: { orderId: "S1", instrumentId: "XAU/USD", orderType: "SELL", openPrice: 104, closePrice: 100.5 }
  };
  sb.Framework.Orders = { forEach: (fn) => Object.values(orders).forEach(fn), get: (id) => orders[id] || null };
  sb.managedOrders = { B1: { dir: "buy", entryPrice: 108 }, S1: { dir: "sell", entryPrice: 104 } };
  // Bullish break, then a 4H close below the locked low 101.
  const g = CYCLE.slice(0, 7).concat([[105, 103, 101, 100.5]]);
  const s = series(g, T0);
  feed(sb, s.h4.slice(0, -1), s.h1.slice(0, -4));         // start-up read
  feed(sb, s.h4, s.h1);                                   // the disrespect candle closes live
  return sb;
}
{
  const sb = flipScenario();
  console.log("\n===== 5: DISRESPECT AGAINST AN OPEN BUY =====");
  sb.__logLines.filter((l) => /ICC|Closed/.test(l)).forEach((l) => console.log(l));
  check("5: the disrespect close is logged", sb.__logLines.some((l) => /LEVEL DISRESPECTED — 4H body closed below 101\.00/.test(l)));
  check("5: and that same close flips the shared cycle (and the filter) BEARISH", sb.icc.bias === "BEARISH", sb.icc.bias);
  check("5: the open BUY gets an invalidation warning",
    sb.__logLines.some((l) => /ICC INVALIDATION WARNING — 4H candle closed below 101\.00 against open buy position \(B1\)/.test(l)));
  check("5: with auto close OFF nothing is closed", !sb.__orders.some((o) => o.tradingAction === "CLOSE"));
}
{
  const sb = flipScenario({ iccAutoClose: true });
  const closes = sb.__orders.filter((o) => o.tradingAction === "CLOSE");
  check("5: with auto close ON the buy is closed", closes.length === 1 && closes[0].orderId === "B1", JSON.stringify(closes));
  check("5: the sell is left open", !closes.some((o) => o.orderId === "S1"));
  check("5: the close is labelled as an ICC close", sb.__logLines.some((l) => /Closed order B1 \(ICC invalidation\)/.test(l)));
}
{
  const sb = flipScenario({ iccAutoClose: true, tradingMode: "dry" });
  check("5: Dry Run never sends the close", !sb.__orders.some((o) => o.tradingAction === "CLOSE"));
}

// ---------------------------------------------------------------- 6: 50 EMA on 1H / 4H only
function risingBars(n, start, step, tf) {
  const out = [];
  for (let i = 0; i < n; i++) { const c = start + i * step; out.push(B(T0 + i * tf, c, c + 1, c - 1, c)); }
  return out;
}
function refEma(closes, len) {
  const k = 2 / (len + 1); let e = null;
  closes.forEach((c) => { e = e === null ? c : c * k + e * (1 - k); });
  return e;
}
{
  const sb = iccSandbox({ iccOn: false, emaFilterOn: true, emaTimeframe: "4h", trendEmaLen: 10 });
  const b4 = risingBars(40, 2000, 2, H4);
  const b1 = risingBars(40, 3000, -2, H1);
  // A 5M store with wild values: the EMA must not be taken from it.
  sb.tradingStore = storeOf(risingBars(40, 9000, 50, M5), 2100);
  feed(sb, b4, b1);
  const want4 = refEma(b4.map((b) => b.c), 10), want1 = refEma(b1.map((b) => b.c), 10);
  console.log("\n===== 6: EMA =====");
  console.log("ema_4h", sb.icc.ema_4h, "want", want4, "| ema_1h", sb.icc.ema_1h, "want", want1);
  check("6: the 4H EMA is computed from closed 4H bars", Math.abs(sb.icc.ema_4h - want4) < 1e-9);
  check("6: the 1H EMA is computed from closed 1H bars", Math.abs(sb.icc.ema_1h - want1) < 1e-9);
  check("6: 4H gate: a buy above the 4H EMA passes", sb.trendGateReason(false, want4 + 5) === null);
  check("6: 4H gate: a buy below it is held, with the value",
    /wrong side of 4H EMA .* for buy/.test(sb.trendGateReason(false, want4 - 5)));
  check("6: 4H gate: a sell below it passes", sb.trendGateReason(true, want4 - 5) === null);
  check("6: the master buy gate follows the live 5M price vs the 4H EMA",
    sb.icc.gps_buy_unlocked === (2100 > want4) && sb.icc.ema_bullish === (2100 > want4));

  sb.cfg.emaTimeframe = "1h";
  check("6: 1H gate: the same buy is judged on the 1H EMA instead",
    /1H EMA/.test(sb.trendGateReason(false, want1 - 5)) && sb.trendGateReason(false, want1 + 5) === null);

  sb.cfg.emaTimeframe = "both";
  const between = (want4 + want1) / 2;       // above the 4H EMA, below the 1H EMA
  check("6: Both: price must clear BOTH — above 4H but below 1H is held",
    /1H EMA/.test(sb.trendGateReason(false, between)));
  check("6: Both: above both passes", sb.trendGateReason(false, Math.max(want4, want1) + 1) === null);

  sb.cfg.emaFilterOn = false;
  check("6: filter OFF: EMA position is ignored", sb.trendGateReason(false, 0) === null);
  check("6: but the EMA is still calculated for the panel", sb.icc.ema_4h !== null);
}
{
  const sb = iccSandbox({ iccOn: false, emaFilterOn: true, trendEmaLen: 50 });
  feed(sb, risingBars(20, 2000, 1, H4), risingBars(20, 2000, 1, H1));
  check("6: fewer closed bars than the period: EMA not ready, buy held",
    sb.icc.ema_4h === null && /not ready yet/.test(sb.trendGateReason(false, 2500)));
}

// ---------------------------------------------------------------- 7: EMA + ICC together
{
  const sb = iccSandbox({ emaFilterOn: true, emaTimeframe: "4h", trendEmaLen: 3 });
  feedS(sb, series(CYCLE, T0));
  const ema = sb.icc.ema_4h;
  check("7: both ON, ICC armed and price above the 4H EMA: buy passes",
    sb.icc.h1_confirmed && sb.trendGateReason(false, ema + 1) === null);
  check("7: both ON, ICC armed but price below the EMA: held by the EMA",
    /EMA filter/.test(sb.trendGateReason(false, ema - 1)));
  sb.icc.h1_confirmed = false;
  check("7: both ON, EMA fine but no 1H continuation: held by ICC",
    /1H continuation not yet confirmed/.test(sb.trendGateReason(false, ema + 1)));
}

// ---------------------------------------------------------------- 8: the gate stops the ORDER
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
{
  const sb = buildSandbox();
  sb.icc.bias = "NTZ";
  run(sb, fvgSequence(), defaultCfg({ iccOn: true, iccRequireH1: true, iccPauseOpposite: true }));
  console.log("\n===== 8: ICC HOLDS THE ORDER, NOT THE SIGNAL =====");
  console.log("orders:", sb.__orders.length, "| signals:", sb.signalLog.length);
  check("8: the GPS signal is still recorded", sb.signalLog.length === 1);
  check("8: but no order is sent inside the NTZ", sb.__orders.length === 0);
  check("8: and the log says ICC is why",
    sb.__logLines.some((l) => /NO ORDER SENT — GPS signal held — ICC bias is NTZ/.test(l)));
}
{
  const sb = buildSandbox();
  sb.icc.bias = "BULLISH";
  sb.icc.h1_confirmed = true;
  run(sb, fvgSequence(), defaultCfg({ iccOn: true, iccRequireH1: true, iccPauseOpposite: true }));
  check("8: with ICC armed bullish the same buy IS sent", sb.__orders.length === 1);
}
{
  const sb = buildSandbox();
  sb.icc.bias = "NTZ";
  run(sb, fvgSequence(), defaultCfg({ iccOn: false }));
  check("8: with ICC OFF the NTZ is ignored entirely", sb.__orders.length === 1);
}

// ---------------------------------------------------------------- 9: logging discipline
{
  const sb = iccSandbox();
  sb.isRunning = false;
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  feedS(sb, series(CYCLE, T0));
  check("9: no ICC line is logged while the bot is stopped", !sb.__logLines.some((l) => /ICC/.test(l)));
}
{
  const sb = iccSandbox();
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  feedS(sb, series(CYCLE.slice(0, 7), T0));
  const n = sb.__logLines.filter((l) => /ICC/.test(l)).length;
  check("9: the first read is one start-up summary naming the filter, and a re-read adds nothing",
    n === 1 && sb.__logLines.some((l) => /\[ICC\] Session start — Locked NTZ High: 104\.00 \| Locked NTZ Low: 101\.00 \| Current Phase: INDICATION \(BULLISH\).*ICC Filter/.test(l)),
    "lines " + n);
}

// ---------------------------------------------------------------- 10: upgrade notice
function loadWith(saved) {
  const sb = buildSandbox();
  sb.Framework.LoadCategorySettings = (id, cb) => cb(saved);
  sb.Framework.OnLoad();
  return sb;
}
{
  const sb = loadWith({ instrumentId: "XAU/USD", slPips: 100, engines: { e1: { enabled: true } } });
  check("10: an existing user (old saved settings) is told the 50 EMA now defaults ON",
    sb.__logLines.some((l) => /50 EMA trend filter is new and now defaults ON/.test(l)));
}
{
  const sb = loadWith(null);
  check("10: a brand-new user is not", !sb.__logLines.some((l) => /now defaults ON/.test(l)));
}
{
  const sb = loadWith({ instrumentId: "XAU/USD", engines: { e1: { enabled: true } }, emaFilterOn: true });
  check("10: nor is a user whose saved settings already include the EMA choice",
    !sb.__logLines.some((l) => /now defaults ON/.test(l)));
}

// ---------------------------------------------------------------- 11: swing strength
// The client's ZECUSDT 4H chart, against Liquid's "Swing Prices (3)" labels:
//   highs 1184.40, 1190.23, 1367.74   lows 1098.01, 1048.55, 1110.12, 1187.26
// with a minor bounce to 1258.15 on the way down that a 1-bar pivot calls a swing high.
function zecChart() {
  const hl = [
    [1140, 1100], [1150, 1110], [1160, 1120], [1184.40, 1140], [1170, 1120],
    [1150, 1098.01], [1160, 1105], [1175, 1115], [1190.23, 1140], [1150, 1080],
    [1120, 1048.55], [1100, 1060], [1130, 1115], [1150, 1125], [1160, 1130],
    [1140, 1110.12], [1180, 1130], [1220, 1170], [1270, 1210], [1320, 1260],
    [1367.74, 1300], [1340, 1280], [1300, 1240], [1250, 1225], [1258.15, 1232],
    [1240, 1200], [1215, 1187.26], [1225, 1195], [1230, 1205], [1228, 1210], [1226, 1212]
  ];
  return hl.map(([h, l], i) => B(T0 + i * H4, (h + l) / 2, h, l, i >= 16 && i <= 20 ? h - 2 : (h + l) / 2));
}
{
  const sb = iccSandbox({ iccSwingStrength: 3, iccSwingSource: "wick", iccRequireH1: false });
  feed(sb, zecChart());
  const marked = [];
  const bars = zecChart();
  for (let i = 0; i < bars.length; i++) {
    if (sb.isSwingHigh(bars, i, 3, "wick")) marked.push("H " + bars[i].h);
    if (sb.isSwingLow(bars, i, 3, "wick")) marked.push("L " + bars[i].l);
  }
  console.log("\n===== 11: SWING STRENGTH 3 vs LIQUID'S SWING PRICES (3) =====");
  console.log("swings marked:", marked.join(", "));
  check("11: strength 3 marks exactly the indicator's swings",
    marked.join(",") === "H 1184.4,L 1098.01,H 1190.23,L 1048.55,L 1110.12,H 1367.74,L 1187.26", marked.join(","));
  check("11: the minor bounce at 1258.15 is NOT a swing high", !marked.includes("H 1258.15"));
  check("11: strength 1 would also mark the 1258.15 bounce", sb.isSwingHigh(bars, 24, 1, "wick"));
}
{
  // A flat top: two equal highs. The first of the pair is the swing, not neither.
  const flatTop = [[10, 5], [11, 6], [12, 7], [15, 9], [15, 9], [13, 8], [12, 7], [11, 6]]
    .map(([h, l], i) => B(T0 + i * H4, l, h, l, l));
  const sb = buildSandbox();
  check("11: on equal highs the first bar is the swing",
    sb.isSwingHigh(flatTop, 3, 3, "wick") && !sb.isSwingHigh(flatTop, 4, 3, "wick"));
}

// ---------------------------------------------------------------- 12: candle body rule
{
  // Bar 3 wicks far above its neighbours but CLOSES below bar 2's close: on the body rule
  // it is not a swing high, bar 2 is. On wicks it is the other way round.
  const bars = [[100, 101, 99, 100], [100, 103, 99, 102], [102, 106, 101, 105],
                [105, 115, 103, 104], [104, 105, 100, 101], [101, 102, 98, 99], [99, 100, 96, 97]]
    .map(([o, h, l, c], i) => B(T0 + i * H4, o, h, l, c));
  const sb = buildSandbox();
  check("12: body rule — a wick-only spike is NOT a swing high", !sb.isSwingHigh(bars, 3, 1, "close"));
  check("12: body rule — the highest CLOSE is the swing high", sb.isSwingHigh(bars, 2, 1, "close"));
  check("12: wick mode still marks the wick spike", sb.isSwingHigh(bars, 3, 1, "wick"));
  check("12: close is the default source", sb.isSwingHigh(bars, 2, 1) && !sb.isSwingHigh(bars, 3, 1));
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
