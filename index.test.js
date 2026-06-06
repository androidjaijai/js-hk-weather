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

test("includes temperature", () => {
  const report = formatWeather(baseData);
  assert.ok(report.includes("28°C"));
});

test("includes humidity", () => {
  const report = formatWeather(baseData);
  assert.ok(report.includes("82%"));
});

test("includes rainfall", () => {
  const report = formatWeather(baseData);
  assert.ok(report.includes("5 mm"));
});

test("includes UV index", () => {
  const report = formatWeather(baseData);
  assert.ok(report.includes("7 (High)"));
});

test("includes general situation", () => {
  const report = formatWeather(baseData);
  assert.ok(report.includes("A trough of low pressure."));
});

test("includes outlook", () => {
  const report = formatWeather(baseData);
  assert.ok(report.includes("Becoming sunny tomorrow."));
});

test("shows no warnings when none active", () => {
  const report = formatWeather(baseData);
  assert.ok(report.includes("No active weather warnings"));
});

test("shows active warnings", () => {
  const data = {
    ...baseData,
    warning: {
      TC: { actionCode: "ISSUE", name: "Typhoon Signal No. 3" },
    },
  };
  const report = formatWeather(data);
  assert.ok(report.includes("Typhoon Signal No. 3"));
});

test("handles missing optional fields gracefully", () => {
  const data = {
    current: {},
    forecast: { generalSituation: "Fine." },
    warning: {},
  };
  assert.doesNotThrow(() => formatWeather(data));
});
