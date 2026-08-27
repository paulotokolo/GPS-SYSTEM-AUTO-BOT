// Auto Trailing + Daily Circuit Breaker, ported from the reference bot.
// These touch real money management, so each rule is pinned individually.
const { buildSandbox, defaultCfg } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

// A sandbox with one open managed BUY, and a stubbed Orders table the engine can read.
function withOpenTrade(cfgOver, order) {
  const sb = buildSandbox();
  sb.cfg = defaultCfg(cfgOver);
  sb.priceDecimals = 2;
  sb.isRunning = true;

  const o = Object.assign({
    orderId: "1", instrumentId: "XAU/USD", openPrice: 2000, closePrice: 2000,
    closeTime: null, sl: null, tp: null, profit: 0, volume: { lots: 0.1 }
  }, order);

  sb.Framework.Orders = { get: (id) => (id === "1" ? o : null), forEach: () => {} };
  sb.managedOrders = {
    "1": { entryPrice: o.openPrice, lots: 0.1, slPrice: 1990, tpPrice: 2020,
           breakevenApplied: false, dollarPerPriceUnit: null, mgmtRetryAt: 0 }
  };
  sb.__order = o;
  return sb;
}

// ---------- 1. Trailing does nothing until the profit threshold ----------
{
  // $10 floating, breakeven triggers at half of $40 = $20. Not there yet.
  const sb = withOpenTrade({ autoTrailingOn: true, trailAfterProfitDollars: 40,
    profitLockDistanceDollars: 10, breakevenBufferDollars: 0 },
    { closePrice: 2001, profit: 10 });
  sb.manageOpenTrades();
  console.log("===== 1: BELOW THRESHOLD =====");
  console.log("  modify requests sent:", sb.__orders.length);
  check("1: no stop is moved before the breakeven trigger", sb.__orders.length === 0);
}

// ---------- 2. Breakeven fires at half the trail threshold ----------
{
  // $25 floating >= $20 trigger. dollarPerPriceUnit = 25 / (2002.5-2000) = 10 $/unit.
  // Buffer $5 => 0.5 above entry => SL 2000.50
  const sb = withOpenTrade({ autoTrailingOn: true, trailAfterProfitDollars: 40,
    profitLockDistanceDollars: 10, breakevenBufferDollars: 5 },
    { closePrice: 2002.5, profit: 25 });
  sb.manageOpenTrades();
  const req = sb.__orders[0];
  console.log("\n===== 2: BREAKEVEN =====");
  console.log("  request:", JSON.stringify(req));
  check("2: a modify was sent", !!req);
  check("2: it is a CHANGE, not a new order", req && req.tradingAction === "CHANGE");
  check("2: stop goes to entry + buffer (2000.50)", req && Math.abs(req.sl - 2000.5) < 1e-9,
    req ? "sl=" + req.sl : "");
  check("2: it targets the open order", req && req.orderId === "1");
}

// ---------- 3. Breakeven is skipped when the stop is already better ----------
{
  const sb = withOpenTrade({ autoTrailingOn: true, trailAfterProfitDollars: 40,
    profitLockDistanceDollars: 10, breakevenBufferDollars: 0 },
    { closePrice: 2002.5, profit: 25, sl: 2001 });   // already above entry
  sb.manageOpenTrades();
  console.log("\n===== 3: STOP ALREADY BETTER =====");
  console.log("  modify requests sent:", sb.__orders.length);
  check("3: no request is sent when it would loosen the stop", sb.__orders.length === 0);
  check("3: breakeven is marked done anyway", sb.managedOrders["1"].breakevenApplied === true);
}

// ---------- 4. Trailing follows price once past the threshold ----------
{
  // $60 floating >= $40. rate = 60 / (2006-2000) = 10 $/unit. lock $20 => 2 below 2006 => 2004
  const sb = withOpenTrade({ autoTrailingOn: true, trailAfterProfitDollars: 40,
    profitLockDistanceDollars: 20, breakevenBufferDollars: 0 },
    { closePrice: 2006, profit: 60, sl: 2000 });
  sb.managedOrders["1"].breakevenApplied = true;      // breakeven already done
  sb.manageOpenTrades();
  const req = sb.__orders[0];
  console.log("\n===== 4: TRAILING =====");
  console.log("  request:", JSON.stringify(req));
  check("4: the stop trails to 2004.00", req && Math.abs(req.sl - 2004) < 1e-9, req ? "sl=" + req.sl : "");
}

// ---------- 5. Trailing NEVER loosens an existing stop ----------
{
  // Same trade, but the stop is already tighter (2005) than the trail would set (2004).
  const sb = withOpenTrade({ autoTrailingOn: true, trailAfterProfitDollars: 40,
    profitLockDistanceDollars: 20, breakevenBufferDollars: 0 },
    { closePrice: 2006, profit: 60, sl: 2005 });
  sb.managedOrders["1"].breakevenApplied = true;
  sb.manageOpenTrades();
  console.log("\n===== 5: NEVER LOOSEN =====");
  console.log("  modify requests sent:", sb.__orders.length);
  check("5: a trail that would widen the stop is refused", sb.__orders.length === 0);
}

// ---------- 6. Trailing off means nothing is touched ----------
{
  const sb = withOpenTrade({ autoTrailingOn: false, trailAfterProfitDollars: 40,
    profitLockDistanceDollars: 20 }, { closePrice: 2006, profit: 60 });
  sb.manageOpenTrades();
  check("6: Auto Trailing OFF leaves the trade completely alone", sb.__orders.length === 0);
}

// ---------- 7. Circuit breaker: profit target ----------
{
  const sb = withOpenTrade({ dailyProfitTarget: 50, dailyMaxLoss: 0 },
    { closePrice: 2006, profit: 60 });
  sb.dailyBreakerDayKey = sb.nyParts(Date.now()).dayKey;
  sb.checkDailyCircuitBreaker();
  console.log("\n===== 7: BREAKER - PROFIT TARGET =====");
  sb.__logLines.filter((l) => /circuit breaker/i.test(l)).forEach((l) => console.log("  " + l));
  check("7: the breaker trips on the profit target", sb.circuitBreakerTripped === true);
  check("7: the bot stops running", sb.isRunning === false);
  check("7: it says why", sb.__logLines.some((l) => /profit target/.test(l)));
}

// ---------- 8. Circuit breaker: daily loss, and it counts floating P/L ----------
{
  const sb = withOpenTrade({ dailyProfitTarget: 0, dailyMaxLoss: 50 },
    { closePrice: 1994, profit: -60 });
  sb.dailyBreakerDayKey = sb.nyParts(Date.now()).dayKey;
  sb.checkDailyCircuitBreaker();
  console.log("\n===== 8: BREAKER - DAILY LOSS =====");
  sb.__logLines.filter((l) => /circuit breaker/i.test(l)).forEach((l) => console.log("  " + l));
  check("8: the breaker trips on the daily stop loss", sb.circuitBreakerTripped === true);
  check("8: floating loss on an open trade counts", sb.__logLines.some((l) => /stop loss reached/.test(l)));
}

// ---------- 9. Breaker only counts THIS bot's trades, on THIS EST day ----------
{
  const sb = withOpenTrade({ dailyProfitTarget: 0, dailyMaxLoss: 50 },
    { closePrice: 2000, profit: 0 });
  const today = sb.nyParts(Date.now()).dayKey;
  sb.tradeLog = [
    { dayKey: today,        profit: -20 },   // counts
    { dayKey: "1999-01-01", profit: -500 }   // a different day — must be ignored
  ];
  const pl = sb.computeBotDailyPL();
  console.log("\n===== 9: DAILY P/L SCOPE =====");
  console.log("  computed today's P/L:", pl);
  check("9: yesterday's losses are excluded", Math.abs(pl - (-20)) < 1e-9, "pl=" + pl);

  sb.dailyBreakerDayKey = today;
  sb.checkDailyCircuitBreaker();
  check("9: -20 does not trip a -50 limit", sb.circuitBreakerTripped === false);
}

// ---------- 10. Breaker disabled when both limits are 0 ----------
{
  const sb = withOpenTrade({ dailyProfitTarget: 0, dailyMaxLoss: 0 },
    { closePrice: 1900, profit: -9999 });
  sb.dailyBreakerDayKey = sb.nyParts(Date.now()).dayKey;
  sb.checkDailyCircuitBreaker();
  check("10: both limits at 0 disables the breaker entirely", sb.circuitBreakerTripped === false);
}

// ---------- 11. Account size presets populate the fields ----------
{
  const sb = buildSandbox();
  const seen = {};
  sb.document.getElementById = (id) => (seen[id] = seen[id] || { id, value: "", checked: false });
  sb.applyAccountSizePreset("medium");
  console.log("\n===== 11: ACCOUNT PRESET (medium) =====");
  console.log("  riskPct", seen.riskPct.value, "| hardMaxLot", seen.hardMaxLot.value,
    "| dailyMaxLoss", seen.dailyMaxLoss.value, "| trailAfter", seen.trailAfterProfitDollars.value);
  check("11: risk % is set", seen.riskPct.value === 0.75);
  check("11: hard max lot is set", seen.hardMaxLot.value === 0.5);
  check("11: daily limits are set", seen.dailyMaxLoss.value === 75 && seen.dailyProfitTarget.value === 100);
  check("11: trailing amounts are set", seen.trailAfterProfitDollars.value === 30 &&
    seen.profitLockDistanceDollars.value === 12);
  check("11: trailing is switched on with them", seen.autoTrailingOn.value === "on");

  sb.applyAccountSizePreset("");   // nothing chosen
  check("11: an empty choice leaves fields untouched", seen.riskPct.value === 0.75);
}

// ---------- 12. Floating tracking works with Auto Trailing OFF ----------
{
  const sb = withOpenTrade({ autoTrailingOn: false }, { closePrice: 2003, profit: 30, sl: 1995 });
  sb.trackFloatingOrders();
  const line = sb.__logLines.find((l) => /floating/.test(l));
  console.log("");
  console.log("===== 12: FLOATING TRACKING =====");
  console.log("  " + line);
  console.log("  open:", sb.floatingOpenCount, "| total floating:", sb.floatingTotalPL);

  check("12: floating is tracked even with Auto Trailing OFF", !!line);
  check("12: open trade count is right", sb.floatingOpenCount === 1);
  check("12: floating total is right", Math.abs(sb.floatingTotalPL - 30) < 1e-9);
  check("12: the line reports the live SL", !!line && line.indexOf("SL 1995.00") !== -1);
  check("12: and the entry price", !!line && line.indexOf("entry 2000.00") !== -1);
}

// ---------- 13. Each order reports at most once per interval ----------
{
  const sb = withOpenTrade({ autoTrailingOn: false }, { closePrice: 2003, profit: 30 });
  sb.trackFloatingOrders();
  sb.trackFloatingOrders();          // immediately again
  sb.trackFloatingOrders();
  const n = sb.__logLines.filter((l) => /floating/.test(l)).length;
  console.log("");
  console.log("===== 13: LOG THROTTLE =====");
  console.log("  floating lines after 3 back-to-back calls:", n);
  check("13: repeated calls do not flood the log", n === 1, "lines=" + n);
}

// ---------- 14. A closed order drops out of tracking ----------
{
  const sb = withOpenTrade({ autoTrailingOn: false }, { closeTime: 12345, profit: 30 });
  sb.trackFloatingOrders();
  console.log("");
  console.log("===== 14: CLOSED ORDER =====");
  console.log("  managed orders left:", Object.keys(sb.managedOrders).length);
  check("14: a closed order is removed from managedOrders",
    Object.keys(sb.managedOrders).length === 0);
  check("14: and stops counting toward floating", sb.floatingOpenCount === 0);
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
