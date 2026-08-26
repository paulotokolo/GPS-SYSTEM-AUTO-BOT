// Harness: runs the GPS engine extracted from gps_bot.html against synthetic candles.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const html = fs.readFileSync(path.join(__dirname, "..", "gps_bot.html"), "utf8");
const code = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

// ---------- DOM stub ----------
const elements = {};
function el(id, props) {
  elements[id] = Object.assign({
    id, value: "", checked: false, textContent: "", className: "", innerHTML: "",
    disabled: false, type: "", options: [], style: {},
    appendChild() {}, removeChild() {}, addEventListener() {},
    classList: { toggle: () => false, add() {}, remove() {} },
    childNodes: [], firstChild: null, scrollTop: 0, scrollHeight: 0
  }, props || {});
  return elements[id];
}
["log","status","startBtn","stopBtn","clearLogBtn","exportCsvBtn","resetStatsBtn","minimizeBtn",
 "advancedToggle","advancedSection","stepRef","stepSweep","stepFvg","stepRetest","stepFired",
 "stRefName","stRefLevels","stFvgZone","stSl","stTps","stCarry","stAddons","stBar",
 "pillASIA","pillLONDON","pillNYAM","statSignals","statOrders","statTrades","statPL"].forEach(id => el(id));

const logLines = [];
elements.log.appendChild = (node) => logLines.push(node.textContent);

const document = {
  getElementById: (id) => elements[id] || el(id),
  createElement: () => {
    // The logger now assembles each line from text nodes + badge spans, so the
    // stub has to accumulate textContent the way a real element would.
    const n = { textContent: "", className: "", href: "", download: "", click() {} };
    n.appendChild = (c) => { n.textContent += (c && c.textContent) ? c.textContent : ""; };
    return n;
  },
  createTextNode: (t) => ({ textContent: String(t) }),
  body: { appendChild() {}, removeChild() {}, classList: { toggle: () => false } },
  querySelectorAll: () => []
};

// ---------- FXB stub ----------
const sentOrders = [];
const FXB = {
  OrderTypes: { BUY: "BUY", SELL: "SELL", CHANGE: "CHANGE", CLOSEPOSITION: "CLOSE" },
  PositionTypes: { LONG: "LONG", SHORT: "SHORT", EMPTY: "EMPTY" },
  ta: { ATR: function (o) { this.period = o.period; this.GetValue = () => 2.0; } },
  CandleStore: function (opts) { this.opts = opts; this.ta = (opts.ta || []); this.length = 0; },
  Framework: function () {
    this.Account = { equity: 10000, currency: "USD", defaultInstrumentId: "XAU/USD" };
    this.Instruments = { get: () => ({ instrumentId: "XAU/USD", tickSize: 0.01, tickValue: 1, decimals: 2, volumeStep: 0.01, minVolume: 0.01, pipSize: 0.1 }) };
    this.Orders = { forEach() {}, get: () => null };
    this.Translation = { TranslateError: () => "err" };
    this.RequestCandles = () => {};
    this.SaveCategorySettings = () => {};
    this.LoadCategorySettings = (id, cb) => cb(null);
    this.SendOrder = (req, cb) => {
      sentOrders.push(JSON.parse(JSON.stringify(req)));
      cb && cb({ result: { isOkay: true } });
    };
  }
};

const sandbox = { FXB, document, window: {}, console, Intl, Date, Math, JSON, Number, isNaN,
  parseInt, parseFloat, Object, Array, String, Blob: function(){}, URL: { createObjectURL: () => "" },
  setTimeout, clearTimeout, setInterval, clearInterval };
sandbox.window = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// ---------- Synthetic candle store ----------
// Chronological array; the stub exposes it newest-first like the real FXBlue store,
// where GetCandle(0) is the still-forming bar and GetCandle(1) the last closed one.
const bars = [];
function addBar(ts, o, h, l, c) { bars.push({ ts, o, h, l, c, v: 100 }); }

const M5 = 5 * 60 * 1000;
// 2025-01-15 is EST (UTC-5). NY 20:00 => 2025-01-16T01:00:00Z
const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);

// 60 bars BEFORE Asia (17:00-19:55 NY, no session) — gives lookback history + swing highs
for (let i = 60; i > 0; i--) {
  const ts = asiaOpen - i * M5;
  const base = 2004 + Math.sin(i / 3) * 1.5;
  addBar(ts, base, base + 0.8, base - 0.8, base + 0.1);
}

// ASIA session 20:00 -> 23:55 = 48 bars. Low must reach 2000, high 2010.
const asiaPivots = { 6: 2006.5, 18: 2008.5, 30: 2010.0 }; // local swing highs for TP targets
for (let i = 0; i < 48; i++) {
  const ts = asiaOpen + i * M5;
  let o = 2002, h = 2003, l = 2001, c = 2002.5;
  if (asiaPivots[i]) { h = asiaPivots[i]; o = h - 2; l = h - 2.5; c = h - 0.5; }
  if (i === 40) { l = 2000.0; o = 2001; h = 2001.5; c = 2000.5; } // the Asia LOW -> ref_low
  bars.push({ ts, o, h, l, c, v: 100 });
}

// --- After midnight NY: session closes, then the GPS sequence ---
const t0 = asiaOpen + 48 * M5; // 00:00 NY = session close bar
addBar(t0 + 0 * M5, 2001, 2002.0, 1999.0, 2000.0); // A: SWEEP (low < ref_low 2000)
addBar(t0 + 1 * M5, 2000, 2003.0, 1999.5, 2002.0); // B: left bar of the FVG (high 2003)
addBar(t0 + 2 * M5, 2002, 2006.0, 2001.8, 2005.5); // C: middle bar -> fvg_swing_low = 2001.8
addBar(t0 + 3 * M5, 2005, 2006.5, 2003.5, 2006.0); // D: FVG bar, low 2003.5 > B.high 2003
addBar(t0 + 4 * M5, 2004, 2005.0, 2003.0, 2003.2); // E: RETEST (low 2003.0 <= top 2003.5)
addBar(t0 + 5 * M5, 2003, 2004.2, 2002.9, 2004.0); // F: BUY (body 50% above top)
addBar(t0 + 6 * M5, 2004.0, 2005.0, 2003.8, 2004.8); // G: stays above zone (cooldown bar 1)
addBar(t0 + 7 * M5, 2004.8, 2005.2, 2004.0, 2004.5); // H: stays above zone (cooldown bar 2)
addBar(t0 + 8 * M5, 2004.0, 2005.5, 2003.2, 2005.0); // I: dips into zone + reclaims -> ADD-ON
addBar(t0 + 9 * M5, 2005.0, 2005.6, 2004.6, 2005.3); // J: filler

const store = {
  ta: [{ GetValue: () => 2.0 }],
  visible: 0,
  get length() { return this.visible; },
  GetCandle(i) {
    const idx = this.visible - 1 - i;
    return idx >= 0 && idx < bars.length ? bars[idx] : null;
  }
};

// ---------- Wire the engine up ----------
sandbox.cfg = {
  instrumentId: "XAU/USD", canonicalInstrumentId: "XAU/USD", timeframe: 300,
  tradingMode: "live", sizingMode: "fixed", fixedLots: 0.1, riskPct: 1, hardMaxLot: 2,
  confirmOrders: false,
  sessions: { "ASIA": true, "LONDON": true, "NY AM": true, "NY LUNCH": false },
  sessionWindows: {
    "ASIA":     { open: 20 * 60,     close: 24 * 60 },
    "LONDON":   { open: 2 * 60,      close: 5 * 60 },
    "NY AM":    { open: 9 * 60 + 30, close: 12 * 60 },
    "NY LUNCH": { open: 12 * 60,     close: 13 * 60 }
  },
  persistSessions: true, preSessionFvg: true, maxCarryBars: 50,
  requireRetest: true, strictRetest: false, requireBullish: true, requireOpenBelow: true, minBodyPct: 15,
  invalidateFvg: false, volumeFilter: false, sizeFilter: false,
  swingLookback: 50, pivotWidth: 1, tpAtrSpacing: 0.5,
  attachSl: true, attachTp: true, attachMode: "open", slBuffer: 0,
  enableAddOns: true, maxAddOns: 3, addOnCooldown: 3, addOnLots: 0.05, addOnRiskPct: 0.5,
  maxEntriesPerDay: 0, replayBars: 1500, verboseReplay: true
};
sandbox.tradingStore = store;
sandbox.sig = sandbox.newSig();
sandbox.activeSession = null;
sandbox.barIndex = 0;
sandbox.lastProcessedTs = null;
sandbox.isRunning = true;
sandbox.replaying = false;
sandbox.priceDecimals = 2;
sandbox.entriesDayKey = sandbox.nyParts(Date.now()).dayKey;

// Reveal bars one at a time, exactly like live OnNewCandle ticks.
for (let n = 1; n <= bars.length; n++) {
  store.visible = n;
  sandbox.onNewTradingBar();
}

// ---------- Report ----------
console.log("===== MILESTONE LOG =====");
logLines.filter(l => /SESSION|SWEEP|FVG|BUY|ADD-ON|reset|carry/i.test(l)).forEach(l => console.log(l));

console.log("\n===== FINAL SIG STATE =====");
const s = sandbox.sig;
console.log({
  ref_name: s.ref_name, ref_low: s.ref_low, ref_high: s.ref_high,
  sweep: s.sweep, swing_low: s.swing_low,
  fvg_top: s.fvg_top, fvg_bot: s.fvg_bot, fvg_swing_low: s.fvg_swing_low,
  fvg_found: s.fvg_found, fvg_tested: s.fvg_tested, fired: s.fired,
  addons: s.addons, tps: s.tps
});

console.log("\n===== ORDERS SENT =====");
console.log(JSON.stringify(sentOrders, null, 2));

// ---------- Assertions ----------
const checks = [
  ["ref locked from ASIA", s.ref_name === "ASIA"],
  ["ref_low == 2000", Math.abs(s.ref_low - 2000) < 1e-9],
  ["sweep detected", s.sweep === true],
  ["FVG found", s.fvg_found === true],
  ["fvg_top == 2003.5", Math.abs(s.fvg_top - 2003.5) < 1e-9],
  ["fvg_bot == 2003.0", Math.abs(s.fvg_bot - 2003.0) < 1e-9],
  ["SL == fvg_swing_low 2001.8 (MIDDLE candle)", Math.abs(s.fvg_swing_low - 2001.8) < 1e-9],
  ["retest registered", s.fvg_tested === true],
  ["BUY fired", s.fired === true],
  ["TPs are ascending swing highs", s.tps.length > 0 && s.tps.every((v, i, a) => i === 0 || v > a[i - 1])],
  ["order placed", sentOrders.length >= 1],
  ["order is a BUY", sentOrders.length > 0 && sentOrders[0].tradingAction === "BUY"],
  ["order SL == 2001.8", sentOrders.length > 0 && Math.abs(sentOrders[0].sl - 2001.8) < 1e-9],
  ["add-on fired", s.addons >= 1],
  // Pine marks the zone tested on the FORMATION bar (low == fvg_top there), and step 3 runs
  // in the same bar pass. Verified against the source; strictRetest=false reproduces it.
  ["retest IS marked on the FVG formation bar (matches Pine)",
    logLines.some(l => l.includes("00:15") && l.includes("FVG RETEST"))],
  ["fire is still blocked on the formation bar by above_fvg",
    !logLines.some(l => l.includes("00:15") && l.includes("BUY SIGNAL"))],
  ["initial BUY and add-on are on DIFFERENT bars",
    (() => {
      const buy = logLines.find(l => l.includes("BUY SIGNAL"));
      const add = logLines.find(l => l.includes("ADD-ON"));
      if (!buy || !add) return false;
      return buy.slice(0, 30) !== add.slice(0, 30);
    })()],
  ["add-on respects the 3-bar cooldown from the initial entry",
    logLines.some(l => l.includes("00:40") && l.includes("ADD-ON"))],
  ["exactly 2 orders sent (1 initial + 1 add-on)", sentOrders.length === 2]
];
console.log("\n===== ASSERTIONS =====");
let fails = 0;
checks.forEach(([name, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + name); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
