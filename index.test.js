import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWeather } from "./index.js";

const baseData = {
  current: {
    temperature: { data: [{ place: "Hong Kong Observatory", value: 28, unit: "C" }] },
    humidity: { data: [{ value: 82 }] },
    rainfall: { data: [{ place: "Hong Kong Observatory", max: 5 }] },
    uvindex: { data: [{ value: 7, desc: "High" }] },
  },
  forecast: {
    generalSituation: "A trough of low pressure.",
    forecastDesc: "Cloudy with a few showers.",
    outlook: "Becoming sunny tomorrow.",
  },
  warning: {},
};

// Strip ANSI escape codes for plain-text assertions
function strip(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

test("includes temperature", () => {
  assert.ok(strip(formatWeather(baseData)).includes("28°C"));
});

test("includes humidity", () => {
  assert.ok(strip(formatWeather(baseData)).includes("82%"));
});

test("includes rainfall", () => {
  assert.ok(strip(formatWeather(baseData)).includes("5 mm"));
});

test("includes UV index", () => {
  assert.ok(strip(formatWeather(baseData)).includes("7"));
});

test("includes general situation", () => {
  assert.ok(strip(formatWeather(baseData)).includes("A trough of low pressure."));
});

test("includes outlook", () => {
  assert.ok(strip(formatWeather(baseData)).includes("Becoming sunny tomorrow."));
});

test("shows no warnings when none active", () => {
  assert.ok(strip(formatWeather(baseData)).includes("No active weather warnings"));
});

test("shows active warnings", () => {
  const data = {
    ...baseData,
    warning: { TC: { actionCode: "ISSUE", name: "Typhoon Signal No. 3" } },
  };
  assert.ok(strip(formatWeather(data)).includes("Typhoon Signal No. 3"));
});

test("handles missing optional fields gracefully", () => {
  const data = { current: {}, forecast: { generalSituation: "Fine." }, warning: {} };
  assert.doesNotThrow(() => formatWeather(data));
});
