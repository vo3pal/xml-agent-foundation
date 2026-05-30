import type { Tool } from "../agent/types.js";

export const getWeatherTool: Tool = {
  name: "get_weather",
  description:
    "Get the current weather for a city. Returns temperature and conditions. " +
    "(Demo stub: returns simulated data.)",
  parameters: [
    {
      name: "location",
      description: "City name, e.g. San Francisco",
      required: true,
    },
  ],
  example:
    "<get_weather>\n  <location>San Francisco</location>\n</get_weather>",
  execute: (params) => {
    const location = params.location?.trim();
    if (!location) throw new Error("Missing required parameter: location");

    const seed = [...location.toLowerCase()].reduce(
      (acc, ch) => acc + ch.charCodeAt(0),
      0,
    );
    const conditions = ["sunny", "cloudy", "rainy", "windy", "partly cloudy"];
    const temperatureC = 8 + (seed % 22);
    const condition = conditions[seed % conditions.length];

    return JSON.stringify({
      location,
      temperature_c: temperatureC,
      temperature_f: Math.round((temperatureC * 9) / 5 + 32),
      condition,
      source: "simulated",
    });
  },
};
