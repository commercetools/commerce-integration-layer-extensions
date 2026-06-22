// Shared commercetools auth helpers for the push + remote-validate tools. Both
// authenticate to the integration layer as a CT API client carrying
// `manage_project:<projectKey>`. The project + creds come from the shared `.env`.

/** Read a required env var or exit with a pointer to `.env.example`. */
export function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`${name} is not set (see .env.example)\n`);
    process.exit(1);
  }
  return value;
}

/** Mint a CT access token carrying `manage_project:<projectKey>`. */
export async function mintManageProjectToken(
  authUrl: string,
  clientId: string,
  clientSecret: string,
  projectKey: string,
): Promise<string> {
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetch(`${authUrl.replace(/\/+$/, '')}/oauth/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: `manage_project:${projectKey}`,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`commercetools token request failed (${res.status}): ${text}`);
  }
  const json = JSON.parse(text) as { access_token?: string };
  if (!json.access_token) {
    throw new Error('commercetools token response had no access_token');
  }
  return json.access_token;
}
