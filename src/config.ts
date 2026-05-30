import "dotenv/config";
import { OpenRouter } from "@openrouter/sdk";
import type { CacheTtl, ReasoningEffort } from "./agent/types.js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. ` +
        `Copy .env.example to .env and fill it in.`,
    );
  }
  return value.trim();
}

function envBool(name: string, fallback: boolean): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === undefined || v === "") return fallback;
  return v === "1" || v === "true" || v === "yes";
}

const REASONING_EFFORTS = new Set<ReasoningEffort>([
  "xhigh",
  "high",
  "medium",
  "low",
  "minimal",
  "none",
]);

function parseReasoningEffort(): ReasoningEffort | undefined {
  const v = process.env.OPENROUTER_REASONING_EFFORT?.trim().toLowerCase();
  if (!v) return undefined;
  return REASONING_EFFORTS.has(v as ReasoningEffort)
    ? (v as ReasoningEffort)
    : undefined;
}

export const config = {
  apiKey: requireEnv("OPENROUTER_API_KEY"),
  model: process.env.OPENROUTER_MODEL?.trim() || "anthropic/claude-sonnet-4.6",
  siteUrl: process.env.OPENROUTER_SITE_URL?.trim() || "http://localhost",
  appTitle: process.env.OPENROUTER_APP_TITLE?.trim() || "XML Agent",
  cacheEnabled: envBool("OPENROUTER_CACHE", true),
  cacheTtl: (process.env.OPENROUTER_CACHE_TTL?.trim() === "1h"
    ? "1h"
    : "5m") as CacheTtl,
  reasoningEffort: parseReasoningEffort(),
  temperature: Number.isFinite(Number(process.env.OPENROUTER_TEMPERATURE))
    ? Number(process.env.OPENROUTER_TEMPERATURE)
    : 0,
} as const;

export const client = new OpenRouter({
  apiKey: config.apiKey,
  httpReferer: config.siteUrl,
  appTitle: config.appTitle,
});
