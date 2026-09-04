// Shared harness: loads the GPS engine out of gps_bot.html into a stubbed sandbox.
const fs = require("fs");
const vm = require("vm");

const HTML_PATH = require("path").join(__dirname, "..", "gps_bot.html");

function buildSandbox() {
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const code = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)[1];

  const elements = {};
  const el = (id) => (elements[id] = {
    id, value: "", checked: false, textContent: "", className: "", innerHTML: "",
    disabled: false, type: "", options: [], style: {},
    appendChild() {}, removeChild() {}, addEventListener() {},
    classList: { toggle: () => false, add() {}, remove() {} },
    childNodes: [], firstChild: null, scrollTop: 0, scrollHeight: 0
  });

  const logLines = [];
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
  el("log").appendChild = (node) => logLines.push(node.textContent);

  const sentOrders = [];
  const FXB = {
    OrderTypes: { BUY: "BUY", SELL: "SELL", CHANGE: "CHANGE", CLOSEPOSITION: "CLOSE" },
    PositionTypes: { LONG: "LONG", SHORT: "SHORT", EMPTY: "EMPTY" },
    ta: { ATR: function (o) { this.period = o.period; this.GetValue = () => 2.0; } },
    CandleStore: function (opts) { this.opts = opts; this.ta = opts.ta || []; this.length = 0; },
    Framework: function () {
      this.Account = { equity: 10000, currency: "USD", defaultInstrumentId: "XAU/USD" };
      this.Instruments = { get: () => ({ instrumentId: "XAU/USD", tickSize: 0.01, tickValue: 1, digits: 2, lotStep: 0.01, minLot: 0.01, maxLot: 100, pipSize: 0.1 }) };
      this.Orders = { forEach() {}, get: () => null };
      this.Translation = { TranslateError: () => "err" };
      this.RequestCandles = () => {};
      this.SaveCategorySettings = () => {};
      this.LoadCategorySettings = (id, cb) => cb(null);
      this.SendOrder = (req, cb) => { sentOrders.push(JSON.parse(JSON.stringify(req))); cb && cb({ result: { isOkay: true } }); };
    }
  };

  const sandbox = { FXB, document, console, Intl, Date, Math, JSON, Number, isNaN,
    parseInt, parseFloat, Object, Array, String, Blob: function () {}, URL: { createObjectURL: () => "" },
    setTimeout, clearTimeout, setInterval, clearInterval };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  // the engine's own Framework instance, so tests can stub Orders/Instruments
  sandbox.Framework = sandbox.Framework || null;
  sandbox.__logLines = logLines;
  sandbox.__orders = sentOrders;
  return sandbox;
}

// One engine's settings. Defaults are the signed-off Engine 1 (Priority FVG) values,
// which is what most tests want; pass overrides for the other two shapes.
function engineCfg(over) {
  return Object.assign({
    enabled: true,
    refMethod: "session", refLookback: 24, zoneMethod: "fvg",
    persist: true, requireRetest: true, requireBullish: true, openBelowTop: true,
    minBodyPct: 15, invalidate: false,
    maxZones: 10, requireResweep: true,
    useZoneMaxAge: true, maxZoneBars: 27,
    preSessionZone: true, preSessMaxBars: 15,
    volFilter: false, volLookback: 10, volMult: 1,
    sizeFilter: false, sizeLookback: 5, sizeMult: 1.5
  }, over || {});
}

// By default only engine 1 runs, so a test that is about the signal sequence is not
// reading three engines' worth of output. Tests that want the others enable them.
function defaultCfg(over) {
  const o = over || {};
  const engines = o.engines || {};
  return Object.assign({
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
    attachSl: true, attachTp: true, attachMode: "open",
    slPips: 100, tp1Pips: 100, tp2Pips: 200, tp3Pips: 300,
    trendTimeframe: 3600, trendEmaLen: 50, trendFilterOn: false,
    maxEntriesPerDay: 0, replayBars: 1500, verboseReplay: true
  }, o, {
    engines: {
      e1: engineCfg(engines.e1),
      e2: engineCfg(Object.assign({ enabled: false, refMethod: "rolling", requireResweep: false,
                                    maxZoneBars: 30, preSessMaxBars: 30, sizeLookback: 10,
                                    sizeMult: 1 }, engines.e2)),
      e3: engineCfg(Object.assign({ enabled: false, zoneMethod: "5candle", minBodyPct: 0,
                                    invalidate: true, maxZones: 5, maxZoneBars: 39,
                                    preSessionZone: false, preSessMaxBars: 30,
                                    sizeLookback: 10, sizeMult: 1 }, engines.e3))
    }
  });
}

// The live engine object for an engine id, or undefined when it is switched off.
function eng(sandbox, id) {
  return sandbox.engines.find((e) => e.def.id === (id || 1));
}

// Shorthand for "engine N's tracking state".
function st(sandbox, id) {
  const e = eng(sandbox, id);
  return e ? e.s : null;
}

// Feeds a chronological bar array through the engine one live tick at a time.
function run(sandbox, bars, cfg) {
  const store = {
    ta: [{ GetValue: () => 2.0 }],
    visible: 0,
    get length() { return this.visible; },
    GetCandle(i) { const k = this.visible - 1 - i; return k >= 0 && k < bars.length ? bars[k] : null; }
  };
  sandbox.cfg = cfg;
  sandbox.tradingStore = store;
  sandbox.buildEngines();
  sandbox.activeSession = null;
  sandbox.barIndex = 0;
  sandbox.lastProcessedTs = null;
  sandbox.isRunning = true;
  sandbox.replaying = false;
  sandbox.priceDecimals = 2;
  sandbox.entriesDayKey = sandbox.nyParts(Date.now()).dayKey;
  sandbox.sessionPLSince = Date.now();
  for (let n = 1; n <= bars.length; n++) { store.visible = n; sandbox.onNewTradingBar(); }
  return sandbox;
}

const M5 = 5 * 60 * 1000;

module.exports = { buildSandbox, defaultCfg, engineCfg, run, eng, st, M5 };
