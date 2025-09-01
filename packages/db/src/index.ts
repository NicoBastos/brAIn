/* Use require() for @prisma/client to avoid TypeScript issues if the package's
   typings/exports differ across Prisma versions or compilation modes. */
 // eslint-disable-next-line @typescript-eslint/no-var-requires
const { PrismaClient } = require("@prisma/client") as {
  PrismaClient: new (...args: any[]) => any;
};
type PrismaClientType = InstanceType<typeof PrismaClient>;
import fs from "fs";
import net from "net";

type TunnelServer = {
  close: () => void;
  on: (ev: string, cb: (...a: any[]) => void) => void;
};

let prisma: PrismaClientType | null = null;
let sshTunnel: TunnelServer | null = null;
let tunnelPort: number | null = null;

/** Pick a free localhost port, starting at `start` */
async function getFreePort(start = 15432): Promise<number> {
  const tryPort = (p: number): Promise<number> =>
    new Promise<number>((resolve) => {
      const srv = net
        .createServer()
        .once("error", () => resolve(tryPort(p + 1)))
        .once("listening", () => srv.close(() => resolve(p)))
        .listen(p, "127.0.0.1");
    });
  return tryPort(Number(process.env.SSH_LOCAL_PORT || start));
}

/** Start an SSH local-forward if enabled by env. Returns local forwarded port, or -1 if disabled. */
async function startSshTunnel(): Promise<number> {
  const enabled =
    process.env.SSH_TUNNEL_ENABLED === "true" || !!process.env.SSH_HOST;
  if (!enabled) return -1;

  if (sshTunnel && tunnelPort) return tunnelPort; // already up

  // Lazy-load to avoid install issues when not used
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createTunnel } = require("tunnel-ssh");

  const localPort = await getFreePort();
  
  // tunnel-ssh v5 uses a different configuration format
  const tunnelOptions = {
    autoClose: true
  };

  const serverOptions = {
    host: "127.0.0.1",
    port: localPort
  };

  const sshOptions: any = {
    host: process.env.SSH_HOST!,
    port: Number(process.env.SSH_PORT || 22),
    username: process.env.SSH_USER!
  };

  // Auth
  if (process.env.SSH_PASSWORD) sshOptions.password = process.env.SSH_PASSWORD;
  if (process.env.SSH_PRIVATE_KEY_PATH)
    sshOptions.privateKey = fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH);
  if (process.env.SSH_PRIVATE_KEY)
    sshOptions.privateKey = Buffer.from(
      process.env.SSH_PRIVATE_KEY.replace(/\\n/g, "\n")
    );

  const forwardOptions = {
    dstAddr: process.env.SSH_DST_HOST || "127.0.0.1",
    dstPort: Number(process.env.SSH_DST_PORT || 5432)
  };

  try {
    const [server] = await createTunnel(tunnelOptions, serverOptions, sshOptions, forwardOptions);
    sshTunnel = server;
    tunnelPort = localPort;
    return localPort;
  } catch (err) {
    console.error("Failed to create SSH tunnel:", err);
    throw err;
  }
}

/** Initialize Prisma (and the SSH tunnel if configured) */
export async function connectDb(): Promise<PrismaClientType> {
  if (prisma) return prisma;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL not set");

  // Start tunnel if requested and rewrite DATABASE_URL to localhost:<tunnelPort>
  const lp = await startSshTunnel();
  if (lp > 0) {
    try {
      const u = new URL(process.env.DATABASE_URL);
      u.hostname = "127.0.0.1";
      u.port = String(lp);
      process.env.DATABASE_URL = u.toString();
      console.info(
        `SSH tunnel active → localhost:${lp} ↔ ${process.env.SSH_HOST}:${process.env.SSH_DST_PORT || 5432}`
      );
    } catch (e) {
      throw new Error(
        `Invalid DATABASE_URL (${process.env.DATABASE_URL}): ${(e as Error).message}`
      );
    }
  }

  // Keep pool modest; adjust via PRISMA_* envs if needed
  prisma = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL } },
  });

  await prisma.$connect();
  // quick sanity ping
  await prisma.$queryRaw`SELECT 1`;
  console.info("Prisma connected");
  return prisma;
}

/** Return the singleton Prisma client (ensure connectDb() was called first) */
export function getPrisma(): PrismaClientType {
  if (!prisma) throw new Error("Prisma not initialized — call connectDb() first");
  return prisma;
}

/** Close Prisma and the SSH tunnel */
export async function disconnectDb(): Promise<void> {
  try {
    if (prisma) await prisma.$disconnect();
  } finally {
    prisma = null;
  }
  try {
    if (sshTunnel && typeof sshTunnel.close === "function") sshTunnel.close();
  } finally {
    sshTunnel = null;
    tunnelPort = null;
  }
}

// Graceful shutdown
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    try {
      await disconnectDb();
    } finally {
      process.exit(0);
    }
  });
}

export default getPrisma;