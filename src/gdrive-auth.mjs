/**
 * gdrive-auth.mjs
 *
 * Helper to resolve a valid Google Drive access token, automatically
 * refreshing if a refresh token is supplied.
 */

export async function resolveAccessToken({ accessToken, refreshToken, clientId, clientSecret }) {
  if (accessToken) return accessToken;

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
    'No valid Google Drive auth found. Provide DRIVE_ACCESS_TOKEN or (DRIVE_REFRESH_TOKEN + DRIVE_CLIENT_ID + DRIVE_CLIENT_SECRET).'
  );
}
