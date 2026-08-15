/**
 * gdrive-auth.mjs
 *
 * Helper to resolve a valid Google Drive access token using:
 * 1. Direct Access Token (short-lived)
 * 2. Service Account Key (persistent, hands-free)
 * 3. OAuth Refresh Token (persistent)
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export async function resolveAccessToken({
  accessToken,
  refreshToken,
  clientId,
  clientSecret,
  serviceAccountKey,
  serviceAccountKeyPath,
}) {
  // 1. Direct Access Token
  if (accessToken) return accessToken;

  // 2. Service Account Key (File Path or JSON string or GOOGLE_APPLICATION_CREDENTIALS)
  const keyPath = serviceAccountKeyPath || process.env.GOOGLE_APPLICATION_CREDENTIALS;
  let saData = null;

  if (serviceAccountKey) {
    try {
      saData = typeof serviceAccountKey === 'string' ? JSON.parse(serviceAccountKey) : serviceAccountKey;
    } catch {}
  } else if (keyPath && fs.existsSync(keyPath)) {
    try {
      saData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
    } catch {}
  }

  if (saData?.client_email && saData?.private_key) {
    return await getAccessTokenFromServiceAccount(saData.client_email, saData.private_key);
  }

  // 3. OAuth Refresh Token
  if (refreshToken && clientId && clientSecret) {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(`Failed to refresh Google OAuth token: ${data.error_description || data.error || res.status}`);
    }
    return data.access_token;
  }

  throw new Error(
    'No valid Google Drive auth found. Provide DRIVE_ACCESS_TOKEN, GOOGLE_APPLICATION_CREDENTIALS, or (DRIVE_REFRESH_TOKEN + DRIVE_CLIENT_ID + DRIVE_CLIENT_SECRET).'
  );
}

async function getAccessTokenFromServiceAccount(clientEmail, privateKey) {
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 3600;

  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const claimSet = Buffer.from(
    JSON.stringify({
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/drive.file',
      aud: 'https://oauth2.googleapis.com/token',
      exp,
      iat,
    })
  ).toString('base64url');

  const signInput = `${header}.${claimSet}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signInput);
  const signature = signer.sign(privateKey, 'base64url');

  const jwt = `${signInput}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Service Account Auth Error: ${data.error_description || data.error || res.status}`);
  }
  return data.access_token;
}
