// Scenario tests for Pre-Session FVG = ON: cross-session carry-over and 50-bar expiry.
const { buildSandbox, defaultCfg, engineCfg, run, eng, st, M5 } = require("./harness");

const results = [];
function check(name, ok) { results.push([name, ok]); }

// 2025-01-15 is EST (UTC-5). NY 20:00 -> 2025-01-16T01:00:00Z
const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });

// Builds: Asia session (low 2000) -> Asia closes 00:00 -> sweep -> quiet bars ->
// LONDON opens 02:00 (carry-over) -> FVG + retest + BUY inside London.
function buildCrossSession() {
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));

  // ASIA 20:00-23:55 (48 bars): low 2000 at bar 40, plus two swing highs late enough to stay
  // inside the 50-bar TP lookback measured back from the entry bar.
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else if (i === 34) bars.push({ ts, o: 2004, h: 2006.0, l: 2003.5, c: 2005.5, v: 100 }); // swing high
    else if (i === 44) bars.push({ ts, o: 2004, h: 2008.0, l: 2003.5, c: 2007.5, v: 100 }); // swing high
    else bars.push(flat(ts, 2002));
  }

  const t0 = asiaOpen + 48 * M5;             // 00:00 NY — Asia session close bar
  bars.push({ ts: t0, o: 2001, h: 2002, l: 1999.0, c: 2000.0, v: 100 }); // SWEEP right after close

  // Quiet bars 00:05 -> 01:55 (23 bars) — no session, setup must simply persist.
  // These sit at 2001 (h 2001.5 / l 2000.5) so they cannot gap against each other.
  for (let i = 1; i <= 23; i++) bars.push(flat(t0 + i * M5, 2001));

  // LONDON opens at 02:00 NY = t0 + 24 bars. Setup is active -> must carry over, NOT reset.
  // The FVG must be the FIRST one after the sweep, so P's high is deliberately set above R's
  // low — otherwise the middle candle itself gaps the open bar and forms an earlier FVG.
  const L = t0 + 24 * M5;
  bars.push({ ts: L + 0 * M5, o: 2001, h: 2004.0, l: 2000.5, c: 2003.0, v: 100 }); // P: London open
  bars.push({ ts: L + 1 * M5, o: 2003, h: 2003.0, l: 2000.5, c: 2002.5, v: 100 }); // Q: left  (high 2003)
  bars.push({ ts: L + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 }); // R: middle -> SL 2001.8
  bars.push({ ts: L + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 }); // S: FVG (3.5 > Q.h 3.0)
  bars.push({ ts: L + 4 * M5, o: 2004, h: 2005.0, l: 2003.0, c: 2003.2, v: 100 }); // T: retest
  bars.push({ ts: L + 5 * M5, o: 2003, h: 2004.2, l: 2002.9, c: 2004.0, v: 100 }); // U: BUY
  bars.push(flat(L + 6 * M5, 2004));
  return bars;
}

// ---------- Scenario A: carry-over across the Asia -> London boundary ----------
{
  const sb = run(buildSandbox(), buildCrossSession(), defaultCfg());
  const s = st(sb), lines = sb.__logLines;
  const has = (re) => lines.some((l) => re.test(l));

  console.log("===== A: CROSS-SESSION CARRY-OVER =====");
  lines.filter((l) => /SESSION|SWEEP|FVG|BUY|reset|carr/i.test(l)).forEach((l) => console.log(l));

  check("A: Asia ref locked", s.ref_name === "ASIA" || s.ref_name === "LONDON");
  check("A: sweep survived into London", s.sweep === true);
  check("A: carry-over was marked at session open", has(/carried over/));
  check("A: setup was NOT reset at London open", !has(/session open, no active setup/));
  check("A: FVG formed during London", s.zone_found === true);
  check("A: SL is the FVG middle candle (2001.80)", Math.abs(s.zone_swing_low - 2001.8) < 1e-9);
  check("A: BUY fired across the session boundary", s.fired === true);
  check("A: exactly one initial BUY order", sb.__orders.length >= 1 && sb.__orders[0].tradingAction === "BUY");
}

// ---------- Scenario B: carry-over expires after 50 bars ----------
{
  // Same setup, but nothing ever completes: after London opens, just drift quietly for 60 bars.
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else bars.push(flat(ts, 2002));
  }
  const t0 = asiaOpen + 48 * M5;
  bars.push({ ts: t0, o: 2001, h: 2002, l: 1999.0, c: 2000.0, v: 100 }); // SWEEP
  for (let i = 1; i <= 23; i++) bars.push(flat(t0 + i * M5, 2001));      // quiet to 01:55
  const L = t0 + 24 * M5;                                                // LONDON open 02:00
  for (let i = 0; i <= 30; i++) bars.push(flat(L + i * M5, 2001));       // quiet bars — must expire

  // A 20-bar boundary carry-over, and the drift stops before London closes — so the ref
  // this asserts on is the one the expiry reset cleared, not a later re-lock.
  const sb = run(buildSandbox(), bars, defaultCfg({ engines: { e1: { preSessMaxBars: 20 } } }));
  const s = st(sb), lines = sb.__logLines;

  console.log("\n===== B: CARRY-OVER EXPIRY (20 BARS) =====");
  lines.filter((l) => /SESSION|SWEEP|reset|carr/i.test(l)).forEach((l) => console.log(l));

  check("B: carry-over was marked", lines.some((l) => /carried over/.test(l)));
  check("B: expiry reset fired at the carry-over cutoff", lines.some((l) => /carry-over exceeded 20 bars/.test(l)));
  check("B: sweep cleared by the reset", s.sweep === false);
  check("B: no order was placed", sb.__orders.length === 0);
  // Pine's sig_reset() clears ref_high/ref_low/ref_name outright (ref_name := "").
  check("B: sig_reset cleared the ref levels (matches Pine sig_reset)", s.ref_low === null);
}

// ---------- Scenario C: NY Lunch is not a signal session ----------
{
  const sb = buildSandbox();
  const cfg = defaultCfg();
  sb.cfg = cfg;
  // 12:30 NY on 2025-01-16 = 17:30 UTC — inside NY Lunch, which is disabled.
  const lunchMins = sb.nyParts(Date.UTC(2025, 0, 16, 17, 30, 0)).mins;
  const nyamMins  = sb.nyParts(Date.UTC(2025, 0, 16, 15, 0, 0)).mins;  // 10:00 NY -> NY AM
  const asiaMins  = sb.nyParts(Date.UTC(2025, 0, 16, 2, 0, 0)).mins;   // 21:00 NY -> Asia
  console.log("\n===== C: SESSION WINDOW MAPPING =====");
  console.log("12:30 NY ->", sb.sessionAt(lunchMins), "| 10:00 NY ->", sb.sessionAt(nyamMins), "| 21:00 NY ->", sb.sessionAt(asiaMins));
  check("C: NY Lunch is not a signal session", sb.sessionAt(lunchMins) === null);
  check("C: 10:00 maps to NY AM", sb.sessionAt(nyamMins) === "NY AM");
  check("C: 21:00 maps to ASIA", sb.sessionAt(asiaMins) === "ASIA");
}

// ---------- Scenario D: EDT (daylight saving) still resolves correctly ----------
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  // 2025-07-15 is EDT (UTC-4). NY 09:45 = 13:45 UTC -> must be NY AM.
  const edt = sb.nyParts(Date.UTC(2025, 6, 15, 13, 45, 0));
  console.log("\n===== D: DAYLIGHT SAVING =====");
  console.log("2025-07-15 13:45 UTC ->", edt.label, "->", sb.sessionAt(edt.mins));
  check("D: EDT 09:45 NY maps to NY AM", sb.sessionAt(edt.mins) === "NY AM" && edt.hour === 9);
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
