import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectExecution(
  moduleUrl: string,
  argvEntry = process.argv[1],
  cwd = process.cwd(),
): boolean {
  return argvEntry !== undefined && resolve(cwd, argvEntry) === fileURLToPath(moduleUrl);
}
