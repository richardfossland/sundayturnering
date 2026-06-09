// Provision the dedicated SundayTurnering Supabase project, apply migrations,
// and write .env.local. Needs a Supabase Management API token (sbp_…).
//
//   SUPABASE_ACCESS_TOKEN=sbp_xxx DB_PASSWORD='strong-pw' node scripts/provision.mjs
//
// Idempotent-ish: if a project named 'sundayturnering' already exists in the
// org it reuses it. Migrations are applied via the Management query endpoint.

import { readFileSync } from "node:fs";
import { writeFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const DB_PASSWORD = process.env.DB_PASSWORD;
const PROJECT_NAME = "sundayturnering";
const REGION = process.env.REGION || "eu-north-1"; // Stockholm, matches the suite
const BASE = "https://api.supabase.com/v1";

if (!TOKEN) {
  console.error("Set SUPABASE_ACCESS_TOKEN (sbp_…).");
  process.exit(1);
}
if (!DB_PASSWORD) {
  console.error("Set DB_PASSWORD (the Postgres password to assign).");
  process.exit(1);
}

const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return json;
}

async function main() {
  const orgs = await api("/organizations");
  const org = orgs.find((o) => /sunday/i.test(o.name)) ?? orgs[0];
  console.log(`Org: ${org.name} (${org.id})`);

  let projects = await api("/projects");
  let project = projects.find((p) => p.name === PROJECT_NAME);

  if (!project) {
    console.log(`Creating project '${PROJECT_NAME}' in ${REGION} …`);
    project = await api("/projects", {
      method: "POST",
      body: JSON.stringify({
        name: PROJECT_NAME,
        organization_id: org.id,
        region: REGION,
        db_pass: DB_PASSWORD,
      }),
    });
  } else {
    console.log(`Reusing existing project (${project.id}).`);
  }
  const ref = project.id ?? project.ref;

  // Wait for the project to come ACTIVE_HEALTHY.
  for (let i = 0; i < 60; i++) {
    const p = await api(`/projects/${ref}`);
    if (p.status === "ACTIVE_HEALTHY") break;
    process.stdout.write(`  status=${p.status} …\r`);
    await sleep(5000);
  }
  console.log("\nProject healthy.");

  // Apply migrations via the query endpoint.
  for (const file of ["0001_schema.sql", "0002_submit_result.sql"]) {
    const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    console.log(`Applying ${file} …`);
    await api(`/projects/${ref}/database/query`, {
      method: "POST",
      body: JSON.stringify({ query: sql }),
    });
  }

  // Fetch API keys.
  const keys = await api(`/projects/${ref}/api-keys`);
  const anon = keys.find((k) => k.name === "anon")?.api_key;
  const service = keys.find((k) => k.name === "service_role")?.api_key;
  const url = `https://${ref}.supabase.co`;

  const env = [
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${service}`,
    `NEXT_PUBLIC_BASE_URL=https://turnering.sundaysuite.app`,
    "",
  ].join("\n");
  writeFileSync(new URL("../.env.local", import.meta.url), env);
  console.log(`\n✓ Wrote .env.local (project ref ${ref}).`);
  console.log("Next: npm run check, npm run dev (rig test), then deploy (docs/DEPLOY.md).");
  console.log("⚠ Revoke the SUPABASE_ACCESS_TOKEN when done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
