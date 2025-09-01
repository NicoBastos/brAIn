#!/usr/bin/env node
'use strict';
const fs = require('fs');
const net = require('net');
const path = require('path');

// Load env from repo root .env
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const { createTunnel } = require('tunnel-ssh');
const { PrismaClient } = require('@prisma/client');

/** Pick a free localhost port, starting at `start` */
async function getFreePort(start = 15432) {
  const tryPort = (p) =>
    new Promise((resolve) => {
      const srv = net
        .createServer()
        .once('error', () => resolve(tryPort(p + 1)))
        .once('listening', () => srv.close(() => resolve(p)))
        .listen(p, '127.0.0.1');
    });
  return tryPort(Number(process.env.SSH_LOCAL_PORT || start));
}

/** Start an SSH local-forward if enabled by env. Returns {port, server} where port=-1 means disabled */
async function startSshTunnel() {
  const enabled = process.env.SSH_TUNNEL_ENABLED === 'true' || !!process.env.SSH_HOST;
  if (!enabled) return { port: -1, server: null };

  const localPort = await getFreePort();
  
  // tunnel-ssh v5 uses a different configuration format
  const tunnelOptions = {
    autoClose: true
  };

  const serverOptions = {
    host: '127.0.0.1',
    port: localPort
  };

  const sshOptions = {
    host: process.env.SSH_HOST,
    port: Number(process.env.SSH_PORT || 22),
    username: process.env.SSH_USER
  };

  // Auth
  if (process.env.SSH_PASSWORD) sshOptions.password = process.env.SSH_PASSWORD;
  if (process.env.SSH_PRIVATE_KEY_PATH) sshOptions.privateKey = fs.readFileSync(process.env.SSH_PRIVATE_KEY_PATH);
  if (process.env.SSH_PRIVATE_KEY) sshOptions.privateKey = Buffer.from(process.env.SSH_PRIVATE_KEY.replace(/\\n/g, '\n'));

  const forwardOptions = {
    dstAddr: process.env.SSH_DST_HOST || '127.0.0.1',
    dstPort: Number(process.env.SSH_DST_PORT || 5432)
  };

  try {
    const [server, conn] = await createTunnel(tunnelOptions, serverOptions, sshOptions, forwardOptions);
    console.log(`SSH tunnel established on port ${localPort}`);
    return { port: localPort, server };
  } catch (err) {
    console.error('Failed to create SSH tunnel:', err);
    throw err;
  }

}

(async function main() {
  let tunnelInfo = { port: -1, server: null };
  let prisma;
  try {
    console.log('DB connection test starting...');
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL not set in environment');
    }

    tunnelInfo = await startSshTunnel();
    const tunnelPort = tunnelInfo.port;
    if (tunnelPort > 0) {
      try {
        const u = new URL(process.env.DATABASE_URL);
        u.hostname = '127.0.0.1';
        u.port = String(tunnelPort);
        process.env.DATABASE_URL = u.toString();
        console.info(
          `SSH tunnel active → localhost:${tunnelPort} ↔ ${process.env.SSH_HOST}:${process.env.SSH_DST_PORT || 5432}`
        );
      } catch (e) {
        throw new Error(`Invalid DATABASE_URL (${process.env.DATABASE_URL}): ${e.message}`);
      }
    }

    prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    await prisma.$connect();
    console.log('Prisma connected. Creating test table...');

    // Create table, insert a row, select it, then drop table
    await prisma.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS test_connection (id SERIAL PRIMARY KEY, name TEXT);`
    );
    console.log('Inserting a row...');
    const inserted = await prisma.$queryRawUnsafe(
      `INSERT INTO test_connection (name) VALUES ('test-row') RETURNING id, name;`
    );
    console.log('Insert result:', inserted);

    const rows = await prisma.$queryRawUnsafe(`SELECT * FROM test_connection;`);
    console.log('Select result:', rows);

    console.log('Dropping test table...');
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS test_connection;`);
    console.log('Dropped table.');
  } catch (err) {
    console.error('DB test failed:', err);
    process.exitCode = 1;
  } finally {
    try {
      if (prisma) await prisma.$disconnect();
      console.log('Prisma disconnected.');
    } catch (e) {
      console.error('Error disconnecting Prisma:', e);
    }
    try {
      if (tunnelInfo.server && typeof tunnelInfo.server.close === 'function') {
        tunnelInfo.server.close();
        console.log('SSH tunnel closed.');
      }
    } catch (e) {
      console.error('Error closing SSH tunnel:', e);
    }
  }
})();