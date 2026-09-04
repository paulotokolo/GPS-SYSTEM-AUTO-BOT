// Order-path tests: what actually reaches SendOrder, and why an order might not.
//
// This exists because "a signal fired but no trade opened" was a real reported problem.
// Absolute-price SL/TP on an OPENING request is unproven on this platform, so the default
// is now to send a plain order and attach the levels immediately afterwards.
const { buildSandbox, defaultCfg, engineCfg, run, eng, st, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });

// Asia low 2000 -> sweep -> FVG (SL 2001.80) -> retest -> BUY at 2004.00
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
  bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 }); // sweep
  bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 }); // left
  bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 }); // middle -> SL
  bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 }); // FVG
  bars.push({ ts: t0 + 4 * M5, o: 2004, h: 2005.0, l: 2003.0, c: 2003.2, v: 100 }); // retest
  bars.push({ ts: t0 + 5 * M5, o: 2003, h: 2004.2, l: 2002.9, c: 2004.0, v: 100 }); // BUY
  bars.push(flat(t0 + 6 * M5, 2004));
  return bars;
}

// ---------- 1. "on open" puts the levels on the request ----------
{
  const sb = run(buildSandbox(), series(), defaultCfg({ attachMode: "open" }));
  const o = sb.__orders[0];
  console.log("===== 1: ATTACH ON OPEN =====");
  console.log("  request:", JSON.stringify(o));
  // The levels are PIP DISTANCES now, which is the one form this platform is proven to
  // accept on an opening request — the same shape the manual test trade sends.
  check("1: an order was sent", !!o);
  check("1: SL rides on the opening request as pips",
    o && o.sl && o.sl.pips === 100, o ? "sl=" + JSON.stringify(o.sl) : "");
  check("1: TP rides on the opening request as pips",
    o && o.tp && o.tp.pips === 100, o ? "tp=" + JSON.stringify(o.tp) : "");
  check("1: no absolute price is sent on the open",
    o && typeof o.sl !== "number" && typeof o.tp !== "number");
}

// ---------- 2. "after open" sends a PLAIN order (the new default) ----------
{
  const sb = run(buildSandbox(), series(), defaultCfg({ attachMode: "after" }));
  const o = sb.__orders[0];
  console.log("\n===== 2: ATTACH AFTER OPEN =====");
  console.log("  request:", JSON.stringify(o));
  check("2: an order was still sent", !!o);
  check("2: the opening request carries NO sl", o && o.sl === undefined);
  check("2: the opening request carries NO tp", o && o.tp === undefined);
  check("2: volume and direction are intact",
    o && o.tradingAction === "BUY" && o.volume && o.volume.lots > 0);
  // The levels are not lost — they are queued for OnOrderOpen to attach, as absolute
  // prices computed from the pip distances (a modify takes prices, not pips).
  // Entry 2004.00, 100 pips at a 0.1 pip size = 10.00 of price, so SL is 1994.00.
  const q = sb.pendingManagement[0];
  check("2: SL is queued for attachment after the fill",
    q && Math.abs(q.slPrice - 1994.0) < 1e-9, q ? "queued sl=" + q.slPrice : "nothing queued");
  check("2: TP is queued too", q && Math.abs(q.tpPrice - 2014.0) < 1e-9,
    q ? "queued tp=" + q.tpPrice : "nothing queued");
}

// ---------- 3. Dry run must never send an order ----------
{
  const sb = run(buildSandbox(), series(), defaultCfg({ tradingMode: "dry" }));
  const saidWhy = sb.__logLines.some((l) => /DRY RUN/.test(l) && /NO ORDER SENT/.test(l));
  console.log("\n===== 3: DRY RUN =====");
  console.log("  orders sent:", sb.__orders.length, "| explained in the log:", saidWhy);
  check("3: no order is sent in dry run", sb.__orders.length === 0);
  check("3: the log says WHY nothing was sent", saidWhy);
}

// ---------- 4. Every refusal explains itself ----------
{
  // Daily cap of 1: the initial BUY goes, a second attempt is refused with a reason.
  const sb = buildSandbox();
  sb.cfg = defaultCfg({ maxEntriesPerDay: 1 });
  sb.priceDecimals = 2;
  sb.entriesDayKey = sb.nyParts(Date.now()).dayKey;
  sb.entriesToday = 1;                      // cap already reached
  sb.pendingOrder = false;
  sb.submitBuy(2004, 2001.8, 2006.5, "test entry", false);

  const refused = sb.__logLines.some((l) => /NO ORDER SENT/.test(l) && /daily entry cap/.test(l));
  console.log("\n===== 4: REFUSAL REASONS =====");
  sb.__logLines.slice(-1).forEach((l) => console.log("  " + l));
  check("4: hitting the daily cap is refused with a reason", refused);
  check("4: and no order went out", sb.__orders.length === 0);
}

// ---------- 5. A stuck in-flight lock releases itself ----------
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  sb.priceDecimals = 2;
  sb.setPendingOrder(true);
  console.log("\n===== 5: IN-FLIGHT LOCK =====");
  console.log("  pendingOrder after set:", sb.pendingOrder);
  check("5: the lock engages", sb.pendingOrder === true);
  check("5: a timer is armed to release it", sb.pendingOrderTimer !== null);
  sb.setPendingOrder(false);
  check("5: and it clears normally", sb.pendingOrder === false);
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
