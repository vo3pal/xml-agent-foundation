import "dotenv/config";
import { writeFileSync } from "node:fs";

const lines: string[] = [];
function log(msg: string): void {
  lines.push(msg);
}

async function timedFetch(
  label: string,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<void> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(url, { ...init, signal: ac.signal });
    const ms = Date.now() - started;
    const body = await res.text();
    log(`[${label}] HTTP ${res.status} in ${ms}ms`);
    log(`  body: ${body.slice(0, 400)}`);
  } catch (err) {
    const ms = Date.now() - started;
    const e = err as Error & { cause?: unknown };
    log(`[${label}] ERROR after ${ms}ms: ${e.name}: ${e.message}`);
    if (e.cause) {
      const c = e.cause as { code?: string; message?: string; errno?: number };
      log(`  cause: code=${c.code} errno=${c.errno} message=${c.message}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const key = process.env.OPENROUTER_API_KEY?.trim() ?? "";
  const model =
    process.env.OPENROUTER_MODEL?.trim() || "anthropic/claude-sonnet-4.6";

  log(`key present: ${key.length > 0} (length ${key.length})`);
  log(`configured model: ${model}`);
  log(`proxy env: HTTP_PROXY=${process.env.HTTP_PROXY ?? ""} HTTPS_PROXY=${process.env.HTTPS_PROXY ?? ""}`);

  await timedFetch(
    "example.com (general net)",
    "https://example.com",
    { method: "GET" },
    15_000,
  );

  await timedFetch(
    "models (no auth)",
    "https://openrouter.ai/api/v1/models",
    { method: "GET" },
    15_000,
  );

  await timedFetch(
    "chat (configured model)",
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Say pong." }],
        max_tokens: 16,
      }),
    },
    20_000,
  );

  await timedFetch(
    "chat (claude-sonnet-4.5)",
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "anthropic/claude-sonnet-4.5",
        messages: [{ role: "user", content: "Say pong." }],
        max_tokens: 16,
      }),
    },
    20_000,
  );

  const out = lines.join("\n") + "\n";
  writeFileSync("diag-result.txt", out, "utf8");
  console.log(out);
}

main();
