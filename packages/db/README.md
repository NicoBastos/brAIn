# packages/db — Prisma + self-hosted Postgres (SSH tunnel supported)

This package provides the Prisma schema and client for the project and supports connecting to a self-hosted PostgreSQL instance (for example, on a DigitalOcean droplet). It also supports optionally creating an SSH tunnel from the service host to the droplet so Prisma can connect to the remote DB via a local forwarded port.

Quick references
- Prisma schema: [`packages/db/prisma/schema.prisma`](packages/db/prisma/schema.prisma:1)
- Client entrypoint: [`packages/db/src/index.ts`](packages/db/src/index.ts:1)
- package.json scripts: [`packages/db/package.json`](packages/db/package.json:1)
- Example env: [`.env.example`](.env.example:1)

1) Set DATABASE_URL
- For a local Postgres instance, set DATABASE_URL as usual:
  postgresql://user:password@localhost:5432/brain_db
- For a remote Postgres on a droplet, you can either:
  - Expose Postgres publicly (not recommended), or
  - Use the built-in SSH tunnel support below so Prisma connects via a local forwarded port.

When Prisma connects through the SSH tunnel the code will rewrite DATABASE_URL to point to the forwarded local port (default 15432). Example final DATABASE_URL that Prisma will use when tunnel is active:
postgresql://postgres:YOUR_PASSWORD@127.0.0.1:15432/postgres

2) SSH tunnel (optional, recommended for droplet-hosted DB)
This package supports starting an SSH tunnel at service startup. The tunnel forwards a local port to the remote droplet's Postgres port. Configuration is via environment variables (see [`.env.example`](.env.example:1)):

- SSH_TUNNEL_ENABLED=true                 (optional — also enabled if SSH_HOST is set)
- SSH_HOST=your.droplet.ip.or.hostname    (required to enable tunnel)
- SSH_PORT=22                             (optional, default 22)
- SSH_USER=root                           (required)
- SSH_PASSWORD=yourpassword               (optional — use for password auth)
- SSH_PRIVATE_KEY_PATH=/path/to/key       (optional — preferred; path on the host running the service)
- SSH_PRIVATE_KEY="-----BEGIN...\n..."    (optional — provide key contents; newline characters must be escaped)
- SSH_LOCAL_PORT=15432                    (optional local port to forward to; default 15432)
- SSH_DST_HOST=127.0.0.1                  (remote host from droplet perspective; default 127.0.0.1)
- SSH_DST_PORT=5432                       (remote Postgres port; default 5432)

Notes:
- The runtime uses the `tunnel-ssh` package (installed as a dependency) to create the tunnel. Ensure `pnpm install` (or your package manager) has been run so `tunnel-ssh` is available.
- When the tunnel is active the code rewrites process.env.DATABASE_URL to point to `127.0.0.1:SSH_LOCAL_PORT` before Prisma client initialization.

3) Shadow database for migrations (recommended)
When running `prisma migrate dev` against a remote DB, Prisma uses a "shadow" database to safely apply migrations. Create a local Postgres instance (or separate dedicated DB) and set:
SHADOW_DATABASE_URL=postgresql://shadow:password@localhost:5433/brain_shadow
Then run migrations with that env var present.

4) Install dependencies
From the repo root:
pnpm install

5) Generate Prisma client
pnpm --filter @brain/db run prisma:generate
(The package has a `postinstall` script that runs this automatically.)

6) Run migrations (development)
With `DATABASE_URL` and `SHADOW_DATABASE_URL` set:
pnpm --filter @brain/db run migrate:dev
For CI/production against an already migrated DB, prefer:
pnpm --filter @brain/db run prisma:migrate deploy

7) Introspect existing DB
pnpm --filter @brain/db run prisma:db pull --schema=prisma/schema.prisma

8) Prisma Studio
pnpm --filter @brain/db run studio

Usage in code
- The Prisma client is exported from [`packages/db/src/index.ts`](packages/db/src/index.ts:1).
- Call `connectDb()` at service startup (it will start the SSH tunnel if configured and then connect Prisma).
- Call `disconnectDb()` on shutdown to close both Prisma and the SSH tunnel.

Example:
import { connectDb, disconnectDb, getPrisma } from './packages/db/src/index.ts'

async function start() {
  await connectDb();
  const prisma = getPrisma();
  // use prisma...
}

Advanced / Troubleshooting
- TLS / sslmode: If your remote DB requires TLS, ensure your DATABASE_URL includes `?sslmode=require`. When connecting via an SSH tunnel (recommended), TLS between the service and local forwarded port is not required because traffic is tunneled over SSH; however the Postgres server itself may still require TLS for local connections—verify your Postgres configuration.
- Permissions / auth: Verify the DB user, password and network access from the droplet.
- SSH failures: Ensure the SSH user has permissions and the private key or password is valid. If using `SSH_PRIVATE_KEY_PATH`, that path must be accessible on the host running the service.
- Dependency missing: If you see "module not found" for `tunnel-ssh`, run `pnpm --filter @brain/db install` or from repo root `pnpm install`.

This README documents how to use a self-hosted Postgres instance (optionally accessed via an SSH tunnel) with the `packages/db` Prisma setup.