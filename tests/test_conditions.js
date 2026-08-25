// Verifies each fire condition gates correctly: body %, bullish, open-at/below-top, retest.
const { buildSandbox, defaultCfg, run, M5 } = require("./harness");

const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });

// Base series ending just after the FVG + retest, with the final breakout bar supplied by
// the caller. FVG zone is 2003.00 -> 2003.50, fvg_swing_low (SL) 2001.80.
function series(breakoutBar, retestBar) {
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else if (i === 44) bars.push({ ts, o: 2004, h: 2008.0, l: 2003.5, c: 2007.5, v: 100 });
    else bars.push(flat(ts, 2002));
  }
  const t0 = asiaOpen + 48 * M5;
  bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 }); // sweep
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 }); // left  (high 2003)
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 }); // middle -> SL
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 }); // FVG bar
  bars.push(Object.assign({ ts: t0 + 4 * M5, v: 100 },
    retestBar || { o: 2004, h: 2005.0, l: 2003.0, c: 2003.2 }));                    // retest (or not)
  bars.push(Object.assign({ ts: t0 + 5 * M5, v: 100 }, breakoutBar));                // candidate
  bars.push(flat(t0 + 6 * M5, 2004));
  return bars;
}

function fired(breakoutBar, cfgOver, retestBar) {
  const sb = run(buildSandbox(), series(breakoutBar, retestBar), defaultCfg(cfgOver));
  const line = sb.__logLines.find((l) => l.includes("*** BUY SIGNAL ***")) || "";
  const pct = (line.match(/body ([\d.]+)%/) || [])[1];
  return { fired: sb.sig.fired, pct: pct, orders: sb.__orders.length };
}

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

// ---- body % above the FVG top: user's confirmed threshold is 15%, not the Pine default 10% ----
// body_pct = (close - fvg_top) / (close - open) * 100
const b10 = fired({ o: 1999.0, h: 2004.2, l: 1998.9, c: 2004.0 }); // (0.5 / 5.0)  = 10%
const b20 = fired({ o: 2001.5, h: 2004.2, l: 2001.4, c: 2004.0 }); // (0.5 / 2.5)  = 20%
const b14 = fired({ o: 2000.0, h: 2004.2, l: 1999.9, c: 2003.9 }); // (0.4 / 3.9)  ~ 10.3%
check("body 10% is REJECTED (Pine default would have fired)", b10.fired === false, "pct=" + b10.pct);
check("body 20% FIRES", b20.fired === true, "pct=" + b20.pct);
check("body below 15% is REJECTED", b14.fired === false, "pct=" + b14.pct);

// A 10% body fires only if the threshold is lowered — proves 15 is what is doing the rejecting.
const b10at10 = fired({ o: 1999.0, h: 2004.2, l: 1998.9, c: 2004.0 }, { minBodyPct: 10 });
check("that same 10% body FIRES at minBodyPct=10", b10at10.fired === true);

// ---- bullish_ok: close > open ----
const bear = fired({ o: 2004.5, h: 2004.6, l: 2002.9, c: 2004.0 }); // close < open
check("bearish candle is REJECTED", bear.fired === false);

// ---- open_ok: open <= fvg_top (2003.50) ----
const openAbove = fired({ o: 2003.8, h: 2005.0, l: 2003.2, c: 2004.8 });
check("open ABOVE fvg_top is REJECTED", openAbove.fired === false);
const openAboveOff = fired({ o: 2003.8, h: 2005.0, l: 2003.2, c: 2004.8 }, { requireOpenBelow: false });
check("...and FIRES once that gate is turned off", openAboveOff.fired === true);

// ---- retest_ok: with open-below disabled, a bar that never taps the zone must not fire ----
// The preceding bar is swapped for one that stays entirely ABOVE the zone, so the FVG is
// genuinely never tapped before the breakout candidate arrives.
const noTap = fired({ o: 2003.9, h: 2005.0, l: 2003.7, c: 2004.7 },
  { requireOpenBelow: false, strictRetest: true },
  { o: 2004.0, h: 2005.0, l: 2003.6, c: 2004.2 });
check("no-tap breakout is REJECTED while the zone is untested", noTap.fired === false);

// Same bars, but the zone IS tapped first -> it fires. Proves the retest gate is the difference.
const tapped = fired({ o: 2003.9, h: 2005.0, l: 2003.7, c: 2004.7 },
  { requireOpenBelow: false, strictRetest: true },
  { o: 2004.0, h: 2005.0, l: 2003.0, c: 2004.2 });
check("...and FIRES once the zone has been tapped", tapped.fired === true);

// ---- above_fvg: close must clear the top ----
const belowTop = fired({ o: 2003.0, h: 2003.4, l: 2002.9, c: 2003.3 });
check("close below fvg_top is REJECTED", belowTop.fired === false);

// ---- volume / size filters are OFF: zero-volume bars must still fire ----
const noVol = run(buildSandbox(),
  series({ o: 2001.5, h: 2004.2, l: 2001.4, c: 2004.0 }).map((b) => Object.assign({}, b, { v: 0 })),
  defaultCfg());
check("zero-volume bars still fire (volume filter OFF)", noVol.sig.fired === true);

console.log("===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
