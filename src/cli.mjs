#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { transferSwissTransferToDrive } from './worker.mjs';
import { resolveAccessToken } from './gdrive-auth.mjs';

// Simple .env parser if .env exists
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const match = line.trim().match(/^([^=]+)=(.*)$/);
    if (match && !process.env[match[1].trim()]) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const [, , shareUrl, password] = process.argv;

if (!shareUrl) {
  console.error('Usage: DRIVE_ACCESS_TOKEN=... node src/cli.mjs <swisstransfer-link> [password]');
  console.error('Or set DRIVE_REFRESH_TOKEN, DRIVE_CLIENT_ID, DRIVE_CLIENT_SECRET in .env or environment.');
  process.exit(1);
}

try {
  const accessToken = await resolveAccessToken({
    accessToken: process.env.DRIVE_ACCESS_TOKEN,
    refreshToken: process.env.DRIVE_REFRESH_TOKEN,
    clientId: process.env.DRIVE_CLIENT_ID,
    clientSecret: process.env.DRIVE_CLIENT_SECRET,
  });

  const results = await transferSwissTransferToDrive({
    shareUrl,
    password: password ?? null,
    accessToken,
    onProgress: ({ fileName, uploaded, total }) => {
      const pct = total ? ((uploaded / total) * 100).toFixed(1) : '?';
      process.stdout.write(`\r${fileName}: ${pct}%   `);
    },
  });

  console.log('\nDone:');
  for (const r of results) console.log(`  ${r.fileName} -> ${r.driveLink}`);
} catch (err) {
  console.error('\nTransfer failed:', err.message);
  process.exit(1);
}
