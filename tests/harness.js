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

function defaultCfg(over) {
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
    persistSessions: true, preSessionFvg: true, maxCarryBars: 50,
    requireRetest: true, strictRetest: false, requireBullish: true, requireOpenBelow: true,
    minBodyPct: 15, invalidateFvg: false, volumeFilter: false, sizeFilter: false,
    swingLookback: 50, pivotWidth: 1, tpAtrSpacing: 0.5,
    attachSl: true, attachTp: true, attachMode: "open", slBuffer: 0,
    enableAddOns: true, maxAddOns: 3, addOnCooldown: 3, addOnLots: 0.05, addOnRiskPct: 0.5,
    maxEntriesPerDay: 0, replayBars: 1500, verboseReplay: true
  }, over || {});
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
  sandbox.sig = sandbox.newSig();
  sandbox.activeSession = null;
  sandbox.barIndex = 0;
  sandbox.lastProcessedTs = null;
  sandbox.isRunning = true;
  sandbox.replaying = false;
  sandbox.priceDecimals = 2;
  sandbox.entriesDayKey = sandbox.nyParts(Date.now()).dayKey;
  for (let n = 1; n <= bars.length; n++) { store.visible = n; sandbox.onNewTradingBar(); }
  return sandbox;
}

const M5 = 5 * 60 * 1000;

module.exports = { buildSandbox, defaultCfg, run, M5 };
