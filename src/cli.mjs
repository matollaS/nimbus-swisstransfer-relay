#!/usr/bin/env node
import { transferSwissTransferToDrive } from './worker.mjs';

const [, , shareUrl, password] = process.argv;
const accessToken = process.env.DRIVE_ACCESS_TOKEN;

if (!shareUrl) {
  console.error('Usage: DRIVE_ACCESS_TOKEN=... node src/cli.mjs <swisstransfer-link> [password]');
  process.exit(1);
}
if (!accessToken) {
  console.error('Set DRIVE_ACCESS_TOKEN — this must be a short-lived OAuth token with drive.file scope, obtained separately via a normal OAuth consent flow.');
  process.exit(1);
}

try {
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
