#!/usr/bin/env node
/**
 * opalstack-dump.js
 *
 * Dumps Opalstack account data as a visual tree:
 *
 *   SITE: mysite
 *   ├── 🌐 mysite.com
 *   ├── 🌐 www.mysite.com
 *   ├── [/]      myapp  (wordpress)  👤 eddie  🖥 us1.opalstack.com
 *   │            └── 🗄 mydb  [MariaDB]  dbuser: mydb_user
 *   └── [/blog]  blog   (static)    👤 eddie
 *
 * Usage:
 *   OPALSTACK_TOKEN=<token> node opalstack-dump.js
 *   node opalstack-dump.js --token <token>
 *   node opalstack-dump.js --json    # raw JSON dump
 */

const BASE = "https://my.opalstack.com/api/v1";

const c = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  green:   "\x1b[32m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  white:   "\x1b[97m",
  gray:    "\x1b[90m",
};
const clr  = (col, text) => `${col}${text}${c.reset}`;
const dim  = (text) => clr(c.dim + c.gray, text);
const bold = (text) => clr(c.bold + c.white, text);

// ── CLI args ─────────────────────────────────────────────────────────────────
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
  process.stderr.write(dim("Fetching Opalstack data…\n"));
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
const byId     = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
const groupBy  = (arr, fn) => {
  const m = {};
  for (const item of arr) {
    const k = fn(item);
    if (k == null) continue;
    (m[k] = m[k] || []).push(item);
  }
  return m;
};

// ── Tree printer ──────────────────────────────────────────────────────────────
function renderTree(data) {
  const { sites, apps, domains, osusers, mariaDbs, mariaUsers, psqlDbs, psqlUsers } = data;

  const appIdx     = byId(apps);
  const domainIdx  = byId(domains);
  const osuserIdx  = byId(osusers);

  // dbuser → dbs  (many-to-many via db.dbusers[])
  const mariaDbByUserId = {};
  for (const db of mariaDbs)
    for (const uid of (db.dbusers || []))
      (mariaDbByUserId[uid] = mariaDbByUserId[uid] || []).push(db);

  const psqlDbByUserId = {};
  for (const db of psqlDbs)
    for (const uid of (db.dbusers || []))
      (psqlDbByUserId[uid] = psqlDbByUserId[uid] || []).push(db);

  // osuser → dbusers
  const mariaUserByOsuser = groupBy(mariaUsers, (u) => u.osuser);
  const psqlUserByOsuser  = groupBy(psqlUsers,  (u) => u.osuser);

  function dbsForOsuser(osuserId) {
    const maria = (mariaUserByOsuser[osuserId] || [])
      .flatMap((u) => (mariaDbByUserId[u.id] || []).map((db) => ({ kind: "MariaDB", db, dbuser: u })));
    const psql  = (psqlUserByOsuser[osuserId] || [])
      .flatMap((u) => (psqlDbByUserId[u.id]  || []).map((db) => ({ kind: "PgSQL",   db, dbuser: u })));
    const seen = new Set();
    return [...maria, ...psql].filter(({ kind, db }) => {
      const k = `${kind}:${db.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  const out = [];
  const W   = process.stdout.columns || 90;

  // header
  out.push("");
  out.push(clr(c.bold + c.cyan, "  Opalstack Account  ") + dim(new Date().toISOString()));
  out.push(dim("  " + "─".repeat(W - 2)));

  // ── SITES ──────────────────────────────────────────────────────────────────
  const mountedAppIds = new Set(
    sites.flatMap((s) => (s.apps || []).map((e) => e.app ?? e))
  );

  for (const site of sites) {
    out.push("");
    out.push(
      clr(c.bold + c.green, `  ┌─ SITE: ${site.name}`) +
      dim(`  [${site.ip ?? ""}  id:${site.id}]`)
    );

    const siteItems = [];

    // domains
    const siteDomains = (site.domains || []).map((id) => domainIdx[id]).filter(Boolean);
    for (const d of siteDomains)
      siteItems.push({ kind: "domain", d });

    // apps
    const siteApps = (site.apps || []);
    for (const entry of siteApps) {
      const appId  = entry.app  ?? entry;
      const path   = entry.path ?? "/";
      const app    = appIdx[appId];
      if (app) siteItems.push({ kind: "app", app, path });
    }

    // render items with tree lines
    for (let i = 0; i < siteItems.length; i++) {
      const item    = siteItems[i];
      const isLast  = i === siteItems.length - 1;
      const branch  = isLast ? "  └──" : "  ├──";
      const cont    = isLast ? "      " : "  │   ";

      if (item.kind === "domain") {
        out.push(
          clr(c.yellow, branch + " 🌐 " + item.d.name) +
          dim(`  [id:${item.d.id}]`)
        );
      } else {
        const { app, path } = item;
        const osuser = osuserIdx[app.osuser];
        const userName = osuser ? clr(c.blue, "👤 " + osuser.name) : "";
        const server   = osuser ? dim("  @ " + osuser.server) : "";
        out.push(
          clr(c.magenta, `${branch} [${path}]`) +
          `  ${clr(c.bold + c.white, app.name)}` +
          dim(`  (${app.type})`) +
          `  ${userName}${server}`
        );

        if (osuser) {
          const dbs = dbsForOsuser(osuser.id);
          for (let j = 0; j < dbs.length; j++) {
            const { kind, db, dbuser } = dbs[j];
            const dbLast   = j === dbs.length - 1;
            const dbBranch = cont + (dbLast ? "└── " : "├── ");
            const badge    = kind === "MariaDB"
              ? clr(c.cyan,   "🗄 ")
              : clr(c.green,  "🐘 ");
            out.push(
              dim(dbBranch) +
              badge + clr(c.yellow, db.name) +
              dim(`  [${kind}]  dbuser: ${dbuser.name}  server: ${db.server}  id:${db.id}`)
            );
          }
        }
      }
    }

    out.push(clr(c.dim, "  └" + "─".repeat(W - 3)));
  }

  // ── UNMOUNTED APPS ─────────────────────────────────────────────────────────
  const orphanApps = apps.filter((a) => !mountedAppIds.has(a.id));
  if (orphanApps.length) {
    out.push("");
    out.push(clr(c.bold + c.red, `  ┌─ UNMOUNTED APPS (${orphanApps.length})`));
    for (let i = 0; i < orphanApps.length; i++) {
      const app    = orphanApps[i];
      const isLast = i === orphanApps.length - 1;
      const branch = isLast ? "  └──" : "  ├──";
      const cont   = isLast ? "      " : "  │   ";
      const osuser = osuserIdx[app.osuser];
      out.push(
        clr(c.magenta, `${branch} ${app.name}`) +
        dim(`  (${app.type})`) +
        (osuser ? `  ${clr(c.blue, "👤 " + osuser.name)}` : "")
      );
      if (osuser) {
        const dbs = dbsForOsuser(osuser.id);
        for (let j = 0; j < dbs.length; j++) {
          const { kind, db, dbuser } = dbs[j];
          const dbLast   = j === dbs.length - 1;
          const dbBranch = cont + (dbLast ? "└── " : "├── ");
          const badge    = kind === "MariaDB" ? clr(c.cyan, "🗄 ") : clr(c.green, "🐘 ");
          out.push(
            dim(dbBranch) +
            badge + clr(c.yellow, db.name) +
            dim(`  [${kind}]  dbuser: ${dbuser.name}`)
          );
        }
      }
    }
    out.push(dim("  └" + "─".repeat(W - 3)));
  }

  // ── UNATTACHED DOMAINS ─────────────────────────────────────────────────────
  const usedDomainIds  = new Set(sites.flatMap((s) => s.domains || []));
  const orphanDomains  = domains.filter((d) => !usedDomainIds.has(d.id));
  if (orphanDomains.length) {
    out.push("");
    out.push(clr(c.bold + c.yellow, `  ┌─ UNATTACHED DOMAINS (${orphanDomains.length})`));
    for (let i = 0; i < orphanDomains.length; i++) {
      const d      = orphanDomains[i];
      const branch = i === orphanDomains.length - 1 ? "  └──" : "  ├──";
      out.push(clr(c.yellow, `${branch} 🌐 ${d.name}`) + dim(`  [id:${d.id}]`));
    }
    out.push(dim("  └" + "─".repeat(W - 3)));
  }

  // ── OS USERS ───────────────────────────────────────────────────────────────
  out.push("");
  out.push(clr(c.bold + c.blue, `  ┌─ OS USERS (${osusers.length})`));
  for (let i = 0; i < osusers.length; i++) {
    const u      = osusers[i];
    const branch = i === osusers.length - 1 ? "  └──" : "  ├──";
    out.push(
      clr(c.blue, `${branch} 👤 ${u.name}`) +
      dim(`  @ ${u.server}  [id:${u.id}]`)
    );
  }
  out.push(dim("  └" + "─".repeat(W - 3)));

  // ── DATABASES ──────────────────────────────────────────────────────────────
  const allDbs = [
    ...mariaDbs.map((d) => ({ ...d, kind: "MariaDB" })),
    ...psqlDbs.map((d)  => ({ ...d, kind: "PgSQL"   })),
  ];
  out.push("");
  out.push(clr(c.bold + c.cyan, `  ┌─ DATABASES (${allDbs.length})`));
  for (let i = 0; i < allDbs.length; i++) {
    const db     = allDbs[i];
    const branch = i === allDbs.length - 1 ? "  └──" : "  ├──";
    const badge  = db.kind === "MariaDB" ? clr(c.cyan, "🗄 ") : clr(c.green, "🐘 ");
    out.push(
      dim(branch + " ") + badge + clr(c.yellow, db.name) +
      dim(`  [${db.kind}]  @ ${db.server}  [id:${db.id}]`)
    );
  }
  out.push(dim("  └" + "─".repeat(W - 3)));

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
      console.log(renderTree(data));
    }
  } catch (err) {
    console.error(clr(c.red, `Error: ${err.message}`));
    process.exit(1);
  }
}

main();
