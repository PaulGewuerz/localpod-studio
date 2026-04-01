require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function migrate() {
  await pool.query(`ALTER TABLE "Episode" ADD COLUMN IF NOT EXISTS "paragraphMeta" TEXT`);
  console.log('Added paragraphMeta column to Episode');
  await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
