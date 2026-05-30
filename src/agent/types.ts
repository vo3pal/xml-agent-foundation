export interface ToolParameter {
  name: string;
  description: string;
  required: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  example?: string;
  execute: (params: Record<string, string>) => Promise<string> | string;
}

export type Role = "system" | "user" | "assistant";

export interface Message {
  role: Role;
  content: string;
}

export interface ParsedToolCall {
  name: string;
  params: Record<string, string>;
  raw: string;
}

export type ParseResult =
  | { kind: "tool_call"; call: ParsedToolCall; consumedUpTo: number }
  | { kind: "final"; text: string; consumedUpTo: number }
  | { kind: "error"; message: string };

export type ReasoningEffort =
  | "xhigh"
  | "high"
  | "medium"
  | "low"
  | "minimal"
  | "none";

export type CacheTtl = "5m" | "1h";

export interface CacheConfig {
  enabled: boolean;
  ttl: CacheTtl;
}

export interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface TurnUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  costUsd: number;
}
