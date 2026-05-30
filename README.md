# XML Agent Foundation

Transport-agnostic autonomous agent loop built on [`@openrouter/sdk`](https://openrouter.ai/docs/client-sdks/overview). Uses **client-side XML tool calling** instead of native/JSON function calling — the model emits raw XML blocks that the runtime parses and dispatches.

## Architecture

### Tool-calling protocol

The system prompt (`src/agent/systemPrompt.ts`) teaches the model a strict XML format. Each turn the model emits exactly **one** tool block as the last thing in its message:

```xml
<tool_name>
  <param_name>value</param_name>
</tool_name>
```

One tool per turn is enforced by OpenRouter **stop sequences** — the loop registers each tool's closing tag (e.g. `</write_file>`) and `</attempt_completion>` as stop tokens, so the model physically cannot over-generate into a second tool call.

### Parser (`src/xml/parser.ts`)

- **Positional segment extraction** — parameters are extracted by locating each known tag's opening position, slicing between consecutive tags, and stripping the trailing close tag. This preserves freeform content (Luau code, `<`/`>` operators, generics like `Map<K,V>`) verbatim without fragile per-param regexes.
- **CDATA escape hatch** — values can be wrapped in `<![CDATA[...]]>` to safely embed literal closing tags.
- **Attribute tolerance** — opening tags with attributes (e.g. `<tool lang="en">`) are matched correctly.
- **Truncation repair** (`repairTruncatedOutput`) — stop sequences omit the matched closing tag; the function detects the earliest unclosed block and re-appends the tag before parsing.
- **First-block-wins** — if the model over-generates (fabricates `<tool_result>` or a second tool), only the earliest recognized block is acted on.

### Agent loop (`src/agent/agent.ts`)

Each iteration:
1. Build the chat request with stop sequences, session id, and optional cache/reasoning config.
2. Stream the response, printing tokens live (reasoning tokens shown dimmed).
3. Parse the output — dispatch tool call, feed parse error back for self-correction, or return final answer.
4. Store only the consumed portion (up to `consumedUpTo`) in history to exclude any over-generated content.

Transient errors (HTTP 429, 5xx, connection/timeout) are retried with exponential backoff + jitter up to `maxRetries` (default 4). Retries only fire before any content token is emitted so streamed output is never duplicated.

### Prompt caching

- `sessionId` sticky routing is always active — every turn in a run routes to the same provider instance so cache written on turn 1 is readable on turn 2+.
- `cache_control: { type: "ephemeral" }` automatic breakpoint mode is attached for `anthropic/*` models only. OpenRouter advances the breakpoint to cover the entire growing prefix each turn (system prompt first, dynamic history last).
- Non-Anthropic providers (Gemini, OpenAI, DeepSeek) use implicit KV caching activated by the same static-prefix-first ordering + sticky routing.

## Setup

```bash
npm install
cp .env.example .env   # fill in OPENROUTER_API_KEY
```

Get a key at https://openrouter.ai/keys.

## Run

```bash
npm run dev                                   # default demo task
npm run dev -- "Write a Luau module to out.luau"  # custom task
```

Files written by the agent land in `./workspace` (sandboxed — path traversal blocked).

## Scripts

```bash
npm run typecheck    # tsc --noEmit
npm run test:parser  # 23 offline parser smoke tests (no API key)
npm run ping         # single non-streaming request to verify auth
npm run diag         # raw fetch diagnostics -> diag-result.txt
```

## Adding a tool

1. Create `src/tools/myTool.ts` exporting a `Tool` (see `src/agent/types.ts`).
2. Register it in `src/tools/index.ts`.

The system prompt and parser pick it up automatically — no other changes needed.

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OPENROUTER_API_KEY` | *(required)* | OpenRouter API key |
| `OPENROUTER_MODEL` | `anthropic/claude-sonnet-4.6` | Model slug |
| `OPENROUTER_CACHE` | `true` | Enable `cache_control` (Anthropic only) |
| `OPENROUTER_CACHE_TTL` | `5m` | Cache TTL: `5m` or `1h` |
| `OPENROUTER_REASONING_EFFORT` | *(unset)* | `minimal`\|`low`\|`medium`\|`high`\|`xhigh` |
| `OPENROUTER_TEMPERATURE` | `0` | Sampling temperature |

## Project layout

```
src/
  index.ts            demo entry point
  config.ts           env parsing + OpenRouter client
  agent/
    agent.ts          autonomous loop + streaming + retry
    systemPrompt.ts   XML protocol prompt + tool schema renderer
    types.ts          shared interfaces (Tool, ParseResult, etc.)
  xml/
    parser.ts         XML parser (positional, CDATA, repair)
    parser.smoke.ts   23 offline smoke tests
  tools/
    index.ts          tool registry
    writeFile.ts      write_file — sandboxed to ./workspace
    getWeather.ts     get_weather — stub for demo loop
  dev/
    ping.ts           connectivity/auth check
    diag.ts           raw fetch diagnostics
```

## TLS note

If outbound HTTPS fails with `UNABLE_TO_VERIFY_LEAF_SIGNATURE` (corporate proxy / AV doing TLS inspection), all npm scripts already pass `NODE_OPTIONS=--use-system-ca` via `cross-env` so Node trusts the OS certificate store. Run `npm run diag` to isolate connectivity issues.
