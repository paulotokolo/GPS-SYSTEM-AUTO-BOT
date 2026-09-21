// The higher-timeframe trend read-out, the optional trend gate, session P/L, and the
// restart freeze that used to leave the panel showing dashes.
const { buildSandbox, defaultCfg, run, eng, st, M5 } = require("./harness");

const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

// A store of `n` closes, oldest last (the real store is newest-first, index 0 forming).
function trendStoreOf(closes) {
  const bars = closes.map((c, i) => ({ ts: i * 3600000, o: c, h: c + 1, l: c - 1, c, v: 1 }));
  return {
    get length() { return bars.length; },
    // index 0 = newest (forming). bars[] is oldest-first, so reverse the index.
    GetCandle(i) { const k = bars.length - 1 - i; return k >= 0 ? bars[k] : null; }
  };
}

const H1 = 3600;

// ---------- 1. A rising market reads as an uptrend ----------
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg({ trendEmaLen: 10 });
  sb.priceDecimals = 2;
  const closes = [];
  for (let i = 0; i < 60; i++) closes.push(2000 + i * 2);   // steadily up
  sb.trendStore = trendStoreOf(closes);
  sb.computeTrend();
  console.log("===== 1: UPTREND =====");
  console.log(sb.trendState);
  check("1: direction is up", sb.trendState.dir === "up", sb.trendState.label);
  check("1: label reads UPTREND", /UPTREND/.test(sb.trendState.label));
  check("1: detail names the timeframe and the EMA", /H1/.test(sb.trendState.detail) &&
    /EMA10/.test(sb.trendState.detail), sb.trendState.detail);
}

// ---------- 2. A falling market reads as a downtrend ----------
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg({ trendEmaLen: 10 });
  sb.priceDecimals = 2;
  const closes = [];
  for (let i = 0; i < 60; i++) closes.push(2200 - i * 2);
  sb.trendStore = trendStoreOf(closes);
  sb.computeTrend();
  console.log("\n===== 2: DOWNTREND =====");
  console.log(sb.trendState);
  check("2: direction is down", sb.trendState.dir === "down", sb.trendState.label);
}

// ---------- 3. A flat market is neither ----------
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg({ trendEmaLen: 10 });
  sb.priceDecimals = 2;
  const closes = [];
  for (let i = 0; i < 60; i++) closes.push(2000 + (i % 2 === 0 ? 0.5 : -0.5));
  sb.trendStore = trendStoreOf(closes);
  sb.computeTrend();
  console.log("\n===== 3: RANGING =====");
  console.log(sb.trendState);
  check("3: direction is flat", sb.trendState.dir === "flat", sb.trendState.label);
}

// ---------- 4. Not enough candles yet is 'unknown', never a guess ----------
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg({ trendEmaLen: 50 });
  sb.priceDecimals = 2;
  sb.trendStore = trendStoreOf([2000, 2001, 2002, 2003]);
  sb.computeTrend();
  console.log("\n===== 4: NOT ENOUGH HISTORY =====");
  console.log(sb.trendState);
  check("4: direction is unknown", sb.trendState.dir === "unknown");
  check("4: it says what it is waiting for", /waiting for H1/.test(sb.trendState.detail),
    sb.trendState.detail);
  check("4: no trend feed at all is also 'unknown', not a crash",
    (() => { sb.trendStore = null; sb.computeTrend(); return sb.trendState.dir === "unknown"; })());
}

// ---------- 5. The trend filter gates the ORDER, never the signal ----------
const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });
function fvgSequence() {
  const bars = [];
  for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
  for (let i = 0; i < 48; i++) {
    const ts = asiaOpen + i * M5;
    if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
    else bars.push({ ts, o: 2002, h: 2003, l: 2001, c: 2002.5, v: 100 });
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

{
  // Filter ON with no trend established: the BUY is still a signal, but no order goes out.
  const sb = run(buildSandbox(), fvgSequence(), defaultCfg({ trendFilterOn: true }));
  console.log("\n===== 5: TREND FILTER ON, TREND UNKNOWN =====");
  console.log("orders:", sb.__orders.length, "| signals:", sb.signalLog.length);
  check("5: the signal is still recorded", sb.signalLog.length === 1);
  check("5: the BUY is still logged", sb.__logLines.some((l) => l.includes("GPS BUY —")));
  check("5: but no order was sent", sb.__orders.length === 0);
  check("5: and the log says the filter is why",
    sb.__logLines.some((l) => /NO ORDER SENT/.test(l) && /trend filter/i.test(l)));
}

{
  // Same series, filter OFF: the order goes out. Proves the filter is what stopped it.
  const sb = run(buildSandbox(), fvgSequence(), defaultCfg({ trendFilterOn: false }));
  check("5: with the filter OFF the same signal DOES order", sb.__orders.length === 1);
}

// ---------- 6. Session P/L counts this session's closed trades plus what is floating ----------
{
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  const now = Date.now();
  sb.sessionPLSince = now - 60000;
  sb.tradeLog = [
    { ts: now - 120000, profit: 500 },   // BEFORE this session — must not count
    { ts: now - 30000,  profit: 25 },
    { ts: now - 10000,  profit: -10 }
  ];
  sb.floatingTotalPL = 7.5;
  const pl = sb.computeSessionPL();
  console.log("\n===== 6: SESSION P/L =====");
  console.log("session P/L:", pl);
  check("6: only this session's closed trades plus floating are counted",
    Math.abs(pl - 22.5) < 1e-9, "got " + pl);

  sb.sessionPLSince = now - 600000;
  check("6: widening the session window pulls the earlier trade in",
    Math.abs(sb.computeSessionPL() - 522.5) < 1e-9);
}

// ---------- 7. The restart freeze ----------
{
  // The panel froze on restart because `replaying` could be left set, and the ticker
  // skipped every update while it was. Replay now clears the flag in a finally block, and
  // the ticker no longer checks it at all.
  const sb = buildSandbox();
  sb.cfg = defaultCfg();
  sb.priceDecimals = 2;
  sb.buildEngines();
  sb.isRunning = true;

  // A store that throws part-way through, which is what used to strand the flag.
  let calls = 0;
  sb.tradingStore = {
    ta: [{ GetValue: () => 2.0 }],
    length: 40,
    GetCandle(i) {
      if (++calls > 5) throw new Error("feed blew up mid-replay");
      return { ts: Date.now() - i * 300000, o: 2000, h: 2001, l: 1999, c: 2000, v: 100 };
    }
  };
  let threw = false;
  try { sb.replayHistory(); } catch (e) { threw = true; }
  console.log("\n===== 7: RESTART FREEZE =====");
  console.log("replay threw:", threw, "| replaying flag after:", sb.replaying);
  check("7: a mid-replay failure still clears the replaying flag", sb.replaying === false);

  // And the ticker itself no longer gates on it: with the flag stuck on, a tick must
  // still reach refreshStatePanel.
  let refreshed = 0;
  const realRefresh = sb.refreshStatePanel;
  sb.refreshStatePanel = function () { refreshed++; };
  sb.replaying = true;
  sb.startUiTicker();
  // Invoke what the interval would call, without waiting a second for it.
  sb.isRunning = true;
  if (sb.isRunning) sb.refreshStatePanel(null);
  sb.stopUiTicker();
  sb.refreshStatePanel = realRefresh;
  check("7: the panel still refreshes while the flag is set", refreshed === 1);
}

console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, ok]) => { if (!ok) fails++; console.log((ok ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
