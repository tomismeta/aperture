import { stderr, stdin, stdout } from "node:process";

const chunks: Buffer[] = [];

stdin.on("data", (chunk: Buffer | string) => {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
});

stdin.on("end", async () => {
  const body = Buffer.concat(chunks).toString("utf8");
  const target = process.env.APERTURE_CODEX_HOOK_URL ?? "http://127.0.0.1:4547/hook";

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body,
    });

    const text = await response.text();
    if (!response.ok) {
      stderr.write(`Aperture Codex hook forward failed: ${response.status} ${response.statusText}\n`);
      if (text) {
        stderr.write(`${text}\n`);
      }
      process.exit(0);
      return;
    }

    if (text) {
      stdout.write(text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Aperture Codex hook forward failed: ${message}\n`);
    process.exit(0);
  }
});
