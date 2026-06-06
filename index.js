const BASE = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";

async function getWeather() {
  const [currentRes, forecastRes, warningRes] = await Promise.all([
    fetch(`${BASE}?dataType=rhrread&lang=en`),
    fetch(`${BASE}?dataType=flw&lang=en`),
    fetch(`${BASE}?dataType=warnsum&lang=en`),
  ]);

  const [current, forecast, warning] = await Promise.all([
    currentRes.json(),
    forecastRes.json(),
    warningRes.json(),
  ]);

  return { current, forecast, warning };
}

function formatWeather({ current, forecast, warning }) {
  const temp = current.temperature?.data?.find((d) => d.place === "Hong Kong Observatory");
  const humidity = current.humidity?.data?.[0];
  const rainfall = current.rainfall?.data?.find((d) => d.place === "Hong Kong Observatory");
  const uvIndex = current.uvindex?.data?.[0];

  const activeWarnings = Object.values(warning || {})
    .filter((w) => w.actionCode === "ISSUE" || w.actionCode === "UPDATE")
    .map((w) => w.name);

  const lines = [
    "🌤️  *Hong Kong Weather Report*",
    `📅 ${new Date().toLocaleString("en-HK", { timeZone: "Asia/Hong_Kong" })}`,
    "",
    "*Current Conditions*",
    temp ? `🌡️  Temperature: ${temp.value}°${temp.unit}` : "",
    humidity ? `💧 Humidity: ${humidity.value}%` : "",
    rainfall ? `🌧️  Rainfall (past hour): ${rainfall.max ?? rainfall.value} mm` : "",
    uvIndex ? `☀️  UV Index: ${uvIndex.value} (${uvIndex.desc})` : "",
    "",
    "*Forecast*",
    `📋 ${forecast.generalSituation || "N/A"}`,
    "",
    forecast.forecastDesc ? `🔮 ${forecast.forecastDesc}` : "",
    forecast.outlook ? `🔭 Outlook: ${forecast.outlook}` : "",
    "",
    activeWarnings.length
      ? `⚠️  *Active Warnings:* ${activeWarnings.join(", ")}`
      : "✅ No active weather warnings",
  ];

  return lines.filter((l) => l !== "").join("\n");
}

async function main() {
  try {
    const data = await getWeather();
    const report = formatWeather(data);
    console.log(report);
  } catch (err) {
    console.error("Failed to fetch weather:", err.message);
    process.exit(1);
  }
}

main();
