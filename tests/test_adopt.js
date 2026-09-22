// Trade re-adoption: the bot picking up positions that are already open on the broker,
// which is what keeps management alive across a Liquid Charts Pro reconnect.
const { buildSandbox, defaultCfg } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

// A sandbox whose broker holds `orders`, ready for an adoption scan.
function withBroker(orders, cfgOver) {
  const sb = buildSandbox();
  sb.cfg = defaultCfg(cfgOver);
  sb.cfg.canonicalInstrumentId = "XAU/USD";
  sb.priceDecimals = 2;
  sb.isRunning = true;
  sb.managedOrders = {};
  sb.forceCloseQueue = {};

  const byId = {};
  orders.forEach((o) => { byId[o.orderId] = o; });
  sb.Framework.Orders = {
    forEach: (fn) => orders.forEach(fn),
    get: (id) => byId[id] || null
  };
  sb.Framework.SendOrder = (req, cb) => { sb.__orders.push(req); cb && cb({ result: { isOkay: true } }); };
  return sb;
}

const openBuy = (over) => Object.assign({
  orderId: "B1", instrumentId: "XAU/USD", orderType: "BUY",
  openPrice: 2000, closePrice: 2005, profit: 50,
  volume: { lots: 0.1 }, sl: 1990, tp: null, comment: "GPSBOT-E1"
}, over || {});

const openSell = (over) => Object.assign({
  orderId: "S1", instrumentId: "XAU/USD", orderType: "SELL",
  openPrice: 2000, closePrice: 1995, profit: 50,
  volume: { lots: 0.1 }, sl: 2010, tp: null, comment: "GPSBOT-E5"
}, over || {});

// ---------------------------------------------------------------- 1: the basic pick-up
{
  const sb = withBroker([openBuy()]);
  const n = sb.adoptOpenTrades("bot start");
  const m = sb.managedOrders["B1"];

  console.log("===== 1: ADOPT AN OPEN BUY =====");
  sb.__logLines.filter((l) => /RE-ADOPTED|no stop/i.test(l)).forEach((l) => console.log(l));

  check("1: one trade was adopted", n === 1);
  check("1: it is in managedOrders", !!m);
  check("1: entry price came from the broker", !!m && m.entryPrice === 2000);
  check("1: direction is buy", !!m && m.dir === "buy");
  check("1: lots came across", !!m && m.lots === 0.1);
  check("1: the existing stop came across", !!m && m.slPrice === 1990);
  check("1: it is flagged as adopted", !!m && m.adopted === true);
  check("1: breakeven starts unmarked so it is re-derived", !!m && m.breakevenApplied === false);
  check("1: the log uses the agreed RE-ADOPTED line",
    sb.__logLines.some((l) => l.includes("🔄 RE-ADOPTED") && l.includes("XAU/USD")));
  check("1: the log carries entry and current P/L",
    sb.__logLines.some((l) => /Entry\s+2000\.00/.test(l) && /Current P\/L \+50\.00/.test(l)));
  check("1: and says management resumed",
    sb.__logLines.some((l) => /Trailing and breakeven management resumed/.test(l)));
}

// ---------------------------------------------------------------- 2: sells adopt too
{
  const sb = withBroker([openSell()]);
  sb.adoptOpenTrades("bot start");
  const m = sb.managedOrders["S1"];
  check("2: a short is adopted as a short", !!m && m.dir === "sell",
    m ? "dir " + m.dir : "not adopted");
  check("2: the log says SELL", sb.__logLines.some((l) => /RE-ADOPTED/.test(l) && /Side\s+SELL/.test(l)));
}

// ---------------------------------------------------------------- 3: idempotent
{
  const sb = withBroker([openBuy()]);
  sb.adoptOpenTrades("bot start");
  sb.managedOrders["B1"].breakevenApplied = true;       // pretend management moved on
  sb.managedOrders["B1"].dollarPerPriceUnit = 10;
  const second = sb.adoptOpenTrades("periodic reconnection sweep");

  console.log("\n===== 3: RE-SCAN =====");
  console.log("second scan adopted:", second);
  check("3: a re-scan adopts nothing new", second === 0);
  check("3: and does not reset the state it already had",
    sb.managedOrders["B1"].breakevenApplied === true &&
    sb.managedOrders["B1"].dollarPerPriceUnit === 10);
  check("3: only one RE-ADOPTED line was ever written",
    sb.__logLines.filter((l) => l.includes("🔄 RE-ADOPTED")).length === 1);
}

// ---------------------------------------------------------------- 4: what is skipped
{
  const sb = withBroker([
    openBuy({ orderId: "OTHER", instrumentId: "EUR/USD" }),   // different instrument
    openBuy({ orderId: "CLOSED", closeTime: Date.now() }),    // already closed
    openBuy({ orderId: "PENDING", orderType: "BUYLIMIT" }),   // not a position
    openBuy({ orderId: "GOOD" })
  ]);
  const n = sb.adoptOpenTrades("bot start");
  console.log("\n===== 4: FILTERING =====");
  console.log("adopted:", Object.keys(sb.managedOrders).join(",") || "none");
  check("4: only the one open position on this instrument is adopted", n === 1);
  check("4: and it is the right one", !!sb.managedOrders["GOOD"]);
  check("4: a different instrument is ignored", !sb.managedOrders["OTHER"]);
  check("4: an already-closed order is ignored", !sb.managedOrders["CLOSED"]);
  check("4: a pending order type is ignored", !sb.managedOrders["PENDING"]);
}

// ---------------------------------------------------------------- 5: tagged-only mode
{
  const sb = withBroker([
    openBuy({ orderId: "MINE", comment: "GPSBOT-E1" }),
    openBuy({ orderId: "MANUAL", comment: "" })
  ], { adoptOnlyTagged: true });
  const n = sb.adoptOpenTrades("bot start");
  console.log("\n===== 5: ONLY ADOPT THIS BOT'S OWN =====");
  console.log("adopted:", Object.keys(sb.managedOrders).join(",") || "none");
  check("5: the bot's own trade is adopted", !!sb.managedOrders["MINE"]);
  check("5: a hand-placed trade is left alone", !sb.managedOrders["MANUAL"], "adopted " + n);
  check("5: and the log says why it was skipped",
    sb.__logLines.some((l) => /Skipped order MANUAL/.test(l)));
}
{
  const sb = withBroker([openBuy({ orderId: "MANUAL", comment: "" })]);
  sb.adoptOpenTrades("bot start");
  check("5: with the default OFF, a hand-placed trade IS adopted",
    !!sb.managedOrders["MANUAL"]);
  check("5: and the log is explicit that it was not the bot's",
    sb.__logLines.some((l) => /adopted on instrument match/i.test(l)));
}

// ---------------------------------------------------------------- 6: the master switch
{
  const sb = withBroker([openBuy()], { adoptExisting: false });
  const n = sb.adoptOpenTrades("bot start");
  check("6: adoption can be switched off entirely", n === 0 && !sb.managedOrders["B1"]);
}

// ---------------------------------------------------------------- 7: no stop attached
{
  const sb = withBroker([openBuy({ sl: null })]);
  sb.adoptOpenTrades("bot start");
  check("7: an adopted trade with no stop is called out loudly",
    sb.__logLines.some((l) => /NO stop-loss attached/.test(l)));
  check("7: and the bot does not invent one",
    !sb.__orders.some((o) => o.tradingAction === "CHANGE"));
}

// ---------------------------------------------------------------- 8: management resumes now
{
  // Profit $50 is past half of a $20 trail threshold, so breakeven should be applied on the
  // adoption pass itself rather than waiting for the next price tick.
  const sb = withBroker([openBuy({ sl: 1990 })], {
    autoTrailingOn: true, trailAfterProfitDollars: 20,
    profitLockDistanceDollars: 5, breakevenBufferDollars: 2
  });
  sb.adoptOpenTrades("connection restored");

  console.log("\n===== 8: MANAGEMENT RESUMES IMMEDIATELY =====");
  console.log(JSON.stringify(sb.__orders, null, 2));
  const chg = sb.__orders.find((o) => o.tradingAction === "CHANGE");
  check("8: a stop update went out on the adoption pass", !!chg);
  check("8: it moved the stop up to breakeven", !!chg && chg.sl > 1990,
    chg ? "sl " + chg.sl : "");
  check("8: the trade is marked as handled", sb.managedOrders["B1"].breakevenApplied === true);
}

// ---------------------------------------------------------------- 9: Dry Run sends nothing
{
  const sb = withBroker([openBuy()], {
    tradingMode: "dry", autoTrailingOn: true, trailAfterProfitDollars: 20,
    profitLockDistanceDollars: 5
  });
  sb.adoptOpenTrades("bot start");
  console.log("\n===== 9: DRY RUN =====");
  console.log("orders sent:", sb.__orders.length);
  check("9: the trade is still tracked in Dry Run", !!sb.managedOrders["B1"]);
  check("9: but no order of any kind is sent", sb.__orders.length === 0);
  check("9: and the log explains that nothing will be moved",
    sb.__logLines.some((l) => /Dry Run/.test(l) && /no stop will be moved/i.test(l)));
}

// ---------------------------------------------------------------- 10: force-close rebuild
{
  const sb = withBroker([openBuy()], { closeOnCircuitBreak: true });
  sb.adoptOpenTrades("bot start");
  sb.circuitBreakerTripped = true;                  // as if it had tripped before the refresh
  const queued = sb.rebuildForceCloseQueue();

  console.log("\n===== 10: FORCE-CLOSE QUEUE REBUILD =====");
  console.log(JSON.stringify(sb.__orders, null, 2));
  check("10: the adopted trade goes back on the close queue", queued === 1);
  check("10: and the close is attempted straight away",
    sb.__orders.some((o) => o.tradingAction === "CLOSE"));
  check("10: the log says the queue was rebuilt",
    sb.__logLines.some((l) => /re-queued for closing/i.test(l)));
}
{
  const sb = withBroker([openBuy()], { closeOnCircuitBreak: true });
  sb.adoptOpenTrades("bot start");
  check("10: nothing is queued while the breaker is clear", sb.rebuildForceCloseQueue() === 0);
}

// ---------------------------------------------------------------- 11: unreadable order list
{
  const sb = withBroker([openBuy()]);
  sb.Framework.Orders = { forEach: () => { throw new Error("not available"); } };
  const n = sb.adoptOpenTrades("bot start");
  console.log("\n===== 11: BROKER LIST UNREADABLE =====");
  sb.__logLines.filter((l) => /Could not read/.test(l)).forEach((l) => console.log(l));
  check("11: a broken order list does not throw", n === 0);
  check("11: and it fails loudly rather than silently managing nothing",
    sb.__logLines.some((l) => /Could not read the broker's open order list/.test(l)));
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
