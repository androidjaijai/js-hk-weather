#!/usr/bin/env node
/**
 * opalstack-dump.js
 *
 * Dumps Opalstack account data and shows associations between:
 *   sites → domains → apps → osusers → databases
 *
 * Usage:
 *   OPALSTACK_TOKEN=<your-api-token> node opalstack-dump.js
 *   node opalstack-dump.js --token <your-api-token>
 *   node opalstack-dump.js --json   # output raw JSON instead of the tree view
 */

const BASE = "https://my.opalstack.com/api/v1";

const c = {
  reset:  "\x1b[0m",
  bold:   "\x1b[1m",
  dim:    "\x1b[2m",
  cyan:   "\x1b[36m",
  yellow: "\x1b[33m",
  green:  "\x1b[32m",
  red:    "\x1b[31m",
  blue:   "\x1b[34m",
  magenta:"\x1b[35m",
  white:  "\x1b[97m",
};
const clr = (col, text) => `${col}${text}${c.reset}`;

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const jsonMode   = args.includes("--json");
const tokenFlag  = args.indexOf("--token");
const token      = tokenFlag !== -1 ? args[tokenFlag + 1] : process.env.OPALSTACK_TOKEN;

if (!token) {
  console.error(clr(c.red, "Error: Opalstack API token required."));
  console.error("  Set OPALSTACK_TOKEN env var, or pass --token <token>");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------
async function apiFetch(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`GET ${path} → HTTP ${res.status} ${res.statusText}`);
  }
  return res.json();
}

async function fetchAll() {
  process.stderr.write(clr(c.dim, "Fetching Opalstack data...\n"));
  const [sites, apps, domains, osusers, mysqlDbs, mysqlUsers, pgsqlDbs, pgsqlUsers] =
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
  return { sites, apps, domains, osusers, mysqlDbs, mysqlUsers, pgsqlDbs, pgsqlUsers };
}

// ---------------------------------------------------------------------------
// Index builders
// ---------------------------------------------------------------------------
function byId(arr) {
  return Object.fromEntries(arr.map((x) => [x.id, x]));
}

// ---------------------------------------------------------------------------
// Tree renderer
// ---------------------------------------------------------------------------
function renderTree(data) {
  const { sites, apps, domains, osusers, mysqlDbs, mysqlUsers, pgsqlDbs, pgsqlUsers } = data;

  const appIdx      = byId(apps);
  const domainIdx   = byId(domains);
  const osuserIdx   = byId(osusers);
  const mysqlDbIdx  = byId(mysqlDbs);
  const mysqlUIdx   = byId(mysqlUsers);
  const pgsqlDbIdx  = byId(pgsqlDbs);
  const pgsqlUIdx   = byId(pgsqlUsers);

  // Map osuser → databases
  const mysqlByOsuser  = groupBy(mysqlDbs,  (d) => d.server); // server = osuser server; keyed by db.id is not osuser
  // Databases don't directly store osuser id — they store dbusers, dbusers store osuser
  // Build: osuser_id → [db records]
  const mysqlUserByOsuser  = groupBy(mysqlUsers,  (u) => u.osuser);
  const pgsqlUserByOsuser  = groupBy(pgsqlUsers,  (u) => u.osuser);

  const mysqlDbByUser = groupBy(mysqlDbs,  (d) => null); // will build per user below
  const pgsqlDbByUser = groupBy(pgsqlDbs,  (d) => null);

  // dbuser → dbs (many-to-many via dbusers array on db)
  const mysqlDbByUserId  = {};
  for (const db of mysqlDbs) {
    for (const uid of (db.dbusers || [])) {
      (mysqlDbByUserId[uid] = mysqlDbByUserId[uid] || []).push(db);
    }
  }
  const pgsqlDbByUserId  = {};
  for (const db of pgsqlDbs) {
    for (const uid of (db.dbusers || [])) {
      (pgsqlDbByUserId[uid] = pgsqlDbByUserId[uid] || []).push(db);
    }
  }

  // osuser → all associated dbs (via dbusers that belong to this osuser)
  function dbsForOsuser(osuserId) {
    const mysql = (mysqlUserByOsuser[osuserId] || [])
      .flatMap((u) => (mysqlDbByUserId[u.id] || []).map((db) => ({ type: "MariaDB", db, user: u })));
    const pgsql = (pgsqlUserByOsuser[osuserId] || [])
      .flatMap((u) => (pgsqlDbByUserId[u.id] || []).map((db) => ({ type: "PgSQL", db, user: u })));
    return [...mysql, ...pgsql];
  }

  const lines = [];
  const w = process.stdout.columns || 80;
  const div = clr(c.dim, "─".repeat(w));

  lines.push(div);
  lines.push(clr(c.bold + c.cyan, "  Opalstack Account Dump"));
  lines.push(clr(c.dim, `  ${new Date().toISOString()}`));
  lines.push(div);

  // ── Sites ──────────────────────────────────────────────────────────────
  lines.push("");
  lines.push(clr(c.bold + c.white, `  SITES (${sites.length})`));

  for (const site of sites) {
    lines.push("");
    lines.push(`  ${clr(c.bold + c.green, "◉ " + site.name)} ${clr(c.dim, `[id:${site.id}]`)}`);

    const siteApps = (site.apps || []);

    // Domains on this site
    const siteDomains = (site.domains || []).map((did) => domainIdx[did]).filter(Boolean);
    if (siteDomains.length) {
      lines.push(`    ${clr(c.cyan, "Domains:")}`);
      for (const d of siteDomains) {
        lines.push(`      ${clr(c.yellow, "⌂ " + d.name)} ${clr(c.dim, `[id:${d.id}]`)}`);
      }
    }

    // Apps mounted on this site  (site.apps is [{app, path}] or [id] depending on API version)
    if (siteApps.length) {
      lines.push(`    ${clr(c.cyan, "Apps:")}`);
      for (const entry of siteApps) {
        const appId   = entry.app ?? entry;
        const appPath = entry.path ?? "/";
        const app = appIdx[appId];
        if (!app) continue;

        const osuser = osuserIdx[app.osuser];
        lines.push(
          `      ${clr(c.magenta, "▸ " + app.name)} ${clr(c.dim, `[${app.type}]`)} ` +
          `${clr(c.dim, `path:${appPath}`)} ${clr(c.dim, `[id:${app.id}]`)}`
        );
        if (osuser) {
          lines.push(`        ${clr(c.blue, "user: " + osuser.name)} ${clr(c.dim, `[id:${osuser.id}]`)}`);

          const dbs = dbsForOsuser(osuser.id);
          if (dbs.length) {
            lines.push(`        ${clr(c.cyan, "Databases:")}`);
            const seen = new Set();
            for (const { type, db, user } of dbs) {
              const key = `${type}:${db.id}`;
              if (seen.has(key)) continue;
              seen.add(key);
              lines.push(
                `          ${clr(c.yellow, "⊞ " + db.name)} ${clr(c.dim, `[${type}]`)} ` +
                `${clr(c.dim, `dbuser:${user.name}`)} ${clr(c.dim, `[id:${db.id}]`)}`
              );
            }
          }
        }
      }
    }
  }

  // ── Orphan apps (not mounted on any site) ──────────────────────────────
  const mountedAppIds = new Set(
    sites.flatMap((s) => (s.apps || []).map((e) => e.app ?? e))
  );
  const orphanApps = apps.filter((a) => !mountedAppIds.has(a.id));
  if (orphanApps.length) {
    lines.push("");
    lines.push(clr(c.bold + c.white, `  UNMOUNTED APPS (${orphanApps.length})`));
    for (const app of orphanApps) {
      const osuser = osuserIdx[app.osuser];
      lines.push(`  ${clr(c.magenta, "▸ " + app.name)} ${clr(c.dim, `[${app.type}]`)} ${clr(c.dim, `[id:${app.id}]`)}`);
      if (osuser) {
        lines.push(`    ${clr(c.blue, "user: " + osuser.name)}`);
        const dbs = dbsForOsuser(osuser.id);
        if (dbs.length) {
          const seen = new Set();
          for (const { type, db, user } of dbs) {
            const key = `${type}:${db.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            lines.push(`    ${clr(c.yellow, "⊞ " + db.name)} ${clr(c.dim, `[${type}]`)} ${clr(c.dim, `dbuser:${user.name}`)}`);
          }
        }
      }
    }
  }

  // ── Orphan domains (not attached to any site) ──────────────────────────
  const usedDomainIds = new Set(sites.flatMap((s) => s.domains || []));
  const orphanDomains = domains.filter((d) => !usedDomainIds.has(d.id));
  if (orphanDomains.length) {
    lines.push("");
    lines.push(clr(c.bold + c.white, `  UNATTACHED DOMAINS (${orphanDomains.length})`));
    for (const d of orphanDomains) {
      lines.push(`  ${clr(c.yellow, "⌂ " + d.name)} ${clr(c.dim, `[id:${d.id}]`)}`);
    }
  }

  // ── OS Users summary ───────────────────────────────────────────────────
  lines.push("");
  lines.push(clr(c.bold + c.white, `  OS USERS (${osusers.length})`));
  for (const u of osusers) {
    lines.push(`  ${clr(c.blue, "● " + u.name)} ${clr(c.dim, `server:${u.server} [id:${u.id}]`)}`);
  }

  // ── Database summary ───────────────────────────────────────────────────
  const allDbs = [
    ...mysqlDbs.map((d) => ({ ...d, dbType: "MariaDB" })),
    ...pgsqlDbs.map((d) => ({ ...d, dbType: "PgSQL" })),
  ];
  lines.push("");
  lines.push(clr(c.bold + c.white, `  DATABASES (${allDbs.length})`));
  for (const db of allDbs) {
    lines.push(
      `  ${clr(c.yellow, "⊞ " + db.name)} ${clr(c.dim, `[${db.dbType}]`)} ` +
      `${clr(c.dim, `server:${db.server} [id:${db.id}]`)}`
    );
  }

  lines.push("");
  lines.push(div);
  return lines.join("\n");
}

function groupBy(arr, keyFn) {
  const map = {};
  for (const item of arr) {
    const k = keyFn(item);
    if (k == null) continue;
    (map[k] = map[k] || []).push(item);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  try {
    const data = await fetchAll();
    if (jsonMode) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(renderTree(data));
    }
  } catch (err) {
    console.error(clr(c.red, `Error: ${err.message}`));
    process.exit(1);
  }
}

main();
