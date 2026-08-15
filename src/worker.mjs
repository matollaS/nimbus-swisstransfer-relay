import { resolveSwissTransfer } from './swisstransfer-resolver.mjs';
import { startResumableSession, streamToDrive } from './drive-resumable-upload.mjs';

/**
 * Transfers every file in a SwissTransfer share link straight into a
 * Google Drive folder — no local disk, no local bandwidth, resumable on
 * failure at any point in either leg.
 *
 * @param {object} opts
 * @param {string} opts.shareUrl
 * @param {string} [opts.password]
 * @param {string} opts.accessToken     Drive OAuth access token, scoped per-user
 * @param {string} [opts.parentId]      Drive folder ID, defaults to root
 * @param {(status: {fileName:string, uploaded:number, total:number}) => void} [opts.onProgress]
 * @returns {Promise<Array<{fileName:string, driveFileId:string, driveLink:string}>>}
 */
export async function transferSwissTransferToDrive({
  shareUrl,
  password = null,
  accessToken,
  parentId = 'root',
  onProgress,
}) {
  const files = await resolveSwissTransfer(shareUrl, password);
  const results = [];

  for (const file of files) {
    const uploadUri = await startResumableSession(accessToken, file.fileName, parentId);

    const openSourceRange = (start, length) =>
      fetch(file.url, {
        headers: { Range: `bytes=${start}-${start + length - 1}` },
      });

    const result = await streamToDrive(uploadUri, openSourceRange, file.size, (uploaded) => {
      onProgress?.({ fileName: file.fileName, uploaded, total: file.size });
    });

    results.push({
      fileName: file.fileName,
      driveFileId: result.id,
      driveLink: `https://drive.google.com/open?id=${result.id}`,
    });
  }

  return results;
}
