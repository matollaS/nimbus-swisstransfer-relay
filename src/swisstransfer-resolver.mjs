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
  const m = shareUrl.match(/\/d\/([a-zA-Z0-9-]+)/);
  if (m) return m[1];
  const trimmed = shareUrl.trim();
  if (/^[a-zA-Z0-9-]{8,}$/.test(trimmed)) return trimmed;
  return null;
}

function authHeaders(password) {
  const headers = { 'User-Agent': USER_AGENT };
  if (password) headers['Authorization'] = Buffer.from(password, 'utf8').toString('base64');
  return headers;
}

async function getContainer(transferId, password) {
  const res = await fetch(`https://www.swisstransfer.com/api/links/${transferId}`, {
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
  const files = data?.data?.container?.files;
  const containerUUID = data?.data?.containerUUID;

  if (!files?.length || !containerUUID) {
    throw new SwissTransferResolveError(
      'Unexpected response shape from SwissTransfer — their API may have changed.'
    );
  }

  return { files, containerUUID };
}

async function getDownloadToken(password, containerUUID, fileUUID) {
  const res = await fetch(
    `https://www.swisstransfer.com/api/download/token/${containerUUID}/${fileUUID}`,
    { headers: authHeaders(password) }
  );

  if (!res.ok) {
    throw new SwissTransferResolveError(
      `Failed to get a download token (HTTP ${res.status}) — the transfer may have expired or hit its download limit.`
    );
  }

  const token = (await res.text()).trim().replace(/^"|"$/g, '');
  if (!token) throw new SwissTransferResolveError('Empty token returned by SwissTransfer.');
  return token;
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

  const { files, containerUUID } = await getContainer(transferId, password);

  const resolved = [];
  for (const file of files) {
    const token = await getDownloadToken(password, containerUUID, file.UUID);
    resolved.push({
      fileName: file.fileName,
      size: Number(file.fileSizeInBytes ?? 0),
      url: `https://dl.swisstransfer.com/api/download/${transferId}/${file.UUID}?token=${token}`,
    });
  }

  return resolved;
}
