// End-to-end walk of the GPS sequence for one engine:
//   SESSION CLOSE -> SWEEP -> FIRST ZONE -> RETEST -> BUY
// plus the pip-based levels that now come with it.
const { buildSandbox, defaultCfg, run, eng, st, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

// 2025-01-15 is EST (UTC-5). NY 20:00 => 2025-01-16T01:00:00Z
const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const bars = [];
const addBar = (ts, o, h, l, c) => bars.push({ ts, o, h, l, c, v: 100 });

// 60 bars before Asia (17:00-19:55 NY, no session) — history for the lookback methods.
for (let i = 60; i > 0; i--) {
  const ts = asiaOpen - i * M5;
  const base = 2004 + Math.sin(i / 3) * 1.5;
  addBar(ts, base, base + 0.8, base - 0.8, base + 0.1);
}

// ASIA 20:00 -> 23:55 = 48 bars. The session low must reach 2000 — that is the ref_low.
for (let i = 0; i < 48; i++) {
  const ts = asiaOpen + i * M5;
  if (i === 40) addBar(ts, 2001, 2001.5, 2000.0, 2000.5);   // the ASIA LOW
  else addBar(ts, 2002, 2003, 2001, 2002.5);
}

// After midnight NY: the session closes, then the sequence runs.
const t0 = asiaOpen + 48 * M5;
addBar(t0 + 0 * M5, 2001,   2002.0, 1999.0, 2000.0); // A: SWEEP (low < ref_low 2000)
addBar(t0 + 1 * M5, 2000,   2003.0, 1999.5, 2002.0); // B: left bar of the FVG (high 2003)
addBar(t0 + 2 * M5, 2002,   2006.0, 2001.8, 2005.5); // C: middle bar -> zone_swing_low 2001.8
addBar(t0 + 3 * M5, 2005,   2006.5, 2003.5, 2006.0); // D: FVG bar, low 2003.5 > B.high 2003
addBar(t0 + 4 * M5, 2004,   2005.0, 2003.0, 2003.2); // E: retest (low 2003.0 <= top 2003.5)
addBar(t0 + 5 * M5, 2003,   2004.2, 2002.9, 2004.0); // F: BUY (body 20% above the top)
addBar(t0 + 6 * M5, 2004.0, 2005.0, 2003.8, 2004.8); // G
addBar(t0 + 7 * M5, 2004.8, 2005.2, 2004.0, 2004.5); // H
addBar(t0 + 8 * M5, 2004.0, 2005.5, 2003.2, 2005.0); // I
addBar(t0 + 9 * M5, 2005.0, 2005.6, 2004.6, 2005.3); // J

const sb = run(buildSandbox(), bars, defaultCfg());
const s = st(sb);
const lines = sb.__logLines;
const orders = sb.__orders;

console.log("===== MILESTONE LOG =====");
lines.filter((l) => /SESSION|SWEEP|FVG|BUY|reset|carry/i.test(l)).forEach((l) => console.log(l));

console.log("\n===== FINAL ENGINE 1 STATE =====");
console.log({
  ref_name: s.ref_name, ref_low: s.ref_low, ref_high: s.ref_high,
  sweep: s.sweep, swing_low: s.swing_low,
  zone_top: s.zone_top, zone_bot: s.zone_bot, zone_swing_low: s.zone_swing_low,
  zone_found: s.zone_found, zone_tested: s.zone_tested, fired: s.fired,
  fires: eng(sb).fires
});

console.log("\n===== ORDERS SENT =====");
console.log(JSON.stringify(orders, null, 2));

const sig = sb.signalLog[0];

check("ref locked from ASIA", s.ref_name === "ASIA");
check("ref_low == 2000", Math.abs(s.ref_low - 2000) < 1e-9);
check("sweep detected", s.sweep === true);
check("zone found", s.zone_found === true);
check("zone_top == 2003.5", Math.abs(s.zone_top - 2003.5) < 1e-9);
check("zone_bot == 2003.0", Math.abs(s.zone_bot - 2003.0) < 1e-9);
check("zone_swing_low == 2001.8 (the MIDDLE candle)", Math.abs(s.zone_swing_low - 2001.8) < 1e-9);
check("retest registered", s.zone_tested === true);
check("BUY fired", s.fired === true);
check("engine counted exactly one fire", eng(sb).fires === 1);

// ---- the log label the client specified ----
const buyLine = lines.find((l) => l.includes("GPS BUY —")) || "";
check("BUY line carries the engine label",
  buyLine.includes("[Engine 1: Priority FVG | SESSION sweep]"), buyLine.slice(0, 90));
check("BUY line carries the engine's colour emoji", buyLine.includes("🔵"));

// ---- pip-based levels: entry 2004.00, pipSize 0.1, SL 100p, TP1 100p ----
check("a signal was recorded", !!sig);
check("SL is 100 pips below entry", !!sig && Math.abs(sig.entry - sig.sl - 10.0) < 1e-9,
  sig ? "entry " + sig.entry + " sl " + sig.sl : "");
check("TP1 is 100 pips above entry", !!sig && Math.abs(sig.tp1 - sig.entry - 10.0) < 1e-9);
check("TP2 is 200 pips above entry", !!sig && Math.abs(sig.tp2 - sig.entry - 20.0) < 1e-9);
check("TP3 is 300 pips above entry", !!sig && Math.abs(sig.tp3 - sig.entry - 30.0) < 1e-9);
check("the signal records which engine produced it",
  !!sig && sig.engine === "Engine 1: Priority FVG");

// ---- orders ----
check("exactly one order was sent", orders.length === 1);
check("order is a BUY", orders.length > 0 && orders[0].tradingAction === "BUY");
check("order carries the pip stop", orders.length > 0 && orders[0].sl && orders[0].sl.pips === 100);
check("order comment tags the engine",
  orders.length > 0 && /-E1$/.test(orders[0].comment), orders.length ? orders[0].comment : "");

// ---- Pine parity details ----
check("the zone is marked tested on its FORMATION bar (matches Pine)",
  lines.some((l) => l.includes("00:15 EST") && l.includes("FVG RETEST")));
check("the fire is still blocked on the formation bar by above_zone",
  !lines.some((l) => l.includes("00:15 EST") && l.includes("GPS BUY —")));

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
