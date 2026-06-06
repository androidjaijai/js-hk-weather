import { test } from "node:test";
import assert from "node:assert/strict";
import { formatWeather } from "./index.js";

// Strip ANSI escape codes for plain-text assertions
function strip(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

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

// ── Temperature ──────────────────────────────────────────────

test("shows temperature value and unit", () => {
  assert.ok(strip(formatWeather(baseData)).includes("28°C"));
});

test("shows temperature in Fahrenheit when unit is F", () => {
  const data = {
    ...baseData,
    current: {
      ...baseData.current,
      temperature: { data: [{ place: "Hong Kong Observatory", value: 82, unit: "F" }] },
    },
  };
  assert.ok(strip(formatWeather(data)).includes("82°F"));
});

test("ignores temperature from non-HKO stations", () => {
  const data = {
    ...baseData,
    current: {
      ...baseData.current,
      temperature: {
        data: [
          { place: "Sha Tin", value: 99, unit: "C" },
          { place: "Hong Kong Observatory", value: 28, unit: "C" },
        ],
      },
    },
  };
  const report = strip(formatWeather(data));
  assert.ok(report.includes("28°C"));
  assert.ok(!report.includes("99°C"));
});

test("omits temperature row when no HKO station found", () => {
  const data = {
    ...baseData,
    current: {
      ...baseData.current,
      temperature: { data: [{ place: "Sha Tin", value: 30, unit: "C" }] },
    },
  };
  assert.ok(!strip(formatWeather(data)).includes("Temperature"));
});

test("omits temperature row when temperature data is absent", () => {
  const data = { ...baseData, current: { ...baseData.current, temperature: undefined } };
  assert.ok(!strip(formatWeather(data)).includes("Temperature"));
});

// ── Humidity ─────────────────────────────────────────────────

test("shows humidity percentage", () => {
  assert.ok(strip(formatWeather(baseData)).includes("82%"));
});

test("omits humidity row when data is absent", () => {
  const data = { ...baseData, current: { ...baseData.current, humidity: undefined } };
  assert.ok(!strip(formatWeather(data)).includes("Humidity"));
});

// ── Rainfall ─────────────────────────────────────────────────

test("shows rainfall using max field", () => {
  assert.ok(strip(formatWeather(baseData)).includes("5 mm"));
});

test("falls back to value field when max is absent", () => {
  const data = {
    ...baseData,
    current: {
      ...baseData.current,
      rainfall: { data: [{ place: "Hong Kong Observatory", value: 3 }] },
    },
  };
  assert.ok(strip(formatWeather(data)).includes("3 mm"));
});

test("omits rainfall row when no HKO station found", () => {
  const data = {
    ...baseData,
    current: {
      ...baseData.current,
      rainfall: { data: [{ place: "Tsuen Wan", max: 10 }] },
    },
  };
  assert.ok(!strip(formatWeather(data)).includes("Rainfall"));
});

test("omits rainfall row when data is absent", () => {
  const data = { ...baseData, current: { ...baseData.current, rainfall: undefined } };
  assert.ok(!strip(formatWeather(data)).includes("Rainfall"));
});

// ── UV Index ─────────────────────────────────────────────────

test("shows UV index value and description", () => {
  const report = strip(formatWeather(baseData));
  assert.ok(report.includes("7"));
  assert.ok(report.includes("High"));
});

test("omits UV index row when data is absent", () => {
  const data = { ...baseData, current: { ...baseData.current, uvindex: undefined } };
  assert.ok(!strip(formatWeather(data)).includes("UV Index"));
});

// ── Forecast ─────────────────────────────────────────────────

test("shows general situation", () => {
  assert.ok(strip(formatWeather(baseData)).includes("A trough of low pressure."));
});

test("shows forecast description", () => {
  assert.ok(strip(formatWeather(baseData)).includes("Cloudy with a few showers."));
});

test("shows outlook", () => {
  assert.ok(strip(formatWeather(baseData)).includes("Becoming sunny tomorrow."));
});

test("shows N/A when general situation is missing", () => {
  const data = { ...baseData, forecast: {} };
  assert.ok(strip(formatWeather(data)).includes("N/A"));
});

test("omits forecast description when absent", () => {
  const data = { ...baseData, forecast: { generalSituation: "Fine." } };
  assert.ok(!strip(formatWeather(data)).includes("🔮"));
});

test("omits outlook when absent", () => {
  const data = { ...baseData, forecast: { generalSituation: "Fine." } };
  assert.ok(!strip(formatWeather(data)).includes("Outlook"));
});

// ── Warnings ─────────────────────────────────────────────────

test("shows no warnings message when warning object is empty", () => {
  assert.ok(strip(formatWeather(baseData)).includes("No active weather warnings"));
});

test("shows warning with ISSUE actionCode", () => {
  const data = {
    ...baseData,
    warning: { TC: { actionCode: "ISSUE", name: "Typhoon Signal No. 3" } },
  };
  assert.ok(strip(formatWeather(data)).includes("Typhoon Signal No. 3"));
});

test("shows warning with UPDATE actionCode", () => {
  const data = {
    ...baseData,
    warning: { WTMW: { actionCode: "UPDATE", name: "Tsunami Warning" } },
  };
  assert.ok(strip(formatWeather(data)).includes("Tsunami Warning"));
});

test("does not show warning with CANCEL actionCode", () => {
  const data = {
    ...baseData,
    warning: { TC: { actionCode: "CANCEL", name: "Typhoon Signal No. 3" } },
  };
  const report = strip(formatWeather(data));
  assert.ok(!report.includes("Typhoon Signal No. 3"));
  assert.ok(report.includes("No active weather warnings"));
});

test("shows multiple active warnings separated by comma", () => {
  const data = {
    ...baseData,
    warning: {
      TC:   { actionCode: "ISSUE",  name: "Typhoon Signal No. 8" },
      WRAIN: { actionCode: "UPDATE", name: "Rainstorm Warning" },
    },
  };
  const report = strip(formatWeather(data));
  assert.ok(report.includes("Typhoon Signal No. 8"));
  assert.ok(report.includes("Rainstorm Warning"));
  assert.ok(report.includes(", "));
});

test("handles null warning gracefully", () => {
  const data = { ...baseData, warning: null };
  assert.doesNotThrow(() => formatWeather(data));
  assert.ok(strip(formatWeather(data)).includes("No active weather warnings"));
});

// ── Structure ────────────────────────────────────────────────

test("returns a non-empty string", () => {
  assert.ok(typeof formatWeather(baseData) === "string");
  assert.ok(formatWeather(baseData).length > 0);
});

test("contains Hong Kong Weather header", () => {
  assert.ok(strip(formatWeather(baseData)).includes("Hong Kong Weather"));
});

test("contains Updated timestamp", () => {
  assert.ok(strip(formatWeather(baseData)).includes("Updated:"));
});

test("handles fully empty current object gracefully", () => {
  const data = { current: {}, forecast: {}, warning: {} };
  assert.doesNotThrow(() => formatWeather(data));
});
