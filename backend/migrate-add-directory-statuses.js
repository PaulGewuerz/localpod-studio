const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await pool.query(`ALTER TABLE "Show" ADD COLUMN IF NOT EXISTS "directoryStatuses" JSONB`);
  console.log('Added directoryStatuses column to Show');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
