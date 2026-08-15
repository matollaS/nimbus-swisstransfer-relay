/**
 * drive-resumable-upload.mjs
 *
 * True chunked resumable upload to Google Drive. This is the piece that
 * matters at 8GB+ file sizes: a single multi-hour PUT has no recovery if
 * the connection drops. Here, every chunk is a separate PUT with a
 * Content-Range header, and on any failure — upload-side or source-side —
 * we probe Drive for the actual committed byte offset and resume from
 * there instead of restarting the whole transfer.
 */

const CHUNK_SIZE = 32 * 1024 * 1024; // 32MiB — must be a multiple of 256KiB per Drive's spec

export class DriveUploadError extends Error {}

/** Starts a resumable upload session and returns the session URI. */
export async function startResumableSession(accessToken, fileName, parentId = 'root') {
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({ name: fileName, parents: [parentId] }),
  });

  if (!res.ok) throw new DriveUploadError(`Failed to init GDrive upload session (HTTP ${res.status})`);

  const uploadUri = res.headers.get('location');
  if (!uploadUri) throw new DriveUploadError('Drive did not return a resumable session URI');
  return uploadUri;
}

/**
 * Asks Drive how many bytes it has actually committed for this session.
 * Returns the next byte offset to resume from, or null if upload is complete.
 */
export async function probeCommittedOffset(uploadUri, totalSize) {
  const res = await fetch(uploadUri, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${totalSize}` },
  });

  if (res.status === 200 || res.status === 201) return null; // already complete
  if (res.status === 308) {
    const range = res.headers.get('range'); // e.g. "bytes=0-12345678"
    if (!range) return 0;
    const end = parseInt(range.split('-')[1], 10);
    return end + 1;
  }
  throw new DriveUploadError(`Unexpected status probing upload offset: ${res.status}`);
}

/**
 * Streams a remote file into an existing Drive resumable session in fixed
 * chunks, resuming from the last confirmed byte on any failure.
 *
 * @param {string} uploadUri  Drive's resumable session URI
 * @param {(start:number, length:number) => Promise<Response>} openSourceRange
 *        Opens a Range GET on the source for [start, start+length).
 * @param {number} totalSize
 * @param {(uploadedBytes:number) => void} [onProgress]
 */
export async function streamToDrive(uploadUri, openSourceRange, totalSize, onProgress) {
  let offset = 0;
  const maxRetries = 8;

  while (offset < totalSize) {
    const length = Math.min(CHUNK_SIZE, totalSize - offset);
    let chunk;

    // Fetch this chunk from source, with its own retry loop
    let attempt = 0;
    for (;;) {
      try {
        chunk = await readRange(openSourceRange, offset, length);
        break;
      } catch (err) {
        attempt++;
        if (attempt > maxRetries) throw err;
        await backoff(attempt);
      }
    }

    const end = offset + chunk.length - 1;

    let putRes;
    try {
      putRes = await fetch(uploadUri, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${offset}-${end}/${totalSize}`,
        },
        body: chunk,
      });
    } catch {
      // network drop mid-PUT — ask Drive what it actually has, resume from there
      offset = (await probeCommittedOffset(uploadUri, totalSize)) ?? totalSize;
      continue;
    }

    if (putRes.status === 308) {
      offset = end + 1;
      onProgress?.(offset);
      continue;
    }
    if (putRes.status === 200 || putRes.status === 201) {
      onProgress?.(totalSize);
      return await putRes.json();
    }
    if (putRes.status >= 500) {
      // transient server error — probe and resume rather than failing the job
      offset = (await probeCommittedOffset(uploadUri, totalSize)) ?? offset;
      continue;
    }
    throw new DriveUploadError(`Drive rejected chunk at offset ${offset}: HTTP ${putRes.status}`);
  }
}

async function readRange(openSourceRange, start, length) {
  const res = await openSourceRange(start, length);
  if (!res.ok && res.status !== 206) {
    throw new Error(`Source fetch failed at byte ${start}: HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const buf = Buffer.alloc(length);
  let filled = 0;
  while (filled < length) {
    const { done, value } = await reader.read();
    if (done) break;
    const toCopy = Math.min(value.length, length - filled);
    buf.set(value.subarray(0, toCopy), filled);
    filled += toCopy;
  }
  reader.cancel().catch(() => {});
  return filled === length ? buf : buf.subarray(0, filled);
}

function backoff(attempt) {
  const ms = Math.min(30_000, 500 * 2 ** attempt);
  return new Promise((resolve) => setTimeout(resolve, ms));
}
