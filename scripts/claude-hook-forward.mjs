import { stdin, stdout, stderr, exit } from "node:process";

const chunks = [];

stdin.on("data", (chunk) => {
  chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
});

stdin.on("end", async () => {
  const body = Buffer.concat(chunks).toString("utf8");
  const target = process.env.APERTURE_CLAUDE_HOOK_URL ?? "http://127.0.0.1:4545/hook";

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
      stderr.write(`Aperture hook forward failed: ${response.status} ${response.statusText}\n`);
      if (text) {
        stderr.write(`${text}\n`);
      }
      exit(0);
      return;
    }

    if (text) {
      stdout.write(text);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`Aperture hook forward failed: ${message}\n`);
    exit(0);
  }
});
