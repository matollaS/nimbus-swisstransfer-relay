/**
 * swisstransfer-resolver.mjs
 *
 * Resolves a SwissTransfer share link into direct, tokenized download URLs.
 *
 * There is no official SwissTransfer API. This reconstructs the flow used
 * by community reverse-engineering projects: fetch container info for the
 * transfer, then request a per-file download token, then build the direct
 * download URL. Treat this as best-effort — Infomaniak can change these
 * endpoints without notice, and there's no SLA to rely on.
 *
 * IMPORTANT: verify the endpoint paths below against a live browser network
 * trace before trusting this in production. The paths here are a reasonable
 * reconstruction, not a confirmed-current spec.
 */

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

export class SwissTransferResolveError extends Error {}

function extractTransferId(shareUrl) {
  const m = shareUrl.match(/\/(?:d|dl)\/([a-zA-Z0-9-]+)/);
  if (m) return m[1];
  const trimmed = shareUrl.trim();
  if (/^[a-zA-Z0-9-]{8,}$/.test(trimmed)) return trimmed;
  return null;
}

function authHeaders(password) {
  const headers = { 'User-Agent': USER_AGENT, 'Accept': 'application/json, text/plain, */*' };
  if (password) headers['Authorization'] = Buffer.from(password, 'utf8').toString('base64');
  return headers;
}

async function getLinkDetails(transferId, password) {
  const res = await fetch(`https://www.swisstransfer.com/api/1/links/${transferId}?with=transfer`, {
    headers: authHeaders(password),
  });

  if (res.status === 401 || res.status === 403) {
    throw new SwissTransferResolveError(
      'This transfer needs a password (or the password given was wrong).'
    );
  }
  if (!res.ok) {
    throw new SwissTransferResolveError(
      `Couldn't reach SwissTransfer for this link (HTTP ${res.status}). It may have expired.`
    );
  }

  const data = await res.json();
  const files = data?.data?.transfer?.files;

  if (!files?.length) {
    throw new SwissTransferResolveError(
      'Unexpected response shape from SwissTransfer — their API may have changed or transfer has no files.'
    );
  }

  return files;
}

async function getDownloadUrl(transferId, fileId, password) {
  const res = await fetch(
    `https://www.swisstransfer.com/api/1/links/${transferId}/files/${fileId}`,
    { headers: authHeaders(password) }
  );

  if (!res.ok) {
    throw new SwissTransferResolveError(
      `Failed to get a download URL (HTTP ${res.status}) — the transfer may have expired or hit its download limit.`
    );
  }

  const data = await res.json();
  const url = data?.data?.url;
  if (!url) throw new SwissTransferResolveError('Empty download URL returned by SwissTransfer.');
  return url;
}

/**
 * @param {string} shareUrl
 * @param {string|null} [password]
 * @returns {Promise<Array<{fileName: string, size: number, url: string}>>}
 */
export async function resolveSwissTransfer(shareUrl, password = null) {
  const transferId = extractTransferId(shareUrl);
  if (!transferId) {
    throw new SwissTransferResolveError('Could not parse a transfer ID from that link.');
  }

  const files = await getLinkDetails(transferId, password);

  const resolved = [];
  for (const file of files) {
    const url = await getDownloadUrl(transferId, file.id, password);
    resolved.push({
      fileName: file.path || file.name || 'file',
      size: Number(file.size ?? 0),
      url,
    });
  }

  return resolved;
}

