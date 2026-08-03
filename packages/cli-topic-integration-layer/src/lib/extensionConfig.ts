/** Prefix for local-dev env vars that feed `ctx.config` (see `loadLocalEnv` / `.env`). */
export const EXTENSION_CONFIG_PREFIX = "EXTENSION_CONFIG_";

/**
 * Project the `EXTENSION_CONFIG_<KEY>` entries of an env-shaped record into the
 * `ctx.config` map the runtime injects — `EXTENSION_CONFIG_ALGOLIA_API_KEY=…` becomes
 * `ALGOLIA_API_KEY`. Locally there is no Commerce Integration Layer to read the
 * project's stored config from, so `serve` sources it from the environment and any
 * `.env` / `--env-file`. Keys with an empty remainder (bare `EXTENSION_CONFIG_`) are
 * dropped.
 */
export function extensionConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(EXTENSION_CONFIG_PREFIX) || typeof value !== "string") continue;
    const name = key.slice(EXTENSION_CONFIG_PREFIX.length);
    if (name) config[name] = value;
  }
  return config;
}

/**
 * Parse `--config KEY=VALUE` pairs into a `ctx.config` map; a later pair wins on the
 * same key. A pair without a `=` (or with an empty key) is skipped. Used by
 * `invoke-api-extension` to overlay explicit flags on top of the environment / `.env`.
 */
export function extensionConfigFromPairs(pairs: readonly string[]): Record<string, string> {
  const config: Record<string, string> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq > 0) config[pair.slice(0, eq)] = pair.slice(eq + 1);
  }
  return config;
}
