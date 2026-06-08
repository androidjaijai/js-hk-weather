#!/usr/bin/env node
/**
 * opalstack-dump.js  —  Opalstack association dump
 *
 * Prints two aligned tables:
 *   1. SITE → DOMAINS
 *   2. SITE → APP → OS USER → SERVER → DATABASE
 *
 * Usage:
 *   OPALSTACK_TOKEN=<token> node opalstack-dump.js
 *   node opalstack-dump.js --token <token>
 *   node opalstack-dump.js --json    # raw JSON
 */

const BASE = "https://my.opalstack.com/api/v1";

const c = {
  reset:   "\x1b[0m",  bold:  "\x1b[1m",  dim:     "\x1b[2m",
  cyan:    "\x1b[36m", yellow:"\x1b[33m", green:   "\x1b[32m",
  red:     "\x1b[31m", blue:  "\x1b[34m", magenta: "\x1b[35m",
  white:   "\x1b[97m", gray:  "\x1b[90m",
};
const clr  = (col, text) => `${col}${text}${c.reset}`;

// ── CLI ───────────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const jsonMode  = args.includes("--json");
const tokenFlag = args.indexOf("--token");
const token     = tokenFlag !== -1 ? args[tokenFlag + 1] : process.env.OPALSTACK_TOKEN;

if (!token) {
  console.error(clr(c.red, "Error: API token required."));
  console.error("  Set OPALSTACK_TOKEN env var, or pass --token <token>");
  process.exit(1);
}

// ── API ───────────────────────────────────────────────────────────────────────
async function apiFetch(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Token ${token}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status} ${res.statusText}`);
  return res.json();
}

async function fetchAll() {
  process.stderr.write(clr(c.gray, "Fetching Opalstack data…\n"));
  const [sites, apps, domains, osusers, mariaDbs, mariaUsers, psqlDbs, psqlUsers] =
    await Promise.all([
      apiFetch("/site/list/"),
      apiFetch("/app/list/"),
      apiFetch("/domain/list/"),
      apiFetch("/osuser/list/"),
      apiFetch("/mariadb/list/"),
      apiFetch("/mariauser/list/"),
      apiFetch("/psqldb/list/"),
      apiFetch("/psqluser/list/"),
    ]);
  return { sites, apps, domains, osusers, mariaDbs, mariaUsers, psqlDbs, psqlUsers };
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const byId    = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const groupBy = (arr, fn) => {
  const m = {};
  for (const item of arr) {
    const k = fn(item);
    if (k == null) continue;
    (m[k] = m[k] || []).push(item);
  }
  return m;
};

// Strip ANSI codes to get true visible length for column alignment
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const vlen    = (s) => String(s).replace(ANSI_RE, "").length;
const padEnd  = (s, n) => s + " ".repeat(Math.max(0, n - vlen(s)));

// ── Table renderer ────────────────────────────────────────────────────────────
// cols: [{ header, key, color }]
// rows: array of objects, or the string "_sep" to draw a divider
function drawTable(cols, rows) {
  const widths = cols.map((col) =>
    Math.max(
      vlen(col.header),
      ...rows.filter((r) => r !== "_sep").map((r) => vlen(r[col.key] ?? ""))
    )
  );

  const hr = (l, m, r, line) =>
    l + widths.map((w) => line.repeat(w + 2)).join(m) + r;

  const renderRow = (r, isHeader = false) => {
    const cells = cols.map((col, i) => {
      const raw = isHeader ? col.header : (r[col.key] ?? "");
      const colored = isHeader
        ? clr(c.bold + c.white, raw)
        : col.color && raw
          ? clr(col.color, raw)
          : raw;
      return padEnd(colored, widths[i]);
    });
    return "│ " + cells.join(" │ ") + " │";
  };

  const lines = [
    hr("┌", "┬", "┐", "─"),
    renderRow(null, true),
    hr("├", "┼", "┤", "─"),
  ];

  for (const r of rows) {
    lines.push(r === "_sep" ? hr("├", "┼", "┤", "─") : renderRow(r));
  }

  lines.push(hr("└", "┴", "┘", "─"));
  return lines.join("\n");
}

// ── Main renderer ─────────────────────────────────────────────────────────────
function renderTables(data) {
  const { sites, apps, domains, osusers, mariaDbs, mariaUsers, psqlDbs, psqlUsers } = data;

  const appIdx    = byId(apps);
  const domainIdx = byId(domains);
  const osuserIdx = byId(osusers);

  // osuser → db users
  const mariaUserByOsuser = groupBy(mariaUsers, (u) => u.osuser);
  const psqlUserByOsuser  = groupBy(psqlUsers,  (u) => u.osuser);

  // db user → databases
  const mariaDbByUser = {};
  for (const db of mariaDbs)
    for (const uid of (db.dbusers || []))
      (mariaDbByUser[uid] = mariaDbByUser[uid] || []).push(db);

  const psqlDbByUser = {};
  for (const db of psqlDbs)
    for (const uid of (db.dbusers || []))
      (psqlDbByUser[uid] = psqlDbByUser[uid] || []).push(db);

  function dbsForOsuser(osuserId) {
    const maria = (mariaUserByOsuser[osuserId] || [])
      .flatMap((u) => (mariaDbByUser[u.id] || []).map((db) => ({ kind: "MariaDB", db, dbuser: u })));
    const psql  = (psqlUserByOsuser[osuserId] || [])
      .flatMap((u) => (psqlDbByUser[u.id]  || []).map((db) => ({ kind: "PgSQL",   db, dbuser: u })));
    const seen  = new Set();
    return [...maria, ...psql].filter(({ kind, db }) => {
      const k = `${kind}:${db.id}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
  }

  // ── Table 1: SITE → DOMAINS ──────────────────────────────────────────────
  const domainRows = [];
  for (const site of sites) {
    if (domainRows.length) domainRows.push("_sep");
    const siteDomains = (site.domains || []).map((id) => domainIdx[id]).filter(Boolean);
    if (siteDomains.length === 0) {
      domainRows.push({ site: site.name, domain: clr(c.gray, "(none)"), ip: site.ip ?? "" });
    } else {
      for (let i = 0; i < siteDomains.length; i++) {
        domainRows.push({
          site:   i === 0 ? site.name : "",
          domain: siteDomains[i].name,
          ip:     i === 0 ? (site.ip ?? "") : "",
        });
      }
    }
  }

  // ── Unattached domains ───────────────────────────────────────────────────
  const usedDomainIds = new Set(sites.flatMap((s) => s.domains || []));
  const orphanDomains = domains.filter((d) => !usedDomainIds.has(d.id));
  if (orphanDomains.length) {
    if (domainRows.length) domainRows.push("_sep");
    for (let i = 0; i < orphanDomains.length; i++) {
      domainRows.push({
        site:   i === 0 ? clr(c.red, "(unattached)") : "",
        domain: orphanDomains[i].name,
        ip:     "",
      });
    }
  }

  // ── Table 2: SITE → APP → USER → SERVER → DATABASE ───────────────────────
  const mountedAppIds = new Set(
    sites.flatMap((s) => (s.apps || []).map((e) => e.app ?? e))
  );

  const assocRows = [];

  function pushAppRows(siteName, siteApps, firstSiteRow) {
    let first = firstSiteRow;
    for (const entry of siteApps) {
      const appId  = entry.app  ?? entry;
      const path   = entry.path ?? "/";
      const app    = appIdx[appId];
      if (!app) continue;

      const osuser = osuserIdx[app.osuser];
      const dbs    = osuser ? dbsForOsuser(osuser.id) : [];
      const dbRows = dbs.length ? dbs : [null];

      for (let i = 0; i < dbRows.length; i++) {
        const d = dbRows[i];
        assocRows.push({
          site:   first && i === 0 ? siteName : "",
          path:   i === 0 ? path             : "",
          app:    i === 0 ? app.name         : "",
          type:   i === 0 ? (app.type ?? "") : "",
          user:   i === 0 ? (osuser?.name  ?? "") : "",
          server: i === 0 ? (osuser?.server ?? "") : "",
          db:     d ? d.db.name : clr(c.gray, "—"),
          dbtype: d ? d.kind    : "",
        });
        first = false;
      }
    }
    return first; // still true if no apps were pushed
  }

  for (const site of sites) {
    if (assocRows.length) assocRows.push("_sep");
    const leftFirst = pushAppRows(site.name, site.apps || [], true);
    if (leftFirst) {
      // site has no apps
      assocRows.push({
        site: site.name, path: "", app: clr(c.gray, "(no apps)"),
        type: "", user: "", server: "", db: "", dbtype: "",
      });
    }
  }

  // orphan apps
  const orphanApps = apps.filter((a) => !mountedAppIds.has(a.id));
  if (orphanApps.length) {
    if (assocRows.length) assocRows.push("_sep");
    pushAppRows(clr(c.red, "(no site)"), orphanApps.map((a) => ({ app: a.id, path: "" })), true);
  }

  // ── Output ────────────────────────────────────────────────────────────────
  const out = [];
  const ts  = new Date().toISOString();
  out.push("");
  out.push(clr(c.bold + c.cyan, `  Opalstack Account`) + clr(c.gray, `  ${ts}`));
  out.push("");

  out.push(clr(c.bold + c.white, "  SITE → DOMAINS"));
  for (const line of drawTable(
    [
      { header: "SITE",   key: "site",   color: c.green  },
      { header: "DOMAIN", key: "domain", color: c.yellow },
      { header: "IP",     key: "ip",     color: c.gray   },
    ],
    domainRows
  ).split("\n")) out.push("  " + line);

  out.push("");
  out.push(clr(c.bold + c.white, "  SITE → APP → OS USER → DATABASE"));
  for (const line of drawTable(
    [
      { header: "SITE",     key: "site",   color: c.green   },
      { header: "PATH",     key: "path",   color: c.magenta },
      { header: "APP",      key: "app",    color: c.white   },
      { header: "TYPE",     key: "type",   color: c.gray    },
      { header: "OS USER",  key: "user",   color: c.blue    },
      { header: "SERVER",   key: "server", color: c.gray    },
      { header: "DATABASE", key: "db",     color: c.yellow  },
      { header: "DB TYPE",  key: "dbtype", color: c.cyan    },
    ],
    assocRows
  ).split("\n")) out.push("  " + line);

  out.push("");
  return out.join("\n");
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  try {
    const data = await fetchAll();
    if (jsonMode) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(renderTables(data));
    }
  } catch (err) {
    console.error(clr(c.red, `Error: ${err.message}`));
    process.exit(1);
  }
}

main();
