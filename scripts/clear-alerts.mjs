import { Client } from 'pg';
import { config } from 'dotenv';
config({ path: '.env' });
config({ path: '.env.local', override: true });

async function clear() {
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query('TRUNCATE TABLE jira_sla_alerts');
  await c.end();
  console.log('✅ Alerts history cleared. Next run will send messages again.');
}
clear();
