import { client, config } from "./config.js";
import { Agent } from "./agent/agent.js";
import { tools } from "./tools/index.js";

async function main(): Promise<void> {
  const task =
    process.argv.slice(2).join(" ").trim() ||
    "Find out the current weather in San Francisco, then write a short report " +
      "to 'weather-report.txt' summarizing it. When done, tell me what you did.";

  const agent = new Agent({
    client,
    model: config.model,
    tools,
    maxIterations: 12,
    verbose: true,
    cache: { enabled: config.cacheEnabled, ttl: config.cacheTtl },
    reasoningEffort: config.reasoningEffort,
    temperature: config.temperature,
  });

  console.log(`Model: ${config.model}`);
  const result = await agent.run(task);

  const u = result.usage;
  const hitRate =
    u.promptTokens > 0
      ? ((u.cachedTokens / u.promptTokens) * 100).toFixed(1)
      : "0.0";

  console.log("\n========================================");
  console.log(`Completed:  ${result.completed}`);
  console.log(`Iterations: ${result.iterations}`);
  console.log(`Session:    ${result.sessionId}`);
  console.log(
    `Tokens:     prompt=${u.promptTokens} (cached ${u.cachedTokens}, ` +
      `${hitRate}% hit) completion=${u.completionTokens}` +
      (u.reasoningTokens > 0 ? ` reasoning=${u.reasoningTokens}` : ""),
  );
  if (u.costUsd > 0) console.log(`Cost:       $${u.costUsd.toFixed(5)}`);
  console.log("\nFinal answer:\n" + result.finalText);
}

main().catch((err) => {
  console.error("\nAgent failed:");
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
