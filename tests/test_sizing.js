// Risk-% sizing must use the real GPS stop distance and the lot-denominated instrument fields.
const { buildSandbox, defaultCfg } = require("./harness");
const sb = buildSandbox();
const results = [];
const check = (n, ok, extra) => results.push([n + (extra ? "  (" + extra + ")" : ""), ok]);

// equity 10000, tickSize 0.01, tickValue 1 => $100 loss per 1.0 lot per 1.00 of price.
// Entry 2004.00, SL 2001.80 => 2.20 price => $220 per lot.
// 1% of 10000 = $100 risk => 100/220 = 0.4545 lots => floor to 0.01 step => 0.45
sb.cfg = defaultCfg({ sizingMode: "risk", riskPct: 1 });
const lots = sb.computeLotSize(2004.0, 2001.8);
check("risk sizing uses the real SL distance", Math.abs(lots - 0.45) < 1e-9, "lots=" + lots);

// hard max lot caps the result
sb.cfg = defaultCfg({ sizingMode: "risk", riskPct: 50, hardMaxLot: 1.5 });
const capped = sb.computeLotSize(2004.0, 2001.8);
check("hardMaxLot caps the size", Math.abs(capped - 1.5) < 1e-9, "lots=" + capped);

// fixed mode ignores risk entirely
sb.cfg = defaultCfg({ sizingMode: "fixed", fixedLots: 0.1 });
check("fixed mode returns fixed lots", sb.computeLotSize(2004.0, 2001.8) === 0.1);

// inverted/zero stop must never produce a bogus size
sb.cfg = defaultCfg({ sizingMode: "risk" });
const bad = sb.computeLotSize(2004.0, 2004.0);
check("zero stop distance falls back to fixed lots", bad === 0.1, "lots=" + bad);

// no float dust in the returned lot size
sb.cfg = defaultCfg({ sizingMode: "risk", riskPct: 1 });
const dust = sb.computeLotSize(2004.0, 2001.77);
check("no binary-float dust in lot size", String(dust).length <= 6, "lots=" + dust);

console.log("===== ASSERTIONS =====");
let f = 0;
results.forEach(([n, o]) => { if (!o) f++; console.log((o ? "PASS  " : "FAIL  ") + n); });
console.log(f === 0 ? "\nALL PASS" : "\n" + f + " FAILURE(S)");
