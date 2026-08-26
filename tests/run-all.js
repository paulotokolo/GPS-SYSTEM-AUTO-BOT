// Runs every GPS engine test suite and prints a combined tally.
const { execFileSync } = require("child_process");
const suites = ["test_engine", "test_carryover", "test_conditions", "test_replay", "test_sizing", "test_pine_parity", "test_orders", "test_management"];
let pass = 0, fail = 0;
for (const s of suites) {
  const out = execFileSync(process.execPath, [__dirname + "/" + s + ".js"], { encoding: "utf8" });
  const p = (out.match(/^PASS/gm) || []).length;
  const f = (out.match(/^FAIL/gm) || []).length;
  pass += p; fail += f;
  console.log(s.padEnd(18) + String(p).padStart(3) + " pass   " + f + " fail");
  if (f) console.log(out.split("\n").filter(l => l.startsWith("FAIL")).join("\n"));
}
console.log("-".repeat(40));
console.log("TOTAL: " + pass + " pass, " + fail + " fail");
process.exit(fail ? 1 : 0);
