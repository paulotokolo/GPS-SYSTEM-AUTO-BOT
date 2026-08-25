// Replay must rebuild sig state from history WITHOUT ever sending an order.
const { buildSandbox, defaultCfg, M5 } = require("./harness");

const asiaOpen = Date.UTC(2025, 0, 16, 1, 0, 0);
const flat = (ts, p) => ({ ts, o: p, h: p + 0.5, l: p - 0.5, c: p, v: 100 });
const bars = [];
for (let i = 30; i > 0; i--) bars.push(flat(asiaOpen - i * M5, 2004));
for (let i = 0; i < 48; i++) {
  const ts = asiaOpen + i * M5;
  if (i === 40) bars.push({ ts, o: 2001, h: 2001.5, l: 2000.0, c: 2000.5, v: 100 });
  else if (i === 44) bars.push({ ts, o: 2004, h: 2008.0, l: 2003.5, c: 2007.5, v: 100 });
  else bars.push(flat(ts, 2002));
}
const t0 = asiaOpen + 48 * M5;
bars.push({ ts: t0 + 0 * M5, o: 2001, h: 2002.0, l: 1999.0, c: 2000.0, v: 100 });
bars.push({ ts: t0 + 1 * M5, o: 2000, h: 2003.0, l: 1999.5, c: 2002.0, v: 100 });
bars.push({ ts: t0 + 2 * M5, o: 2002, h: 2006.0, l: 2001.8, c: 2005.5, v: 100 });
bars.push({ ts: t0 + 3 * M5, o: 2005, h: 2006.5, l: 2003.5, c: 2006.0, v: 100 });
bars.push({ ts: t0 + 4 * M5, o: 2004, h: 2005.0, l: 2003.0, c: 2003.2, v: 100 });
bars.push({ ts: t0 + 5 * M5, o: 2003, h: 2004.2, l: 2002.9, c: 2004.0, v: 100 }); // BUY bar
bars.push(flat(t0 + 6 * M5, 2004));

const sb = buildSandbox();
const store = {
  ta: [{ GetValue: () => 2.0 }],
  visible: bars.length,
  get length() { return this.visible; },
  GetCandle(i) { const k = this.visible - 1 - i; return k >= 0 && k < bars.length ? bars[k] : null; }
};
sb.cfg = defaultCfg({ verboseReplay: false });
sb.tradingStore = store;
sb.sig = sb.newSig();
sb.activeSession = null; sb.barIndex = 0; sb.lastProcessedTs = null;
sb.isRunning = true; sb.priceDecimals = 2;
sb.entriesDayKey = sb.nyParts(Date.now()).dayKey;

const ok = sb.replayHistory();

const results = [
  ["replayHistory returned true", ok === true],
  ["replaying flag reset to false", sb.replaying === false],
  ["state rebuilt: ref locked", sb.sig.ref_name === "ASIA"],
  ["state rebuilt: FVG found", sb.sig.fvg_found === true],
  ["state rebuilt: BUY marked fired", sb.sig.fired === true],
  ["SL rebuilt as fvg_swing_low", Math.abs(sb.sig.fvg_swing_low - 2001.8) < 1e-9],
  ["NO orders sent during replay", sb.__orders.length === 0],
  ["historical signal is flagged as history",
    sb.__logLines.some((l) => l.includes("BUY SIGNAL")) ],
  ["lastProcessedTs is the newest closed bar",
    sb.lastProcessedTs === bars[bars.length - 2].ts]
];
console.log("===== REPLAY =====");
sb.__logLines.filter((l) => /SESSION|SWEEP|FVG|BUY|replay/i.test(l)).forEach((l) => console.log(l));
console.log("\n===== ASSERTIONS =====");
let fails = 0;
results.forEach(([n, o]) => { if (!o) fails++; console.log((o ? "PASS  " : "FAIL  ") + n); });
console.log(fails === 0 ? "\nALL PASS" : "\n" + fails + " FAILURE(S)");
