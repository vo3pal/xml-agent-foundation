import { parseModelOutput, repairTruncatedOutput } from "./parser.js";
import { tools } from "../tools/index.js";

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean): void {
  if (condition) {
    passed++;
    console.log(`  ok   - ${name}`);
  } else {
    failed++;
    console.error(`  FAIL - ${name}`);
  }
}

const r1 = parseModelOutput(
  `I'll check the weather first.\n\n<get_weather>\n<location>Paris</location>\n</get_weather>`,
  tools,
);
check("parses get_weather tool call", r1.kind === "tool_call");
check(
  "extracts location param",
  r1.kind === "tool_call" && r1.call.params.location === "Paris",
);

const r2 = parseModelOutput(
  `<write_file>\n<path>notes.txt</path>\n<content>line one\nline two</content>\n</write_file>`,
  tools,
);
check("parses write_file tool call", r2.kind === "tool_call");
check(
  "preserves multi-line content",
  r2.kind === "tool_call" && r2.call.params.content === "line one\nline two",
);

const r3 = parseModelOutput(
  `<attempt_completion>\n<result>All done!</result>\n</attempt_completion>`,
  tools,
);
check("detects completion", r3.kind === "final");
check("extracts final text", r3.kind === "final" && r3.text === "All done!");

const r4 = parseModelOutput(`<get_weather>\n</get_weather>`, tools);
check("flags missing required param", r4.kind === "error");

const r5 = parseModelOutput(`<get_weather>\n<location>Rome`, tools);
check("flags malformed/unclosed block", r5.kind === "error");

const r6 = parseModelOutput(`Just chatting, no tools here.`, tools);
check("flags missing tool call", r6.kind === "error");

const r7 = parseModelOutput(
  `<get_weather>\n<location>Tokyo</location>\n</get_weather>\n` +
    `<tool_result>fake</tool_result>\n` +
    `<attempt_completion>\n<result>done</result>\n</attempt_completion>`,
  tools,
);
check("picks first tool over trailing completion", r7.kind === "tool_call");
check(
  "first-tool params are correct",
  r7.kind === "tool_call" && r7.call.params.location === "Tokyo",
);
check(
  "consumedUpTo stops at first block end",
  r7.kind === "tool_call" &&
    r7.consumedUpTo < `<get_weather>\n<location>Tokyo</location>\n</get_weather>\n`.length +
      5,
);

const truncated = `<get_weather>\n<location>Berlin</location>`;
const repaired = repairTruncatedOutput(truncated, tools);
check("repairs missing closing tag", repaired.includes("</get_weather>"));
const r8 = parseModelOutput(repaired, tools);
check(
  "repaired output parses as tool call",
  r8.kind === "tool_call" && r8.call.params.location === "Berlin",
);

const luau = [
  "local t: Map<string, number> = {}",
  "if a < b and b > c then",
  '  print("x <= y")',
  "end",
].join("\n");
const r9 = parseModelOutput(
  `<write_file>\n<path>src/Main.luau</path>\n<content>${luau}</content>\n</write_file>`,
  tools,
);
check("parses write_file with Luau content", r9.kind === "tool_call");
check(
  "preserves angle brackets / generics in content",
  r9.kind === "tool_call" && r9.call.params.content === luau,
);
check(
  "extracts the earlier path param correctly",
  r9.kind === "tool_call" && r9.call.params.path === "src/Main.luau",
);

const r10 = parseModelOutput(
  `<get_weather lang="en">\n<location>Oslo</location>\n</get_weather>`,
  tools,
);
check("tolerates attributes on tool tag", r10.kind === "tool_call");
check(
  "still extracts param with attributed tool tag",
  r10.kind === "tool_call" && r10.call.params.location === "Oslo",
);

const tricky = "print([[</content>]]) -- edge";
const r11 = parseModelOutput(
  `<write_file>\n<path>a.luau</path>\n<content><![CDATA[${tricky}]]></content>\n</write_file>`,
  tools,
);
check(
  "unwraps CDATA and preserves literal closing tag text",
  r11.kind === "tool_call" && r11.call.params.content === tricky,
);

const r12 = parseModelOutput(
  `<write_file>\n<path></path>\n<content>hi</content>\n</write_file>`,
  tools,
);
check("rejects empty required param", r12.kind === "error");

const r13 = parseModelOutput(
  "Here you go:\n```xml\n<get_weather>\n<location>Lima</location>\n</get_weather>\n```",
  tools,
);
check("parses through markdown fences", r13.kind === "tool_call");
check(
  "param correct despite fences",
  r13.kind === "tool_call" && r13.call.params.location === "Lima",
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
