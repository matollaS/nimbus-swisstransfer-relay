# nimbus-swisstransfer-relay

Streams files from a SwissTransfer share link directly into Google Drive —
no local disk, no local bandwidth. Built for files well above WeTransfer's
old free-tier size limits (SwissTransfer allows up to 50GB free).

## Why this is different from a WeTransfer→Drive clone

- **No official SwissTransfer API.** `src/swisstransfer-resolver.mjs`
  reconstructs the container/token flow used by community reverse-engineering
  projects. Verify the endpoint paths against a live browser trace before
  relying on this in production — Infomaniak can change them without notice.
- **Real resumability, not just a long timeout.** At 8GB+ sizes, a transfer
  that runs for tens of minutes to hours *will* hit a dropped connection
  eventually. `src/drive-resumable-upload.mjs` uploads in 32MiB chunks and,
  on any failure, probes Drive for the actual last-committed byte before
  resuming — so a drop at 45GB doesn't mean restarting from zero.
- **Per-user OAuth, not a shared service account.** Each transfer should
  authenticate against the requesting user's own Drive (`accessToken` is
  passed in per-call) so Google's daily upload quotas are per-user, not
  shared across all your users.

## Usage

```bash
npm install
DRIVE_ACCESS_TOKEN=ya29.xxx node src/cli.mjs "https://www.swisstransfer.com/dl/<id>" [password]
```

### Authentication Methods:

1. **Direct Access Token**: Pass `DRIVE_ACCESS_TOKEN=ya29.xxx` (Google OAuth access token with `drive.file` scope).
2. **Persistent Auto-Refresh via `.env`**: Create a `.env` file with:
   ```env
   DRIVE_CLIENT_ID=your_google_client_id
   DRIVE_CLIENT_SECRET=your_google_client_secret
   DRIVE_REFRESH_TOKEN=your_google_refresh_token
   ```
   The CLI will automatically refresh and fetch a valid access token on execution.


## What's not handled yet

- Multi-file transfers where the total across all files exceeds available
  memory pressure isn't a concern (streaming is chunked throughout), but
  large file *counts* in one transfer are processed sequentially — worth
  parallelizing with a small concurrency cap if that matters for your use case.
- No queue/job-persistence layer. This runs a transfer to completion in one
  process invocation; wrap it in a queue (BullMQ, a cron-polled DB table,
  etc.) if you want transfers to survive a process restart mid-file rather
  than just mid-chunk.
- No SSRF/host validation on the resolved SwissTransfer URL before fetching
  it. The PHP version of this had an explicit private-IP-range check on the
  source URL — worth porting that same check here before this touches
  untrusted user-submitted links in production.
