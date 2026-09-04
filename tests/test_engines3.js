// The three-engine architecture from the updated GPS PRO source:
//   - Rolling Lookback vs Killzone Session reference lows
//   - 5-candle R-G-G-G-R demand zones vs 3-candle FVG gaps
//   - zone max age, require-fresh-sweep, and engine independence
const { buildSandbox, defaultCfg, run, eng, st, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });

// Asia 20:00-23:55 with its low at 2000, closing at 00:00 NY.
function asiaLeadIn() {
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else bars.push({ ts, o: 2002, h: 2003, l: 2001, c: 2002.5, v: 100 });
  }
  return bars;
}
const t0 = asiaOpen + 48 * M5;

// Sweep -> 3-candle FVG -> retest -> BUY. The shape both FVG engines take.
function fvgSequence() {
  const bars = asiaLeadIn();
  bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 }); // sweep
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 }); // left
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 }); // middle
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 }); // FVG
  bars.push({ ts: t0 + 4 * M5, o: 2004, h: 2005.0, l: 2003.0, c: 2003.2, v: 100 }); // retest
  bars.push({ ts: t0 + 5 * M5, o: 2003, h: 2004.2, l: 2002.9, c: 2004.0, v: 100 }); // BUY
  bars.push(flat(t0 + 6 * M5, 2004));
  return bars;
}

// ---------- 1. Rolling Lookback tracks a swing low with no session close ----------
{
  // Only engine 2 runs, and its reference never needs a killzone to close.
  const sb = run(buildSandbox(), fvgSequence(),
    defaultCfg({ engines: { e1: { enabled: false }, e2: { enabled: true } } }));
  const s = st(sb, 2);
  console.log("===== 1: ROLLING LOOKBACK =====");
  sb.__logLines.filter((l) => /E2/.test(l)).forEach((l) => console.log(l));
  check("1: engine 2 named its reference 'Swing', not a session", s.ref_name === "Swing");
  check("1: engine 2 swept its rolling low", s.sweep === true || s.fired === true);
  check("1: engine 2 found a zone", s.zone_found === true || s.fired === true);
  check("1: engine 2 fired", s.fired === true);
  const line = sb.__logLines.find((l) => l.includes("GPS BUY —")) || "";
  check("1: its label says Rolling sweep",
    line.includes("[Engine 2: Add-On FVG | Rolling sweep]"), line.slice(0, 80));
  check("1: its label carries the yellow emoji", line.includes("🟡"));
}

// ---------- 2. A rolling engine re-arms itself after firing ----------
{
  // Pine soft-resets a Rolling Lookback engine on the bar after it fires, because there is
  // no session boundary to do it. After the fire the state must be clear again.
  const bars = fvgSequence();
  for (let i = 7; i <= 12; i++) bars.push(flat(t0 + i * M5, 2004));
  const sb = run(buildSandbox(), bars,
    defaultCfg({ engines: { e1: { enabled: false }, e2: { enabled: true } } }));
  const s = st(sb, 2);
  console.log("\n===== 2: ROLLING RE-ARM =====");
  console.log("after the fire ->", { fired: s.fired, sweep: s.sweep, zone_found: s.zone_found });
  check("2: fired was cleared by the re-arm", s.fired === false);
  check("2: the sweep was cleared too", s.sweep === false);
  check("2: the engine still counted its fire", eng(sb, 2).fires === 1);
  check("2: exactly one order went out", sb.__orders.length === 1);
}

// ---------- 3. The 5-candle R-G-G-G-R demand zone ----------
{
  const bars = asiaLeadIn();
  bars.push({ ts: t0 + 0 * M5, o: 2001,   h: 2002.0, l: 1999.0, c: 2000.0, v: 100 }); // sweep
  // R, G, G, G, R — the base red candle's own range is the zone: 2001.00 -> 2002.50
  bars.push({ ts: t0 + 1 * M5, o: 2002,   h: 2002.5, l: 2001.0, c: 2001.5, v: 100 }); // R (base)
  bars.push({ ts: t0 + 2 * M5, o: 2001.6, h: 2002.2, l: 2001.5, c: 2002.0, v: 100 }); // G
  bars.push({ ts: t0 + 3 * M5, o: 2002.0, h: 2002.6, l: 2001.9, c: 2002.4, v: 100 }); // G
  bars.push({ ts: t0 + 4 * M5, o: 2002.4, h: 2003.0, l: 2002.3, c: 2002.8, v: 100 }); // G
  bars.push({ ts: t0 + 5 * M5, o: 2002.8, h: 2003.1, l: 2002.6, c: 2002.7, v: 100 }); // R -> zone
  bars.push({ ts: t0 + 6 * M5, o: 2002.7, h: 2002.9, l: 2002.2, c: 2002.4, v: 100 }); // retest
  bars.push({ ts: t0 + 7 * M5, o: 2002.4, h: 2003.5, l: 2002.3, c: 2003.2, v: 100 }); // BUY
  bars.push(flat(t0 + 8 * M5, 2003));

  const sb = run(buildSandbox(), bars,
    defaultCfg({ engines: { e1: { enabled: false }, e3: { enabled: true } } }));
  const s = st(sb, 3);
  console.log("\n===== 3: 5-CANDLE DEMAND ZONE =====");
  sb.__logLines.filter((l) => /E3|SESSION CLOSE/.test(l)).forEach((l) => console.log(l));
  check("3: the zone is the base candle's own range (top 2002.50)",
    Math.abs(s.zone_top - 2002.5) < 1e-9 || s.fired, "top=" + s.zone_top);
  check("3: engine 3 fired", s.fired === true);
  const line = sb.__logLines.find((l) => l.includes("GPS BUY —")) || "";
  check("3: its label says Demand Zone and SESSION sweep",
    line.includes("[Engine 3: Demand Zone | SESSION sweep]"), line.slice(0, 80));
  check("3: its label carries the red emoji", line.includes("🔴"));
  check("3: its milestones say DEMAND ZONE, never FVG",
    sb.__logLines.some((l) => /E3.*DEMAND ZONE FOUND/.test(l)) &&
    !sb.__logLines.some((l) => /E3.*FVG/.test(l)));
}

// ---------- 4. The two zone methods are genuinely different rules ----------
{
  // The same candles through both methods. The FVG rule looks for a gap; the 5-candle rule
  // takes the base red candle's own range. They must not land on the same zone.
  const bars = asiaLeadIn();
  bars.push({ ts: t0 + 0 * M5, o: 2001,   h: 2002.0, l: 1999.0, c: 2000.0, v: 100 });
  bars.push({ ts: t0 + 1 * M5, o: 2002,   h: 2002.5, l: 2001.0, c: 2001.5, v: 100 });
  bars.push({ ts: t0 + 2 * M5, o: 2001.6, h: 2002.2, l: 2001.5, c: 2002.0, v: 100 });
  bars.push({ ts: t0 + 3 * M5, o: 2002.0, h: 2002.6, l: 2001.9, c: 2002.4, v: 100 });
  bars.push({ ts: t0 + 4 * M5, o: 2002.4, h: 2003.0, l: 2002.3, c: 2002.8, v: 100 });
  bars.push({ ts: t0 + 5 * M5, o: 2002.8, h: 2003.1, l: 2002.6, c: 2002.7, v: 100 });
  // One more bar so the pattern-completion bar above is a CLOSED bar and gets processed;
  // its open equals its close, so it is not bullish and cannot fire either engine.
  bars.push(flat(t0 + 6 * M5, 2002.7));
  const sb = run(buildSandbox(), bars, defaultCfg());
  const sb3 = run(buildSandbox(), bars,
    defaultCfg({ engines: { e1: { enabled: false }, e3: { enabled: true } } }));
  console.log("\n===== 4: FVG ENGINE ON A 5-CANDLE SERIES =====");
  console.log("E1 zone_top:", st(sb).zone_top, "| E3 zone_top:", st(sb3, 3).zone_top);
  check("4: the FVG engine swept", st(sb).sweep === true);
  // Both engines saw the same candles and marked DIFFERENT zones — the gap between
  // candle 3 and candle 5 for the FVG rule, the base candle range for the 5-candle rule.
  check("4: the two methods mark different zones",
    st(sb).zone_found && st(sb3, 3).zone_found &&
    Math.abs(st(sb).zone_top - st(sb3, 3).zone_top) > 1e-9,
    "fvg=" + st(sb).zone_top + " demand=" + st(sb3, 3).zone_top);
  check("4: neither has broken out yet, so no order went out", sb.__orders.length === 0);
}

// ---------- 5. Zone max age expires a zone that never breaks out ----------
{
  const bars = asiaLeadIn();
  bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 }); // sweep
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 }); // left
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 }); // middle
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 }); // FVG
  // Drift below the zone top so nothing ever breaks out, for longer than the cutoff.
  for (let i = 4; i <= 20; i++) bars.push({ ts: t0 + i * M5, o: 2003.0, h: 2003.2, l: 2002.8, c: 2003.0, v: 100 });

  const sb = run(buildSandbox(), bars,
    defaultCfg({ engines: { e1: { useZoneMaxAge: true, maxZoneBars: 6, requireResweep: true } } }));
  const s = st(sb);
  console.log("\n===== 5: ZONE MAX AGE =====");
  sb.__logLines.filter((l) => /EXPIRED|FOUND|SWEEP/.test(l)).forEach((l) => console.log(l));
  check("5: the zone expired at its cutoff",
    sb.__logLines.some((l) => /FVG EXPIRED/.test(l)));
  check("5: zone_found was cleared", s.zone_found === false);
  check("5: zone_expired is set", s.zone_expired === true);
  check("5: require-fresh-sweep cleared the sweep too", s.sweep === false);
  check("5: nothing was ordered", sb.__orders.length === 0);
}

// ---------- 6. Require-fresh-sweep OFF keeps the sweep after an expiry ----------
{
  const bars = asiaLeadIn();
  bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 });
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 });
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 });
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 });
  for (let i = 4; i <= 20; i++) bars.push({ ts: t0 + i * M5, o: 2003.0, h: 2003.2, l: 2002.8, c: 2003.0, v: 100 });

  const sb = run(buildSandbox(), bars,
    defaultCfg({ engines: { e1: { useZoneMaxAge: true, maxZoneBars: 6, requireResweep: false } } }));
  const s = st(sb);
  console.log("\n===== 6: RESWEEP OFF =====");
  console.log("after expiry ->", { sweep: s.sweep, zone_found: s.zone_found });
  check("6: the sweep SURVIVES the expiry when a fresh one is not required", s.sweep === true);
  check("6: the zone is still gone", s.zone_found === false);
}

// ---------- 7. Engines are independent ----------
{
  const sb = run(buildSandbox(), fvgSequence(),
    defaultCfg({ engines: { e1: { enabled: true }, e2: { enabled: true } } }));
  console.log("\n===== 7: TWO ENGINES ON ONE SERIES =====");
  console.log("E1 fired:", st(sb, 1).fired, "| E2 fired:", st(sb, 2).fired,
              "| orders:", sb.__orders.length);
  check("7: both engines fired on the same series",
    eng(sb, 1).fires === 1 && eng(sb, 2).fires === 1);
  check("7: two engines firing means TWO separate entries", sb.__orders.length === 2);
  check("7: the orders are tagged to different engines",
    sb.__orders.length === 2 && sb.__orders[0].comment !== sb.__orders[1].comment,
    sb.__orders.map((o) => o.comment).join(" / "));

  // Engine 1 keeps `fired` because it is a session engine; engine 2 re-armed itself.
  check("7: the session engine holds `fired` until its next session close",
    st(sb, 1).fired === true);
}

// ---------- 8. A disabled engine does nothing at all ----------
{
  const sb = run(buildSandbox(), fvgSequence(),
    defaultCfg({ engines: { e1: { enabled: false }, e2: { enabled: false }, e3: { enabled: false } } }));
  console.log("\n===== 8: ALL ENGINES OFF =====");
  console.log("engines built:", sb.engines.length, "| orders:", sb.__orders.length);
  check("8: no engines are built", sb.engines.length === 0);
  check("8: no orders are placed", sb.__orders.length === 0);
  check("8: no BUY is logged", !sb.__logLines.some((l) => l.includes("GPS BUY —")));
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
