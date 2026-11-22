import { randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { loadConfig, loadDotEnv } from '../config.ts';
import { Platform } from '../tenancy/platform.ts';
import { AppError } from '../util.ts';

const USAGE = `Manage organizations; each one has its own database.

  npm run orgs -- list
  npm run orgs -- create <id> --name "Acme Inc" --admin-email ada@acme.example [--admin-name "Ada Lovelace"]
                             [--admin-password <password>] [--demo [--sample-logins]]
  npm run orgs -- suspend <id>
  npm run orgs -- resume <id>
  npm run orgs -- delete <id> --yes

<id> is what people type on the sign-in page (or the subdomain with TITO_BASE_DOMAIN).
A running server picks up changes within a few seconds.`;

loadDotEnv();
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    'admin-email': { type: 'string' },
    'admin-name': { type: 'string' },
    'admin-password': { type: 'string' },
    demo: { type: 'boolean' },
    'sample-logins': { type: 'boolean' },
    yes: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
const [command, slug] = positionals;
if (values.help || !command) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const platform = await Platform.open(loadConfig());
async function find(id: string | undefined) {
  if (!id) fail(`Missing organization ID.\n\n${USAGE}`);
  return (await platform.tenantBySlug(id)) ?? fail(`There is no organization "${id}".`);
}

try {
  switch (command) {
    case 'list': {
      const tenants = await platform.listTenants();
      const rows = tenants.map((t) => {
        const info = platform.info(t);
        return [t.slug, t.name, t.kind === 'sandbox' ? `sandbox (${t.sandboxType}) of ${info.parentSlug}` : 'production', t.status, t.createdAt.slice(0, 10)];
      });
      const header = ['ID', 'NAME', 'KIND', 'STATUS', 'CREATED'];
      const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i]!.length)));
      for (const row of [header, ...rows]) console.log(row.map((cell, i) => cell.padEnd(widths[i]!)).join('  ').trimEnd());
      break;
    }
    case 'create': {
      if (!slug) fail(`Missing organization ID.\n\n${USAGE}`);
      const email = values['admin-email'] ?? fail('--admin-email is required.');
      const generated = !values['admin-password'];
      const password = values['admin-password'] ?? randomBytes(12).toString('base64url');
      const { tenant } = await platform.createOrganization(
        {
          slug,
          name: values.name ?? slug,
          admin: { email, password, name: values['admin-name'] ?? 'Administrator' },
          demo: !!values.demo,
          sampleLogins: !!values['sample-logins'],
        },
        (msg) => console.log(msg),
      );
      console.log(`Created organization "${tenant.name}" (ID: ${tenant.slug}).`);
      console.log(`  administrator: ${email}${generated ? `\n  password:      ${password}\n  Store it now; it will not be shown again.` : ''}`);
      break;
    }
    case 'suspend':
    case 'resume': {
      const tenant = await platform.setSuspended(await find(slug), command === 'suspend');
      console.log(`${tenant.name} (${tenant.slug}) is now ${tenant.status}.`);
      break;
    }
    case 'delete': {
      const tenant = await find(slug);
      if (!values.yes) fail(`This permanently deletes "${tenant.name}", its sandboxes and all their data. Re-run with --yes to confirm.`);
      await platform.deleteOrganization(tenant);
      console.log(`Deleted ${tenant.name} (${tenant.slug}).`);
      break;
    }
    default:
      fail(`Unknown command "${command}".\n\n${USAGE}`);
  }
} catch (err) {
  if (err instanceof AppError) fail(err.message);
  throw err;
} finally {
  await platform.close();
}
