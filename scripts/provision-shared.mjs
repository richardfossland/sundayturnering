// Provision SundayTurnering INTO the shared SundayChess project, using a
// dedicated `turnering` Postgres schema. Applies migrations, exposes the schema
// to PostgREST, and writes .env.local.
//
//   SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/provision-shared.mjs
//
// Idempotent-ish: re-running fails on existing tables (first run only).

import { readFileSync, writeFileSync } from "node:fs";

const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.PROJECT_REF || "fwbfhwxgkjelcutwajza"; // SundayChess
const BASE = "https://api.supabase.com/v1";

if (!TOKEN) {
  console.error("Set SUPABASE_ACCESS_TOKEN (sbp_…).");
  process.exit(1);
}
const H = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };

async function api(path, init) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...H, ...(init?.headers || {}) } });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`);
  return json;
}
const query = (sql) =>
  api(`/projects/${REF}/database/query`, { method: "POST", body: JSON.stringify({ query: sql }) });

async function main() {
  console.log(`Target project: ${REF} (shared with SundayChess)`);

  // 1. Apply migrations.
  for (const file of ["0001_schema.sql", "0002_submit_result.sql"]) {
    const sql = readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
    console.log(`Applying ${file} …`);
    await query(sql);
  }

  // 2. Expose `turnering` to PostgREST (additive — keep public + graphql_public).
  console.log("Exposing schema to PostgREST …");
  const cfg = await api(`/projects/${REF}/postgrest`);
  const schemas = String(cfg.db_schema || "public, graphql_public")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!schemas.includes("turnering")) schemas.push("turnering");
  await api(`/projects/${REF}/postgrest`, {
    method: "PATCH",
    body: JSON.stringify({ db_schema: schemas.join(", ") }),
  });
  console.log(`  db_schema = ${schemas.join(", ")}`);

  // 3. Keys (legacy or new naming).
  const keys = await api(`/projects/${REF}/api-keys`);
  const keyVal = (k) => k?.api_key ?? k?.secret ?? k?.value;
  const anon = keyVal(keys.find((k) => k.name === "anon" || k.type === "publishable" || k.name === "publishable"));
  const service = keyVal(keys.find((k) => k.name === "service_role" || k.type === "secret" || k.name === "secret"));
  const url = `https://${REF}.supabase.co`;
  if (!anon || !service)
    console.warn("⚠ key autodetect failed:", JSON.stringify(keys).slice(0, 400));

  // 4. Write .env.local.
  const env = [
    `NEXT_PUBLIC_SUPABASE_URL=${url}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon}`,
    `SUPABASE_SERVICE_ROLE_KEY=${service}`,
    `NEXT_PUBLIC_BASE_URL=https://turnering.sundaysuite.app`,
    "",
  ].join("\n");
  writeFileSync(new URL("../.env.local", import.meta.url), env);
  console.log(`\n✓ Wrote .env.local. PostgREST reload takes a few seconds.`);
  console.log("⚠ Revoke SUPABASE_ACCESS_TOKEN when done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
