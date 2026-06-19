/**
 * One-off: apply the 20260619000000_add_show_automation_schedule migration via raw SQL.
 * Prisma db push fails on this DB (Supabase cross-schema auth reference), so
 * schema changes are applied directly through pg. Tolerant of already-applied
 * statements so it is safe to re-run.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const IGNORABLE = new Set([
  '42701', // duplicate_column
  '42P07', // duplicate_table / duplicate index relation
  '42710', // duplicate_object (constraint)
]);

async function main() {
  const sqlPath = path.join(__dirname, '../prisma/migrations/20260619000000_add_show_automation_schedule/migration.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  const statements = sql
    .split(/;\s*$/m)
    .map(s => s.replace(/--.*$/gm, '').trim())
    .filter(Boolean);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    for (const stmt of statements) {
      const label = stmt.split('\n')[0].slice(0, 70);
      try {
        await pool.query(stmt);
        console.log(`  OK   ${label}`);
      } catch (err) {
        if (IGNORABLE.has(err.code)) {
          console.log(`  SKIP ${label}  (already applied: ${err.code})`);
        } else {
          throw err;
        }
      }
    }
    console.log('Migration applied.');
  } finally {
    await pool.end();
  }
}

main().catch(err => { console.error('FAILED:', err.message); process.exit(1); });
