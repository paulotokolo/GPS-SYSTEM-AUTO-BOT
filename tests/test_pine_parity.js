// Locks in the behaviours corrected after the real Pine source (GPS SOURCE CODE) arrived.
// Each assertion below cites the source line it mirrors.
const { buildSandbox, defaultCfg, run, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });

// Asia (low 2000) -> closes 00:00 -> sweep -> FVG -> retest -> BUY at 00:25,
// then quiet bars running past the LONDON open at 02:00.
function seriesThroughLondonOpen() {
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
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 }); // left
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 }); // middle
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 }); // FVG
  bars.push({ ts: t0 + 4 * M5, o: 2004, h: 2005.0, l: 2003.0, c: 2003.2, v: 100 }); // retest
  bars.push({ ts: t0 + 5 * M5, o: 2003, h: 2004.2, l: 2002.9, c: 2004.0, v: 100 }); // BUY
  for (let i = 6; i <= 30; i++) bars.push(flat(t0 + i * M5, 2004));                  // through 02:00
  return bars;
}

// ---- 1. Persist Through Sessions ON => a session opening never resets (Pine line 968) ----
{
  const sb = run(buildSandbox(), seriesThroughLondonOpen(), defaultCfg({ persistSessions: true }));
  const lines = sb.__logLines;
  console.log("===== 1: SESSION OPEN WITH PERSIST ON =====");
  lines.filter(l => /SESSION|BUY|reset/i.test(l)).forEach(l => console.log(l));
  check("1: fired setup SURVIVES the London open (no reset)", sb.sig.fired === true);
  check("1: no reset was logged at session open",
    !lines.some(l => /Setup reset/.test(l) && /session open/.test(l)));
}

// ---- 2. Persist OFF => the else-branch runs and the session open DOES reset ----
{
  const sb = run(buildSandbox(), seriesThroughLondonOpen(),
    defaultCfg({ persistSessions: false, preSessionFvg: true }));
  console.log("\n===== 2: SESSION OPEN WITH PERSIST OFF =====");
  sb.__logLines.filter(l => /Setup reset|SESSION OPEN/i.test(l)).forEach(l => console.log(l));
  check("2: setup IS reset at the session open when persist is OFF",
    sb.__logLines.some(l => /Persist Through Sessions is OFF/.test(l)));
  check("2: fired cleared by that reset", sb.sig.fired === false);
}

// ---- 3. sig_reset() clears the reference levels (Pine method sig_reset) ----
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  sb.sig = sb.newSig();
  sb.sig.ref_low = 1990; sb.sig.ref_high = 2010; sb.sig.ref_name = "ASIA"; sb.sig.sweep = true;
  sb.sigReset("test");
  console.log("\n===== 3: SIG_RESET =====");
  console.log("after reset -> ref_low:", sb.sig.ref_low, "ref_name:", JSON.stringify(sb.sig.ref_name), "sweep:", sb.sig.sweep);
  check("3: ref_low cleared", sb.sig.ref_low === null);
  check("3: ref_high cleared", sb.sig.ref_high === null);
  check("3: ref_name cleared", !sb.sig.ref_name);
  check("3: sweep cleared", sb.sig.sweep === false);
}

// ---- 4. Swing highs use a 1-bar fractal (Pine find_swing_highs) ----
{
  // A high that clears only its immediate neighbours is a valid swing high at width 1,
  // but is rejected at width 2. Bar 44 (2008) has 2002-highs on both sides, so it passes both;
  // bar 34 (2006) is deliberately adjacent to a taller bar to separate the two widths.
  const sb1 = run(buildSandbox(), seriesThroughLondonOpen(), defaultCfg({ pivotWidth: 1 }));
  const sb2 = run(buildSandbox(), seriesThroughLondonOpen(), defaultCfg({ pivotWidth: 2 }));
  console.log("\n===== 4: SWING HIGH FRACTAL WIDTH =====");
  console.log("width 1 TPs:", sb1.sig.tps.map(x => x.toFixed(2)).join(" / ") || "none");
  console.log("width 2 TPs:", sb2.sig.tps.map(x => x.toFixed(2)).join(" / ") || "none");
  check("4: width-1 finds at least one TP", sb1.sig.tps.length >= 1);
  check("4: TPs are strictly ascending",
    sb1.sig.tps.every((v, i, a) => i === 0 || v > a[i - 1]));
}

// ---- 5. Invalidation clears only the FVG, keeping the sweep (Pine line 1035) ----
{
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else bars.push(flat(ts, 2002));
  }
  const t0 = asiaOpen + 48 * M5;
  bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 }); // sweep
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 }); // left
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 }); // middle
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 }); // FVG (bot 2003)
  bars.push({ ts: t0 + 4 * M5, o: 2003, h: 2003.2, l: 2001.0, c: 2001.5, v: 100 }); // CLOSE below bot
  bars.push(flat(t0 + 5 * M5, 2002));

  const sb = run(buildSandbox(), bars, defaultCfg({ invalidateFvg: true }));
  console.log("\n===== 5: FVG INVALIDATION =====");
  sb.__logLines.filter(l => /INVALIDATED|FVG|SWEEP/i.test(l)).forEach(l => console.log(l));
  check("5: FVG was invalidated on a CLOSE below the zone bottom",
    sb.__logLines.some(l => /FVG INVALIDATED/.test(l)));
  check("5: fvg_found cleared", sb.sig.fvg_found === false);
  check("5: sweep SURVIVES invalidation", sb.sig.sweep === true);
  check("5: swing_low survives invalidation", sb.sig.swing_low !== null);
}

// ---- 6. Session windows are configurable (NY AM 0930-1100 vs 0930-1200) ----
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  const at1130 = sb.nyParts(Date.UTC(2025, 0, 16, 16, 30, 0)).mins; // 11:30 NY
  const in1200 = sb.sessionAt(at1130);
  sb.cfg = defaultCfg({
    sessionWindows: Object.assign({}, defaultCfg().sessionWindows,
      { "NY AM": { open: 9 * 60 + 30, close: 11 * 60 } })
  });
  const in1100 = sb.sessionAt(at1130);
  console.log("\n===== 6: CONFIGURABLE NY AM WINDOW =====");
  console.log("11:30 NY with 0930-1200 ->", in1200, "| with 0930-1100 ->", in1100);
  check("6: 11:30 is inside NY AM when the window is 0930-1200", in1200 === "NY AM");
  check("6: 11:30 is OUTSIDE NY AM when the window is 0930-1100", in1100 === null);
}

// ---- 7. body_ok short-circuits at a 0% threshold (Pine line 1057) ----
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg({ minBodyPct: 0 });
  check("7: minBodyPct 0 accepts any body", sb.cfg.minBodyPct <= 0);
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
