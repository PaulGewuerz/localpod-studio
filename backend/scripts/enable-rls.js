/**
 * One-off: enable Row-Level Security on all public tables (Supabase linter:
 * rls_disabled_in_public). Applies 20260707000000_enable_rls/migration.sql,
 * then sweeps for any remaining public tables without RLS. Safe to re-run
 * (ENABLE ROW LEVEL SECURITY is idempotent).
 *
 * The backend connects as the table owner, and owners bypass RLS unless FORCE
 * is set, so Prisma access is unaffected. The script verifies ownership before
 * altering anything.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const { rows: tables } = await pool.query(`
      SELECT tablename, tableowner, rowsecurity,
             tableowner = current_user AS owned_by_us,
             pg_has_role(current_user, tableowner, 'MEMBER') AS owner_via_role
      FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
    `);

    for (const t of tables) {
      if (!t.owned_by_us && !t.owner_via_role) {
        throw new Error(
          `"${t.tablename}" is owned by ${t.tableowner}, not the connecting role — ` +
          'enabling RLS could lock the backend out. Aborting; review manually.'
        );
      }
    }

    const sqlPath = path.join(__dirname, '../prisma/migrations/20260707000000_enable_rls/migration.sql');
    const statements = fs.readFileSync(sqlPath, 'utf8')
      .split(/;\s*$/m)
      .map(s => s.replace(/--.*$/gm, '').trim())
      .filter(Boolean);

    for (const stmt of statements) {
      await pool.query(stmt);
      console.log(`  OK   ${stmt.slice(0, 70)}`);
    }

    // Sweep any public table the migration file didn't cover.
    const { rows: remaining } = await pool.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND NOT rowsecurity`
    );
    for (const { tablename } of remaining) {
      await pool.query(`ALTER TABLE "${tablename}" ENABLE ROW LEVEL SECURITY`);
      console.log(`  OK   ALTER TABLE "${tablename}" ENABLE ROW LEVEL SECURITY (sweep)`);
    }

    const { rows: after } = await pool.query(
      `SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`
    );
    console.log('\nRLS status:');
    for (const t of after) console.log(`  ${t.rowsecurity ? 'ON ' : 'OFF'}  ${t.tablename}`);

    // Sanity check: the backend role must still be able to read.
    const { rows: [{ n }] } = await pool.query(`SELECT count(*)::int AS n FROM "User"`);
    console.log(`\nBackend read check: SELECT count(*) FROM "User" -> ${n} (OK)`);
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
