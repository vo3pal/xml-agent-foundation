import type { ParseResult, Tool } from "../agent/types.js";
import { COMPLETION_TAG } from "../agent/systemPrompt.js";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openTagRe(name: string): RegExp {
  return new RegExp(`<${escapeRegExp(name)}(?:\\s[^>]*)?>`);
}

function findBlock(
  text: string,
  tag: string,
): { inner: string; start: number; raw: string } | null {
  const re = new RegExp(
    `<${escapeRegExp(tag)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(tag)}>`,
  );
  const match = re.exec(text);
  if (!match) return null;
  return {
    inner: match[1] ?? "",
    start: match.index,
    raw: match[0],
  };
}

function unwrapCdata(s: string): string {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return m ? (m[1] ?? "") : s;
}

function extractParams(
  inner: string,
  paramNames: string[],
): Record<string, string> {
  const found: { name: string; start: number; openEnd: number }[] = [];
  for (const name of paramNames) {
    const m = openTagRe(name).exec(inner);
    if (m) found.push({ name, start: m.index, openEnd: m.index + m[0].length });
  }
  found.sort((a, b) => a.start - b.start);

  const out: Record<string, string> = {};
  for (let i = 0; i < found.length; i++) {
    const cur = found[i]!;
    const segEnd = i + 1 < found.length ? found[i + 1]!.start : inner.length;
    let seg = inner.slice(cur.openEnd, segEnd);
    seg = seg.replace(new RegExp(`</${escapeRegExp(cur.name)}>\\s*$`), "");
    out[cur.name] = unwrapCdata(seg).trim();
  }
  return out;
}

function extractParam(inner: string, name: string): string | null {
  const values = extractParams(inner, [name]);
  return name in values ? (values[name] ?? "") : null;
}

function blockNames(tools: Tool[]): string[] {
  return [...tools.map((t) => t.name), COMPLETION_TAG];
}

export function repairTruncatedOutput(text: string, tools: Tool[]): string {
  let earliest: { name: string; start: number } | null = null;
  for (const name of blockNames(tools)) {
    const open = openTagRe(name).exec(text);
    const hasClose = new RegExp(`</${escapeRegExp(name)}>`).test(text);
    if (open && !hasClose) {
      if (earliest === null || open.index < earliest.start) {
        earliest = { name, start: open.index };
      }
    }
  }
  if (earliest) {
    return `${text}\n</${earliest.name}>`;
  }
  return text;
}

export function parseModelOutput(text: string, tools: Tool[]): ParseResult {
  let best:
    | { name: string; start: number; inner: string; raw: string }
    | null = null;
  for (const name of blockNames(tools)) {
    const block = findBlock(text, name);
    if (block && (best === null || block.start < best.start)) {
      best = { name, ...block };
    }
  }

  if (best) {
    const consumedUpTo = best.start + best.raw.length;

    if (best.name === COMPLETION_TAG) {
      const result = extractParam(best.inner, "result");
      return {
        kind: "final",
        text: result ?? best.inner.trim(),
        consumedUpTo,
      };
    }

    const tool = tools.find((t) => t.name === best!.name)!;
    const values = extractParams(
      best.inner,
      tool.parameters.map((p) => p.name),
    );
    const missing: string[] = [];
    const empty: string[] = [];
    for (const p of tool.parameters) {
      if (!(p.name in values)) {
        if (p.required) missing.push(p.name);
        continue;
      }
      if (p.required && values[p.name] === "") empty.push(p.name);
    }
    if (missing.length > 0 || empty.length > 0) {
      const problems = [
        missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
        empty.length > 0 ? `empty: ${empty.join(", ")}` : null,
      ]
        .filter(Boolean)
        .join("; ");
      return {
        kind: "error",
        message:
          `Tool "${tool.name}" has invalid parameters (${problems}). ` +
          `Re-emit the complete <${tool.name}> block with every required ` +
          `parameter present and non-empty.`,
      };
    }
    return {
      kind: "tool_call",
      call: { name: tool.name, params: values, raw: best.raw },
      consumedUpTo,
    };
  }

  for (const name of blockNames(tools)) {
    if (openTagRe(name).test(text)) {
      return {
        kind: "error",
        message:
          `Found an opening <${name}> tag but no matching </${name}> ` +
          `closing tag. Emit a complete, well-formed XML block.`,
      };
    }
  }

  return {
    kind: "error",
    message:
      `No tool call detected. Respond with exactly one XML tool block, or ` +
      `call <${COMPLETION_TAG}> if the task is finished.`,
  };
}
