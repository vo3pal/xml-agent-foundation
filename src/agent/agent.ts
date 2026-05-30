import { randomUUID } from "node:crypto";
import type { OpenRouter } from "@openrouter/sdk";
import { OpenRouterError } from "@openrouter/sdk/models/errors";
import type {
  ChatMessages,
  ChatRequest,
  ChatUsage,
  ProviderPreferences,
} from "@openrouter/sdk/models";
import type {
  CacheConfig,
  Message,
  ReasoningEffort,
  Tool,
  TurnUsage,
  UsageTotals,
} from "./types.js";
import { buildSystemPrompt, COMPLETION_TAG } from "./systemPrompt.js";
import { parseModelOutput, repairTruncatedOutput } from "../xml/parser.js";

export interface AgentOptions {
  client: OpenRouter;
  model: string;
  tools: Tool[];
  maxIterations?: number;
  verbose?: boolean;
  requestTimeoutMs?: number;
  cache?: Partial<CacheConfig>;
  reasoningEffort?: ReasoningEffort;
  temperature?: number;
  maxTokens?: number;
  maxRetries?: number;
  sessionId?: string;
  provider?: ProviderPreferences;
}

export interface AgentResult {
  finalText: string;
  messages: Message[];
  iterations: number;
  completed: boolean;
  usage: UsageTotals;
  sessionId: string;
}

function formatToolResult(toolName: string, body: string): string {
  return `<tool_result tool="${toolName}">\n${body}\n</tool_result>`;
}

function isAnthropicModel(model: string): boolean {
  return /^~?anthropic\//.test(model.trim());
}

function isRetryable(err: unknown): boolean {
  if (err instanceof OpenRouterError) {
    const s = err.statusCode;
    return s === 429 || (s >= 500 && s < 600);
  }
  const name = (err as { name?: string })?.name ?? "";
  return name === "ConnectionError" || name === "RequestTimeoutError";
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

function readTurnUsage(usage: ChatUsage | null | undefined): TurnUsage {
  return {
    promptTokens: usage?.promptTokens ?? 0,
    completionTokens: usage?.completionTokens ?? 0,
    cachedTokens: usage?.promptTokensDetails?.cachedTokens ?? 0,
    cacheWriteTokens: usage?.promptTokensDetails?.cacheWriteTokens ?? 0,
    reasoningTokens: usage?.completionTokensDetails?.reasoningTokens ?? 0,
    totalTokens: usage?.totalTokens ?? 0,
    costUsd: usage?.cost ?? 0,
  };
}

export class Agent {
  private readonly client: OpenRouter;
  private readonly model: string;
  private readonly tools: Tool[];
  private readonly maxIterations: number;
  private readonly verbose: boolean;
  private readonly requestTimeoutMs: number;
  private readonly stopSequences: string[];
  private readonly cache: CacheConfig;
  private readonly reasoningEffort?: ReasoningEffort;
  private readonly temperature: number;
  private readonly maxTokens?: number;
  private readonly maxRetries: number;
  private readonly sessionId: string;
  private readonly provider?: ProviderPreferences;
  private readonly cacheApplicable: boolean;

  constructor(opts: AgentOptions) {
    this.client = opts.client;
    this.model = opts.model;
    this.tools = opts.tools;
    this.maxIterations = opts.maxIterations ?? 12;
    this.verbose = opts.verbose ?? true;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 120_000;
    this.cache = {
      enabled: opts.cache?.enabled ?? true,
      ttl: opts.cache?.ttl ?? "5m",
    };
    this.reasoningEffort = opts.reasoningEffort;
    this.temperature = opts.temperature ?? 0;
    this.maxTokens = opts.maxTokens;
    this.maxRetries = opts.maxRetries ?? 4;
    this.sessionId = opts.sessionId ?? randomUUID();
    this.provider = opts.provider;
    this.cacheApplicable = this.cache.enabled && isAnthropicModel(this.model);
    const allStops = [
      `</${COMPLETION_TAG}>`,
      ...this.tools.map((t) => `</${t.name}>`),
    ];
    if (allStops.length > 4) {
      console.warn(
        `[agent] Warning: ${allStops.length} stop sequences needed but API ` +
          `limit is 4. Some tool stops will be omitted.`,
      );
    }
    this.stopSequences = allStops.slice(0, 4);
  }

  private static emptyUsage(): UsageTotals {
    return {
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    };
  }

  async run(task: string): Promise<AgentResult> {
    const messages: Message[] = [
      { role: "system", content: buildSystemPrompt(this.tools) },
      { role: "user", content: task },
    ];
    const usage = Agent.emptyUsage();

    this.log(`\n=== TASK ===\n${task}\n`);
    this.log(
      `session=${this.sessionId} | caching=${
        this.cacheApplicable ? `on (${this.cache.ttl})` : "off"
      } | reasoning=${this.reasoningEffort ?? "off"}`,
    );

    for (let i = 1; i <= this.maxIterations; i++) {
      this.log(`\n--- Turn ${i} ---`);

      const { text: reply, usage: turn } = await this.callModel(messages);
      this.accumulate(usage, turn);
      this.logTurnUsage(turn);

      const parsed = parseModelOutput(reply, this.tools);

      const stored =
        parsed.kind === "error" ? reply : reply.slice(0, parsed.consumedUpTo);
      messages.push({ role: "assistant", content: stored.trimEnd() });

      if (parsed.kind === "final") {
        this.log(`\n=== DONE ===\n${parsed.text}\n`);
        return {
          finalText: parsed.text,
          messages,
          iterations: i,
          completed: true,
          usage,
          sessionId: this.sessionId,
        };
      }

      if (parsed.kind === "error") {
        this.log(`\n[parse error] ${parsed.message}`);
        messages.push({
          role: "user",
          content: formatToolResult("error", parsed.message),
        });
        continue;
      }

      const { name, params } = parsed.call;
      const tool = this.tools.find((t) => t.name === name);
      this.log(`\n[tool call] ${name}(${JSON.stringify(params)})`);

      let resultBody: string;
      if (!tool) {
        resultBody = `Error: unknown tool "${name}".`;
      } else {
        try {
          resultBody = await tool.execute(params);
        } catch (err) {
          resultBody = `Error: ${
            err instanceof Error ? err.message : String(err)
          }`;
        }
      }

      this.log(`[tool result] ${resultBody}`);
      messages.push({
        role: "user",
        content: formatToolResult(name, resultBody),
      });
    }

    this.log(`\n=== STOPPED: hit maxIterations (${this.maxIterations}) ===`);
    return {
      finalText: "Agent stopped after reaching the maximum iteration limit.",
      messages,
      iterations: this.maxIterations,
      completed: false,
      usage,
      sessionId: this.sessionId,
    };
  }

  private accumulate(totals: UsageTotals, turn: TurnUsage): void {
    totals.promptTokens += turn.promptTokens;
    totals.completionTokens += turn.completionTokens;
    totals.cachedTokens += turn.cachedTokens;
    totals.cacheWriteTokens += turn.cacheWriteTokens;
    totals.reasoningTokens += turn.reasoningTokens;
    totals.totalTokens += turn.totalTokens;
    totals.costUsd += turn.costUsd;
  }

  private logTurnUsage(turn: TurnUsage): void {
    if (!this.verbose || turn.totalTokens === 0) return;
    const hitRate =
      turn.promptTokens > 0
        ? ((turn.cachedTokens / turn.promptTokens) * 100).toFixed(0)
        : "0";
    const parts = [
      `prompt=${turn.promptTokens}`,
      `cached=${turn.cachedTokens} (${hitRate}%)`,
      turn.cacheWriteTokens > 0 ? `write=${turn.cacheWriteTokens}` : null,
      `completion=${turn.completionTokens}`,
      turn.reasoningTokens > 0 ? `reasoning=${turn.reasoningTokens}` : null,
      turn.costUsd > 0 ? `cost=$${turn.costUsd.toFixed(5)}` : null,
    ].filter(Boolean);
    this.log(`[usage] ${parts.join(" | ")}`);
  }

  private buildChatRequest(
    messages: Message[],
  ): ChatRequest & { stream: true } {
    const req: ChatRequest & { stream: true } = {
      model: this.model,
      messages: messages as ChatMessages[],
      stream: true,
      stop: this.stopSequences,
      temperature: this.temperature,
      sessionId: this.sessionId,
    };
    if (this.maxTokens !== undefined) req.maxTokens = this.maxTokens;
    if (this.provider) req.provider = this.provider;
    if (this.reasoningEffort) {
      req.reasoning = { effort: this.reasoningEffort };
    }
    if (this.cacheApplicable) {
      req.cacheControl = { type: "ephemeral", ttl: this.cache.ttl };
    }
    return req;
  }

  private async callModel(
    messages: Message[],
  ): Promise<{ text: string; usage: TurnUsage }> {
    let attempt = 0;
    for (;;) {
      try {
        return await this.streamOnce(messages);
      } catch (err) {
        attempt++;
        if (attempt > this.maxRetries || !isRetryable(err)) throw err;
        const delay = 1000 * 2 ** (attempt - 1) + Math.random() * 500;
        const reason =
          err instanceof OpenRouterError
            ? `HTTP ${err.statusCode}`
            : ((err as Error)?.name ?? "error");
        this.log(
          `\n[retry] ${reason}; attempt ${attempt}/${this.maxRetries} in ${Math.round(
            delay,
          )}ms`,
        );
        await sleep(delay);
      }
    }
  }

  private async streamOnce(
    messages: Message[],
  ): Promise<{ text: string; usage: TurnUsage }> {
    const stream = await this.client.chat.send(
      { chatRequest: this.buildChatRequest(messages) },
      { timeoutMs: this.requestTimeoutMs },
    );

    let full = "";
    let inReasoning = false;
    let lastUsage: ChatUsage | null | undefined;
    if (this.verbose) process.stdout.write("[assistant] ");
    for await (const chunk of stream) {
      if (chunk.error) {
        throw new Error(
          `Provider error ${chunk.error.code}: ${chunk.error.message}`,
        );
      }
      if (chunk.usage) lastUsage = chunk.usage;

      const delta = chunk.choices?.[0]?.delta;
      const reasoning = (delta as { reasoning?: string } | undefined)
        ?.reasoning;
      if (typeof reasoning === "string" && reasoning.length > 0) {
        if (this.verbose) {
          if (!inReasoning) {
            process.stdout.write("\n  \x1b[2m[thinking] ");
            inReasoning = true;
          }
          process.stdout.write(reasoning);
        }
      }

      const content = delta?.content;
      if (typeof content === "string" && content.length > 0) {
        if (inReasoning) {
          if (this.verbose) process.stdout.write("\x1b[0m\n  ");
          inReasoning = false;
        }
        full += content;
        if (this.verbose) process.stdout.write(content);
      }
    }

    if (this.verbose) process.stdout.write(inReasoning ? "\x1b[0m\n" : "\n");
    return {
      text: repairTruncatedOutput(full, this.tools),
      usage: readTurnUsage(lastUsage),
    };
  }

  private log(msg: string): void {
    if (this.verbose) console.log(msg);
  }
}
