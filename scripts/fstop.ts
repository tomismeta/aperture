import { runFStopCli } from "../packages/lab/src/fstop-cli.js";

runFStopCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
