/**
 * Mint a partner API key for an organization.
 *
 *   node scripts/create-api-key.js --org <organizationId> --name "Acme Group production"
 *   node scripts/create-api-key.js --email someone@publisher.com --name "Acme Group"
 *
 * Prints the raw key ONCE — it is not recoverable afterwards (only its hash is
 * stored). Hand it to the partner over a secure channel. Revoke with:
 *   node scripts/create-api-key.js --revoke <apiKeyId>
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const prisma = require('../src/prisma');
const { generateApiKey } = require('../src/utils/apiKeys');

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main() {
  const revokeId = arg('--revoke');
  if (revokeId) {
    const updated = await prisma.apiKey.update({
      where: { id: revokeId },
      data: { revokedAt: new Date() },
    });
    console.log(`Revoked ${updated.keyPrefix}… (${updated.id})`);
    return;
  }

  const name = arg('--name');
  if (!name) throw new Error('--name is required');

  let organizationId = arg('--org');
  const email = arg('--email');
  if (!organizationId && email) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No user found for ${email}`);
    organizationId = user.organizationId;
  }
  if (!organizationId) throw new Error('Provide --org <id> or --email <address>');

  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error(`No organization found for ${organizationId}`);

  const { key, keyHash, keyPrefix } = generateApiKey();
  const created = await prisma.apiKey.create({
    data: { name, keyPrefix, keyHash, organizationId },
  });

  console.log(`\nAPI key created for org "${org.name}" (${org.id})`);
  console.log(`  id:     ${created.id}`);
  console.log(`  name:   ${created.name}`);
  console.log('\n  Raw key (shown once — store it now):\n');
  console.log(`    ${key}\n`);
  console.log('  Use it as:  Authorization: Bearer ' + key + '\n');
}

main()
  .catch(err => { console.error('FAILED:', err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
