import type { Tool } from "../agent/types.js";
import { writeFileTool } from "./writeFile.js";
import { getWeatherTool } from "./getWeather.js";

export const tools: Tool[] = [writeFileTool, getWeatherTool];

export { writeFileTool, getWeatherTool };
