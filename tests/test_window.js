// The trading session window: a clock gate on NEW orders that leaves the GPS logic,
// and the management of anything already open, completely alone.
const { buildSandbox, defaultCfg } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

// A sandbox pinned to a known wall-clock instant, so "is it inside the window" is testable.
// 2025-01-15 15:00 UTC is 10:00 AM Eastern (EST, UTC-5) and 09:00 AM Central.
const AT_10AM_ET = Date.UTC(2025, 0, 15, 15, 0, 0);
const AT_7AM_ET  = Date.UTC(2025, 0, 15, 12, 0, 0);
const AT_1AM_ET  = Date.UTC(2025, 0, 15, 6, 0, 0);

// Freezes the sandbox's wall clock. Date has to stay a real constructor — plenty of the
// engine calls `new Date(...)` — so only the zero-argument form and Date.now() are pinned.
function freezeClock(sb, ts) {
  const Real = Date;
  function FakeDate(...args) {
    return args.length === 0 ? new Real(ts) : new Real(...args);
  }
  FakeDate.now = () => ts;
  FakeDate.UTC = Real.UTC;
  FakeDate.parse = Real.parse;
  FakeDate.prototype = Real.prototype;
  sb.Date = FakeDate;
}

function sandboxAt(ts, cfgOver) {
  const sb = buildSandbox();
  sb.cfg = defaultCfg(cfgOver);
  sb.priceDecimals = 2;
  sb.isRunning = true;
  sb.managedOrders = {};
  sb.forceCloseQueue = {};
  freezeClock(sb, ts);
  return sb;
}

// ---------------------------------------------------------------- 1: off by default
{
  const sb = sandboxAt(AT_10AM_ET);
  const st = sb.tradingWindowState(AT_1AM_ET);     // the middle of the night
  check("1: the window is off by default", st.on === false);
  check("1: and while off, everything counts as inside", st.inside === true);
  check("1: windowLabel says off", sb.windowLabel() === "off");
}

// ---------------------------------------------------------------- 2: inside and outside
{
  const sb = sandboxAt(AT_10AM_ET, { sessionWindowOn: true });   // 08:00 - 11:00 Eastern
  check("2: 10:00 AM ET is inside an 8-11 window",
    sb.tradingWindowState(AT_10AM_ET).inside === true);
  check("2: 7:00 AM ET is outside it",
    sb.tradingWindowState(AT_7AM_ET).inside === false);
  check("2: 1:00 AM ET is outside it",
    sb.tradingWindowState(AT_1AM_ET).inside === false);

  const st = sb.tradingWindowState(AT_10AM_ET);
  check("2: start and stop parsed", st.start === 8 * 60 && st.stop === 11 * 60);
  check("2: the clock reads in the chosen zone", st.nowMins === 10 * 60,
    "got " + st.nowMins);
  check("2: the label is human", sb.windowLabel() === "8:00 AM – 11:00 AM Eastern Time",
    sb.windowLabel());
}

// ---------------------------------------------------------------- 3: timezones
{
  const sb = sandboxAt(AT_10AM_ET, {
    sessionWindowOn: true, sessionWindowTz: "America/Chicago"
  });
  // 10:00 ET is 09:00 CT, which is inside 08:00-11:00 Central.
  check("3: Central reads an hour behind Eastern",
    sb.tradingWindowState(AT_10AM_ET).nowMins === 9 * 60,
    "got " + sb.tradingWindowState(AT_10AM_ET).nowMins);
  check("3: and it is still inside the window",
    sb.tradingWindowState(AT_10AM_ET).inside === true);
}
{
  const sb = sandboxAt(AT_10AM_ET, {
    sessionWindowOn: true, sessionWindowTz: "America/Los_Angeles"
  });
  // 10:00 ET is 07:00 PT — before an 08:00 Pacific start.
  check("3: Pacific is outside the same window at the same instant",
    sb.tradingWindowState(AT_10AM_ET).inside === false);
}

// ---------------------------------------------------------------- 4: overnight wrap
{
  const sb = sandboxAt(AT_1AM_ET, {
    sessionWindowOn: true, sessionWindowStart: "22:00", sessionWindowStop: "02:00"
  });
  check("4: 1:00 AM is inside a 10 PM - 2 AM window",
    sb.tradingWindowState(AT_1AM_ET).inside === true);
  check("4: 10:00 AM is outside it",
    sb.tradingWindowState(AT_10AM_ET).inside === false);
  check("4: and the label reads as PM to AM",
    sb.windowLabel() === "10:00 PM – 2:00 AM Eastern Time", sb.windowLabel());
}

// ---------------------------------------------------------------- 5: orders are gated
{
  const sb = sandboxAt(AT_7AM_ET, { sessionWindowOn: true });   // outside 08:00-11:00
  freezeClock(sb, AT_7AM_ET);   // freeze the clock the gate reads
  sb.engines = [];
  sb.buildEngines();
  sb.submitOrder(sb.engines[0], 2004, 1994, 2014, "test entry");

  console.log("===== 5: OUTSIDE THE WINDOW =====");
  sb.__logLines.slice(-1).forEach((l) => console.log(l));
  check("5: no order goes out outside the window", sb.__orders.length === 0);
  check("5: and the log says the window is why",
    sb.__logLines.some((l) => /NO ORDER SENT/.test(l) && /trading session window/i.test(l)));
  check("5: it also says when trading resumes",
    sb.__logLines.some((l) => /resume at 8:00 AM/.test(l)));
}
{
  const sb = sandboxAt(AT_10AM_ET, { sessionWindowOn: true });  // inside
  freezeClock(sb, AT_10AM_ET);
  sb.engines = [];
  sb.buildEngines();
  sb.submitOrder(sb.engines[0], 2004, 1994, 2014, "test entry");
  check("5: an order inside the window goes out normally", sb.__orders.length === 1);
}
{
  const sb = sandboxAt(AT_7AM_ET);   // window OFF, same awkward hour
  freezeClock(sb, AT_7AM_ET);
  sb.engines = [];
  sb.buildEngines();
  sb.submitOrder(sb.engines[0], 2004, 1994, 2014, "test entry");
  check("5: with the window off, the hour is irrelevant", sb.__orders.length === 1);
}

// ---------------------------------------------------------------- 6: a broken window
{
  // A window the bot cannot parse must not silently block trading all day.
  const sb = sandboxAt(AT_7AM_ET, {
    sessionWindowOn: true, sessionWindowStart: "", sessionWindowStop: "nonsense"
  });
  const st = sb.tradingWindowState(AT_7AM_ET);
  check("6: an unreadable window is marked invalid", st.valid === false);
  check("6: and fails OPEN rather than blocking every trade", st.inside === true);

  freezeClock(sb, AT_7AM_ET);
  sb.engines = [];
  sb.buildEngines();
  sb.submitOrder(sb.engines[0], 2004, 1994, 2014, "test entry");
  check("6: so the order still goes out", sb.__orders.length === 1);

  sb.checkTradingWindowEdge();
  check("6: but it warns that the window is being ignored",
    sb.__logLines.some((l) => /could not be read/i.test(l)));
}

// ---------------------------------------------------------------- 7: the closing edge
{
  const sb = sandboxAt(AT_10AM_ET, { sessionWindowOn: true, sessionWindowFlatten: true });
  sb.managedOrders = { "1": { entryPrice: 2000, dir: "buy", lots: 0.1 } };
  sb.Framework.Orders = {
    get: (id) => (id === "1" ? { orderId: "1", instrumentId: "XAU/USD", closePrice: 2005 } : null),
    forEach: () => {}
  };
  sb.Framework.SendOrder = (req, cb) => { sb.__orders.push(req); cb && cb({ result: { isOkay: true } }); };

  freezeClock(sb, AT_10AM_ET);
  sb.checkTradingWindowEdge();                      // first look: inside, no edge
  check("7: the first look just records the state", sb.__orders.length === 0);

  freezeClock(sb, AT_7AM_ET);               // now outside — the window closed
  sb.checkTradingWindowEdge();

  console.log("\n===== 7: FLATTEN AT WINDOW END =====");
  console.log(JSON.stringify(sb.__orders, null, 2));
  check("7: crossing out of the window closes the open trade",
    sb.__orders.some((o) => o.tradingAction === "CLOSE"));
  check("7: and the log says the window shut",
    sb.__logLines.some((l) => /window CLOSED/i.test(l)));
}
{
  // Flatten OFF: the trade is explicitly left running.
  const sb = sandboxAt(AT_10AM_ET, { sessionWindowOn: true, sessionWindowFlatten: false });
  sb.managedOrders = { "1": { entryPrice: 2000, dir: "buy", lots: 0.1 } };
  sb.Framework.SendOrder = (req, cb) => { sb.__orders.push(req); cb && cb({ result: { isOkay: true } }); };

  freezeClock(sb, AT_10AM_ET);
  sb.checkTradingWindowEdge();
  freezeClock(sb, AT_7AM_ET);
  sb.checkTradingWindowEdge();

  check("7: with flatten OFF nothing is closed", sb.__orders.length === 0);
  check("7: and the log says the trade is left running",
    sb.__logLines.some((l) => /left running on their own stop/i.test(l)));
}
{
  // Re-opening logs once, and does not re-close anything.
  const sb = sandboxAt(AT_7AM_ET, { sessionWindowOn: true, sessionWindowFlatten: true });
  freezeClock(sb, AT_7AM_ET);
  sb.checkTradingWindowEdge();                      // first look: outside
  freezeClock(sb, AT_10AM_ET);
  sb.checkTradingWindowEdge();                      // crosses in
  check("7: crossing back in is announced",
    sb.__logLines.some((l) => /window OPEN/i.test(l)));
  sb.checkTradingWindowEdge();                      // still in — no repeat
  check("7: and is not repeated every tick",
    sb.__logLines.filter((l) => /🟢 Trading session window OPEN/.test(l)).length === 1);
}

// ---------------------------------------------------------------- 8: GPS is untouched
{
  // The window must gate orders only. Signals still fire, still log, still export.
  const sb = sandboxAt(AT_7AM_ET, { sessionWindowOn: true });
  check("8: the window has no say over session tracking",
    typeof sb.sessionAt === "function" && sb.cfg.sessions["ASIA"] === true);
  check("8: and none over persist-through-sessions",
    sb.cfg.engines.e1.persist === true);
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
