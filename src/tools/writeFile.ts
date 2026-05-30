import { promises as fs } from "node:fs";
import path from "node:path";
import type { Tool } from "../agent/types.js";

const WORKSPACE_ROOT = path.resolve(process.cwd(), "workspace");

function resolveSafe(relPath: string): string {
  const target = path.resolve(WORKSPACE_ROOT, relPath);
  const rel = path.relative(WORKSPACE_ROOT, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Path "${relPath}" escapes the workspace sandbox. Use a relative path ` +
        `inside ./workspace.`,
    );
  }
  return target;
}

export const writeFileTool: Tool = {
  name: "write_file",
  description:
    "Write text content to a file (creates parent directories as needed). " +
    "Paths are relative to the ./workspace sandbox.",
  parameters: [
    {
      name: "path",
      description: "Relative file path, e.g. notes/todo.txt",
      required: true,
    },
    {
      name: "content",
      description: "The full text content to write to the file",
      required: true,
    },
  ],
  example:
    "<write_file>\n" +
    "  <path>hello.txt</path>\n" +
    "  <content>Hello, world!\nThis is line two.</content>\n" +
    "</write_file>",
  execute: async (params) => {
    const relPath = params.path;
    const content = params.content ?? "";
    if (!relPath) throw new Error("Missing required parameter: path");

    const target = resolveSafe(relPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");

    const bytes = Buffer.byteLength(content, "utf8");
    return `Wrote ${bytes} byte(s) to ${path
      .relative(process.cwd(), target)
      .replace(/\\/g, "/")}.`;
  },
};
