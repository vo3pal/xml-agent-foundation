import type { Tool } from "./types.js";

export const COMPLETION_TAG = "attempt_completion";

function renderToolSchema(tool: Tool): string {
  const params = tool.parameters
    .map((p) => {
      const flag = p.required ? "required" : "optional";
      return `  <${p.name}>${p.description} (${flag})</${p.name}>`;
    })
    .join("\n");

  const usage =
    `<${tool.name}>\n` +
    tool.parameters.map((p) => `  <${p.name}>...</${p.name}>`).join("\n") +
    `\n</${tool.name}>`;

  const example = tool.example ? `\nExample:\n${tool.example}` : "";

  return [
    `### ${tool.name}`,
    tool.description,
    "",
    "Parameters:",
    params || "  (none)",
    "",
    "Usage:",
    usage,
    example,
  ].join("\n");
}

export function buildSystemPrompt(tools: Tool[]): string {
  const toolDocs = tools.map(renderToolSchema).join("\n\n");

  return `You are an autonomous agent. You accomplish tasks by calling tools.

You do NOT use native/JSON function calling. Instead you invoke tools by writing
XML blocks directly in your response. The runtime parses these blocks, runs the
tool, and sends the result back to you on the next turn. You then continue until
the task is complete.

# Tool-Calling Protocol

1. Optionally think step by step in plain text first. Keep it brief.
2. Then emit EXACTLY ONE tool call as the LAST thing in your message.
3. A tool call is an XML block named after the tool. Each parameter is a nested
   XML tag whose tag name is the parameter name:

   <tool_name>
   <parameter_name>value goes here</parameter_name>
   </tool_name>

4. After you write the closing </tool_name> tag, STOP immediately. Write nothing
   after it. The runtime halts your generation there and replies with a
   <tool_result> block, which you use to decide your next step.

When the entire task is finished, call the completion tool to deliver your final
answer to the user:

<${COMPLETION_TAG}>
  <result>Your final summary to the user.</result>
</${COMPLETION_TAG}>

# Format Contract (parsing is strict — follow exactly)

- Output the tool block as raw text. Do NOT wrap it in markdown code fences
  (no \`\`\`xml). Do NOT add XML attributes — use bare tags like <path>, not
  <path type="...">.
- Use the EXACT tool name and the EXACT parameter names shown below. Unknown or
  misspelled tags will fail to parse.
- Every REQUIRED parameter must be present and non-empty. Never use placeholders
  like "..." or "TODO".
- Parameter values are taken literally (whitespace and newlines preserved). For
  code or text, paste it verbatim inside the tag — do NOT HTML-escape characters
  like <, >, or &.
- ESCAPE HATCH: if a value must contain the literal text of its own closing tag
  (e.g. the characters </content> inside file content), wrap the whole value in
  a CDATA section so it parses cleanly:
    <content><![CDATA[ ...raw content including </content> ... ]]></content>

# Available Tools

${toolDocs}

### ${COMPLETION_TAG}
Signals the task is complete and returns a final message to the user. Call this
only when there is no further tool work to do.

Parameters:
  <result>The final answer / summary for the user. (required)</result>

Usage:
<${COMPLETION_TAG}>
  <result>...</result>
</${COMPLETION_TAG}>

# Rules
- EXACTLY one tool call per message, and it must be the last thing you write.
- Never emit two tool calls in one message. Do one step, wait for the result,
  then do the next.
- NEVER write a <tool_result> block yourself and NEVER invent or assume tool
  output. Only the runtime produces <tool_result>. If you imagine a result, the
  task will fail.
- If a tool returns an error, read it carefully and correct your next call.
- Do not repeat a tool call that already succeeded; use its result and move on.
- Keep going autonomously, one tool per turn, until you call ${COMPLETION_TAG}.`;
}
