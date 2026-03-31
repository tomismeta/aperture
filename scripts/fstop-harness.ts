import { runFStopHarnessCli } from "../packages/lab/src/fstop-harness.js";

runFStopHarnessCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
