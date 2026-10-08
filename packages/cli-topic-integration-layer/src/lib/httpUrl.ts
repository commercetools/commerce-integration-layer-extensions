/**
 * Whether `value` is an absolute http(s) URL without embedded credentials — the check the
 * Commerce Integration Layer applies to the IdP's token, revocation and JWKS endpoints.
 * `fetch` refuses a URL with credentials, so one stored anyway would only fail on the
 * first shopper's login.
 */
export function isHttpUrlWithoutCredentials(value: string): boolean {
  try {
    const { protocol, username, password } = new URL(value);
    return (protocol === "http:" || protocol === "https:") && username === "" && password === "";
  } catch {
    return false;
  }
}
