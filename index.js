const BASE = "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";
const REFRESH_SECONDS = 60;

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  white:  "\x1b[97m",
};

function clr(color, text) {
  return `${color}${text}${c.reset}`;
}

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

export function formatWeather({ current, forecast, warning }) {
  const temp     = current.temperature?.data?.find((d) => d.place === "Hong Kong Observatory");
  const humidity = current.humidity?.data?.[0];
  const rainfall = current.rainfall?.data?.find((d) => d.place === "Hong Kong Observatory");
  const uvIndex  = current.uvindex?.data?.[0];

  const activeWarnings = Object.values(warning || {})
    .filter((w) => w.actionCode === "ISSUE" || w.actionCode === "UPDATE")
    .map((w) => w.name);

  const width = process.stdout.columns || 60;
  const divider = clr(c.dim, "─".repeat(width));
  const now = new Date().toLocaleString("en-HK", { timeZone: "Asia/Hong_Kong" });

  const lines = [
    divider,
    clr(c.bold + c.cyan, "  🌤️  Hong Kong Weather"),
    clr(c.dim, `  Updated: ${now}`),
    divider,
    "",
    clr(c.bold + c.white, "  Current Conditions"),
    temp     ? `  🌡️   Temperature  ${clr(c.yellow, `${temp.value}°${temp.unit}`)}` : "",
    humidity ? `  💧  Humidity      ${clr(c.blue, `${humidity.value}%`)}` : "",
    rainfall ? `  🌧️   Rainfall      ${clr(c.blue, `${rainfall.max ?? rainfall.value} mm`)} (past hour)` : "",
    uvIndex  ? `  ☀️   UV Index      ${clr(c.yellow, `${uvIndex.value}`)} ${clr(c.dim, `(${uvIndex.desc})`)}` : "",
    "",
    divider,
    clr(c.bold + c.white, "  Forecast"),
    "",
    wrapText(`  ${forecast.generalSituation || "N/A"}`, width),
    "",
    forecast.forecastDesc
      ? wrapText(`  🔮 ${forecast.forecastDesc}`, width)
      : "",
    forecast.outlook
      ? wrapText(`  🔭 Outlook: ${forecast.outlook}`, width)
      : "",
    "",
    divider,
    activeWarnings.length
      ? clr(c.red + c.bold, `  ⚠️  Active Warnings: `) + activeWarnings.join(", ")
      : clr(c.green, "  ✅ No active weather warnings"),
    divider,
  ];

  return lines.filter((l) => l !== "").join("\n");
}

function wrapText(text, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + word).length > width - 2) {
      if (line) lines.push(line.trimEnd());
      line = "  " + word + " ";
    } else {
      line += word + " ";
    }
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines.join("\n");
}

function clearScreen() {
  process.stdout.write("\x1b[2J\x1b[H");
}

function showCountdown(seconds) {
  process.stdout.write(
    `\r${clr(c.dim, `  Next refresh in ${seconds}s... Press Ctrl+C to exit`)}`
  );
}

async function run() {
  clearScreen();
  process.stdout.write(clr(c.dim, "  Fetching weather data...\n"));

  let lastData = null;

  const refresh = async () => {
    try {
      lastData = await getWeather();
      clearScreen();
      console.log(formatWeather(lastData));
    } catch (err) {
      clearScreen();
      console.error(clr(c.red, `  ✗ Failed to fetch: ${err.message}`));
    }
  };

  await refresh();

  let countdown = REFRESH_SECONDS;
  showCountdown(countdown);

  const tick = setInterval(() => {
    countdown--;
    if (countdown <= 0) {
      countdown = REFRESH_SECONDS;
      refresh().then(() => showCountdown(countdown));
    } else {
      showCountdown(countdown);
    }
  }, 1000);

  process.on("SIGINT", () => {
    clearInterval(tick);
    process.stdout.write("\n");
    process.exit(0);
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  run();
}
