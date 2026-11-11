// Bias lock: one direction at a time on the bot's instrument. While a trade is open (or a bot
// entry is in flight), a signal the other way is logged but not placed; the lock releases on
// its own once every trade on the instrument has closed. Always on, no setting.
const { buildSandbox, defaultCfg, run, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });

// Asia low 2000 -> sweep -> FVG -> retest -> Engine 1 BUY at 2004.00 (as in test_orders).
function series() {
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else if (i === 44) bars.push({ ts, o: 2004, h: 2008.0, l: 2003.5, c: 2007.5, v: 100 });
    else bars.push(flat(ts, 2002));
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

// The broker's open positions, as Framework.Orders exposes them.
function withOpen(sb, orders) {
  sb.Framework.Orders = {
    forEach(cb) { orders.forEach((o) => cb(o)); },
    get: (id) => orders.find((o) => o.orderId === id) || null
  };
}
function liveSandbox() {
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  sb.priceDecimals = 2;
  sb.isRunning = true;
  sb.managedOrders = {};
  sb.pendingManagement = [];
  sb.entriesDayKey = sb.nyParts(Date.now()).dayKey;
  return sb;
}
const send = (sb, dir) => sb.submitOrder(null, 2004, dir === "sell" ? 2014 : 1994, dir === "sell" ? 1994 : 2014,
  "test " + dir, { dir, comment: "GPSBOT-TEST", forceLevels: true });
const lastLog = (sb) => sb.__logLines[sb.__logLines.length - 1] || "";

// ---------------------------------------------------------------- 1: the gate on every order
{
  const sb = liveSandbox();
  withOpen(sb, [{ orderId: "1", instrumentId: "XAU/USD", orderType: "BUY", openPrice: 2000 }]);
  send(sb, "sell");
  console.log("===== 1: BIAS LOCK =====");
  console.log("  " + lastLog(sb));
  check("1: with a BUY open, a SELL is not placed", sb.__orders.length === 0);
  check("1: and the log says why",
    /NO ORDER SENT — BIAS LOCK: a BUY trade is open on XAU\/USD, so this SELL is not placed\. SELL entries resume once that trade closes\. \(test sell\)/.test(lastLog(sb)),
    lastLog(sb));
  sb.setPendingOrder(false);
  send(sb, "buy");
  check("1: a BUY in the same direction still goes through", sb.__orders.length === 1 && sb.__orders[0].tradingAction === "BUY");
}
{
  const sb = liveSandbox();
  withOpen(sb, [{ orderId: "1", instrumentId: "XAU/USD", orderType: "SELL", openPrice: 2000 }]);
  send(sb, "buy");
  check("1: mirror: with a SELL open, a BUY is not placed", sb.__orders.length === 0 && /BIAS LOCK: a SELL trade is open/.test(lastLog(sb)));
}
{
  const sb = liveSandbox();
  withOpen(sb, []);
  send(sb, "sell");
  check("1: nothing open: both directions trade", sb.__orders.length === 1 && sb.__orders[0].tradingAction === "SELL");
}
{
  const sb = liveSandbox();
  withOpen(sb, [{ orderId: "1", instrumentId: "EUR/USD", orderType: "BUY", openPrice: 1.1 }]);
  send(sb, "sell");
  check("1: a trade on another instrument does not lock this one", sb.__orders.length === 1);
}
{
  const sb = liveSandbox();
  withOpen(sb, [{ orderId: "1", instrumentId: "XAUUSD", orderType: "BUY", openPrice: 2000 }]);
  send(sb, "sell");
  check("1: a manual trade with the platform's own spelling (XAUUSD) still locks", sb.__orders.length === 0);
}
{
  const sb = liveSandbox();
  withOpen(sb, [{ orderId: "1", instrumentId: "XAU/USD", orderType: "BUY", openPrice: 2000, closeTime: 123 }]);
  send(sb, "sell");
  check("1: a closed trade does not lock", sb.__orders.length === 1);
}
{
  // The bot's own book counts even if the platform's list is slow, and so does an entry that
  // has been sent but not filled yet.
  const sb = liveSandbox();
  withOpen(sb, []);
  sb.managedOrders = { "7": { dir: "buy" } };
  send(sb, "sell");
  check("1: a managed BUY locks out SELLs", sb.__orders.length === 0);
  const sb2 = liveSandbox();
  withOpen(sb2, []);
  sb2.pendingManagement = [{ dir: "sell" }];
  send(sb2, "buy");
  check("1: a SELL still in flight locks out BUYs", sb2.__orders.length === 0);
}
{
  const sb = liveSandbox();
  withOpen(sb, [{ orderId: "1", instrumentId: "XAU/USD", orderType: "BUY" }, { orderId: "2", instrumentId: "XAU/USD", orderType: "SELL" }]);
  send(sb, "buy"); send(sb, "sell");
  check("1: if both sides are somehow open, nothing new goes either way", sb.__orders.length === 0 &&
    /BUY and SELL trades are open/.test(lastLog(sb)));
}
{
  // Dry Run says the lock first, so a Dry Run test with a manual trade open shows it.
  const sb = liveSandbox();
  sb.cfg.tradingMode = "dry";
  withOpen(sb, [{ orderId: "1", instrumentId: "XAU/USD", orderType: "BUY" }]);
  send(sb, "sell");
  check("1: in Dry Run the log still shows the bias lock", /BIAS LOCK/.test(lastLog(sb)));
}

// ---------------------------------------------------------------- 2: a real engine signal
{
  // Engine 1 fires a BUY while a SELL is open: the signal is logged, no order is sent.
  const sb = buildSandbox();
  withOpen(sb, [{ orderId: "9", instrumentId: "XAU/USD", orderType: "SELL", openPrice: 2010, sl: 2020, tp: 1990 }]);
  run(sb, series(), defaultCfg({ adoptExisting: false }));
  check("2: the engine's BUY signal still fires and is logged", sb.signalCount >= 1, sb.signalCount);
  check("2: but no BUY order is sent while the SELL is open", !sb.__orders.some((o) => o.tradingAction === "BUY"));
  check("2: the log says BIAS LOCK", sb.__logLines.some((l) => /NO ORDER SENT — BIAS LOCK: a SELL trade is open/.test(l)));
  const sb2 = run(buildSandbox(), series(), defaultCfg({ adoptExisting: false }));
  check("2: the same signal with nothing open is placed", sb2.__orders.some((o) => o.tradingAction === "BUY"));
}

// ---------------------------------------------------------------- 3: engage / release + panel
{
  const sb = liveSandbox();
  const open = [{ orderId: "1", instrumentId: "XAU/USD", orderType: "BUY" }];
  withOpen(sb, open);
  sb.biasLockState = null;
  sb.checkBiasLock(); sb.checkBiasLock();
  const panel = () => sb.document.getElementById("stBiasLock").textContent;
  check("3: engaging is logged once", sb.__logLines.filter((l) => /🔒 BIAS LOCK — BUY — SELL signals blocked until the open BUY trade closes/.test(l)).length === 1);
  check("3: the panel shows the lock", panel() === "BUY — SELL signals blocked until the open BUY trade closes", panel());
  open.length = 0;
  sb.checkBiasLock(); sb.checkBiasLock();
  check("3: releasing is logged once (TP / SL / manual close all look the same: the trade is gone)",
    sb.__logLines.filter((l) => /🔓 BIAS LOCK released — no open trades on XAU\/USD\. Scanning both directions again\./.test(l)).length === 1);
  check("3: the panel shows it free", panel() === "FREE — both directions", panel());
  send(sb, "sell");
  check("3: after the release a SELL goes through", sb.__orders.length === 1 && sb.__orders[0].tradingAction === "SELL");
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
