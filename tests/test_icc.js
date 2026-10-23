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
  const forming = { ts: (last ? last.ts : T0) + tf, o: 1, h: 1e9, l: -1e9, c: formingClose || 999999, v: 1 };
  const all = bars.concat([forming]);
  return {
    get length() { return all.length; },
    GetCandle(i) { const k = all.length - 1 - i; return k >= 0 ? all[k] : null; }
  };
}
const B = (ts, o, h, l, c) => ({ ts, o, h, l, c, v: 100 });

// The 4H structure every scenario starts from:
//   bar 1 low 95 is a swing low, bar 3 high 120 is a swing high made from it -> NTZ 95-120.
function h4Base() {
  return [
    B(T0 + 0 * H4, 100, 105, 100, 102),
    B(T0 + 1 * H4, 102, 103,  95,  97),   // swing low 95
    B(T0 + 2 * H4,  97, 110,  98, 108),
    B(T0 + 3 * H4, 108, 120, 105, 115),   // swing high 120
    B(T0 + 4 * H4, 115, 115, 108, 110)    // closes inside the NTZ
  ];
}
const breakUp = B(T0 + 5 * H4, 110, 126, 109, 125);        // closes above 120
const breakTs = T0 + 6 * H4;                               // close time of the break bar

function iccSandbox(over) {
  const sb = buildSandbox();
  sb.cfg = defaultCfg(Object.assign({
    emaFilterOn: false, emaTimeframe: "4h", trendEmaLen: 50,
    iccOn: true, iccNtzLookback: 20, iccRequireH1: true, iccH1Swings: 3,
    iccCorrectionPct: 50, iccPauseOpposite: true, iccAutoClose: false
  }, over || {}));
  sb.priceDecimals = 2;
  sb.isRunning = true;
  sb.managedOrders = {};
  sb.forceCloseQueue = {};
  sb.resetTrendFilters();
  return sb;
}
function feed(sb, h4, h1) {
  sb.h4Store = storeOf(h4);
  sb.h1Store = h1 ? storeOf(h1) : null;
  sb.updateTrendFilters();
}

// A clean 1H uptrend after the break: swing highs 128,130,132,134 and swing lows
// 121,123,125 — all above the broken 120.
function h1Up() {
  const hs = [125, 128, 124, 130, 126, 132, 128, 134, 130];
  const ls = [122, 125, 121, 127, 123, 129, 125, 131, 127];
  return hs.map((h, i) => B(breakTs + i * H1, ls[i] + 1, h, ls[i], ls[i] + 2));
}

// ---------------------------------------------------------------- 1: INDICATION
{
  const sb = iccSandbox();
  feed(sb, h4Base());
  console.log("===== 1: NO TRADE ZONE =====");
  console.log(JSON.stringify(sb.icc));
  check("1: NTZ high is the 4H swing high", sb.icc.ntz_high === 120, sb.icc.ntz_high);
  check("1: NTZ low is the swing low that created it", sb.icc.ntz_low === 95, sb.icc.ntz_low);
  check("1: a close inside the NTZ is bias NTZ", sb.icc.bias === "NTZ", sb.icc.bias);
  check("1: the phase is INDICATION", sb.icc.phase === "INDICATION", sb.icc.phase);
  check("1: buys are held inside the NTZ", /ICC bias is NTZ/.test(sb.trendGateReason(false, 110)));
  check("1: and sells too", /ICC bias is NTZ/.test(sb.trendGateReason(true, 110)));
  check("1: the master gates are both shut", !sb.icc.gps_buy_unlocked && !sb.icc.gps_sell_unlocked);
  check("1: the forming 4H bar is never read (its huge high is not the NTZ)", sb.icc.ntz_high !== 1e9);
}
{
  const sb = iccSandbox();
  feed(sb, h4Base().slice(0, 2));
  check("1: with too little 4H history the bias is NEUTRAL", sb.icc.bias === "NEUTRAL", sb.icc.bias);
  check("1: and NEUTRAL holds signals", /ICC bias is NEUTRAL/.test(sb.trendGateReason(false, 110)));
}

// ---------------------------------------------------------------- 2: BULLISH BREAK
{
  const sb = iccSandbox();
  feed(sb, h4Base());
  feed(sb, h4Base().concat([breakUp]));
  console.log("\n===== 2: BULLISH BREAK =====");
  sb.__logLines.filter((l) => /ICC/.test(l)).forEach((l) => console.log(l));
  check("2: a 4H close above the NTZ high sets BULLISH", sb.icc.bias === "BULLISH", sb.icc.bias);
  check("2: the broken level is the NTZ high", sb.icc.break_level === 120);
  check("2: the break is logged as in the brief",
    sb.__logLines.some((l) => /ICC BULLISH BREAK — 4H candle closed above NTZ high 120\.00\. Buyers in control/.test(l)));
  check("2: without 1H continuation the buy is held, waiting for the 1H",
    /4H confirmed bullish but 1H continuation not yet confirmed/.test(sb.trendGateReason(false, 125)));
  check("2: the phase is CORRECTION", sb.icc.phase === "CORRECTION", sb.icc.phase);
  check("2: sells are paused on the opposite bias",
    /against this sell/.test(sb.trendGateReason(true, 125)));
}
{
  const sb = iccSandbox({ iccRequireH1: false });
  feed(sb, h4Base().concat([breakUp]));
  check("2: with 'Require 1H' OFF the buy unlocks on the 4H break alone",
    sb.trendGateReason(false, 125) === null && sb.icc.gps_buy_unlocked);
  check("2: and the phase reads GPS ARMED", sb.icc.phase === "GPS ARMED", sb.icc.phase);
}
{
  const sb = iccSandbox({ iccPauseOpposite: false });
  feed(sb, h4Base().concat([breakUp]));
  check("2: with 'Pause on opposite bias' OFF a sell is not blocked by ICC",
    sb.trendGateReason(true, 125) === null);
}

// ---------------------------------------------------------------- 3: 1H CONTINUATION
{
  const sb = iccSandbox();
  const h4 = h4Base().concat([breakUp]);
  feed(sb, h4, []);
  feed(sb, h4, h1Up());
  console.log("\n===== 3: 1H CONTINUATION =====");
  sb.__logLines.filter((l) => /1H/.test(l)).forEach((l) => console.log(l));
  check("3: higher highs and higher lows above the level confirm the 1H", sb.icc.h1_confirmed === true);
  check("3: the 1H structure reads CONFIRMED", sb.icc.h1_state === "CONFIRMED");
  check("3: the buy gate is open", sb.trendGateReason(false, 130) === null && sb.icc.gps_buy_unlocked);
  check("3: the phase is GPS ARMED", sb.icc.phase === "GPS ARMED", sb.icc.phase);
  check("3: it is logged", sb.__logLines.some((l) =>
    /ICC 1H CONFIRMED — higher highs and higher lows confirmed on 1H above 120\.00\. GPS engines fully armed/.test(l)));

  // A lower low breaks it: 118 is below the previous swing low and below the broken level.
  const broken = h1Up().concat([
    B(breakTs + 9 * H1, 130, 131, 118, 120),
    B(breakTs + 10 * H1, 121, 133, 124, 130)
  ]);
  feed(sb, h4, broken);
  check("3: a lower 1H swing low resets h1_confirmed", sb.icc.h1_confirmed === false);
  check("3: the 1H structure reads BROKEN", sb.icc.h1_state === "BROKEN", sb.icc.h1_state);
  check("3: the 4H bias does NOT reset", sb.icc.bias === "BULLISH");
  check("3: buys pause again", sb.trendGateReason(false, 130) !== null);
  check("3: the reset is logged", sb.__logLines.some((l) => /ICC 1H BROKEN — 1H continuation structure lost/.test(l)));
}
{
  // Swing points from BEFORE the break never count toward continuation.
  const sb = iccSandbox();
  const early = h1Up().map((b) => Object.assign({}, b, { ts: b.ts - 20 * H1 }));
  feed(sb, h4Base().concat([breakUp]), early);
  check("3: 1H swings before the 4H break do not confirm", sb.icc.h1_confirmed === false);
}
{
  // Fewer swing points than the configured lookback is not enough.
  const sb = iccSandbox({ iccH1Swings: 5 });
  feed(sb, h4Base().concat([breakUp]), h1Up());
  check("3: with a 5-swing lookback, 4 highs / 3 lows do not confirm", sb.icc.h1_confirmed === false);
}

// ---------------------------------------------------------------- 4: CORRECTION
{
  const sb = iccSandbox();
  const h4 = h4Base().concat([breakUp]);
  // From the break bar: up to 130, then back down to 116 — 14 of a 25-point NTZ = 56%.
  const pull = [
    B(T0 + 5 * H4 + 0 * H1, 110, 121, 109, 120),
    B(T0 + 5 * H4 + 1 * H1, 120, 130, 119, 128),
    B(T0 + 5 * H4 + 2 * H1, 128, 129, 120, 121)
  ];
  feed(sb, h4, pull);
  check("4: a 36% pullback is not yet a correction", sb.icc.correction_active === false);
  feed(sb, h4, pull.concat([B(T0 + 5 * H4 + 3 * H1, 121, 122, 116, 117)]));
  check("4: a 56% pullback toward the broken level is", sb.icc.correction_active === true);
  check("4: and is logged", sb.__logLines.some((l) => /ICC CORRECTION — price returned toward broken level 120\.00/.test(l)));
}

// ---------------------------------------------------------------- 5: BEARISH FLIP + INVALIDATION
function flipScenario(over) {
  const sb = iccSandbox(over);
  const orders = {
    B1: { orderId: "B1", instrumentId: "XAU/USD", orderType: "BUY", openPrice: 124, closePrice: 92 },
    S1: { orderId: "S1", instrumentId: "XAU/USD", orderType: "SELL", openPrice: 100, closePrice: 92 }
  };
  sb.Framework.Orders = { forEach: (fn) => Object.values(orders).forEach(fn), get: (id) => orders[id] || null };
  sb.managedOrders = { B1: { dir: "buy", entryPrice: 124 }, S1: { dir: "sell", entryPrice: 100 } };
  const h4 = h4Base().concat([breakUp]);
  feed(sb, h4);
  feed(sb, h4.concat([B(T0 + 6 * H4, 125, 126, 90, 92)]));    // closes below the 95 low
  return sb;
}
{
  const sb = flipScenario();
  console.log("\n===== 5: BEARISH BREAK AGAINST AN OPEN BUY =====");
  sb.__logLines.filter((l) => /ICC|Closed/.test(l)).forEach((l) => console.log(l));
  check("5: a 4H close below the NTZ low flips to BEARISH", sb.icc.bias === "BEARISH", sb.icc.bias);
  check("5: the bearish break is logged",
    sb.__logLines.some((l) => /ICC BEARISH BREAK — 4H candle closed below NTZ low 95\.00\. Sellers in control/.test(l)));
  check("5: the open BUY gets an invalidation warning",
    sb.__logLines.some((l) => /ICC INVALIDATION WARNING — 4H candle closed below 95\.00 against open buy position \(B1\)/.test(l)));
  check("5: with auto close OFF nothing is closed", !sb.__orders.some((o) => o.tradingAction === "CLOSE"));
}
{
  const sb = flipScenario({ iccAutoClose: true });
  const closes = sb.__orders.filter((o) => o.tradingAction === "CLOSE");
  check("5: with auto close ON the buy is closed", closes.length === 1 && closes[0].orderId === "B1",
    JSON.stringify(closes));
  check("5: the sell (with the new bias) is left open", !closes.some((o) => o.orderId === "S1"));
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
  feed(sb, h4Base().concat([breakUp]), h1Up());
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
  feed(sb, h4Base());
  feed(sb, h4Base().concat([breakUp]));
  check("9: no ICC transition is logged while the bot is stopped",
    !sb.__logLines.some((l) => /ICC/.test(l)));
}
{
  const sb = iccSandbox();
  feed(sb, h4Base().concat([breakUp]));
  feed(sb, h4Base().concat([breakUp]));
  const n = sb.__logLines.filter((l) => /ICC/.test(l)).length;
  check("9: the first read is logged once as a start-up summary, and a re-read adds nothing",
    n === 1 && sb.__logLines.some((l) => /ICC \(4H\) read on start: bias BULLISH/.test(l)), "lines " + n);
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

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
