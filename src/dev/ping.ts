import { client, config } from "../config.js";

async function main(): Promise<void> {
  console.log(`Model: ${config.model}`);
  console.log("Sending a tiny non-streaming request (30s timeout)...");

  const started = Date.now();
  try {
    const res = await client.chat.send(
      {
        chatRequest: {
          model: config.model,
          messages: [{ role: "user", content: "Reply with the single word: pong" }],
          maxTokens: 16,
        },
      },
      { timeoutMs: 30_000 },
    );
    const ms = Date.now() - started;
    console.log(`OK in ${ms}ms`);
    console.log("Reply:", res.choices?.[0]?.message?.content);
    console.log("Usage:", JSON.stringify(res.usage));
  } catch (err) {
    const ms = Date.now() - started;
    console.error(`FAILED after ${ms}ms`);
    console.error(err);
  }
}

main();
