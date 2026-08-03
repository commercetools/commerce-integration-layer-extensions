// Base class for the topic's commands that reach the Commerce Integration Layer's
// `manage_project` boundary. The bearer is the token `commercetools auth login`
// already persisted to `~/.commercetools/credentials`; we read it back from disk
// here rather than from the auth plugin's in-memory security context — see below.
//
// `@commercetools/cli-plugin-auth` holds the security context in a MODULE-LEVEL
// STATIC (`SecurityContextHolder.globalContext`), so there is one context per loaded
// copy of that module. When this topic is bundled into the host CLI it resolves up
// into the host's single copy and the static the host fills is the one we read. But
// when the topic is installed via `oclif plugins install`, it lands in the oclif data
// dir's own node_modules tree, npm auto-installs the declared `cli-plugin-auth` there,
// and Node loads that as a SECOND, distinct module instance. `auth login`'s prerun
// hook (running in the host) fills the HOST copy's static; a read via the inherited
// `getAuthentication()` would hit the DATA-DIR copy's empty static and reject every
// logged-in caller ("not logged in"). This is not hypothetical — it is the exact
// failure mode that a CI symlink-dedupe workaround previously papered over.
//
// The cure is to stop depending on cross-copy static identity. `auth login` serializes
// the full principal (token, region, project key, scope, expiry) to
// `~/.commercetools/credentials` via the host CLI's `FileBasedAuthenticationRepository`.
// We reconstruct it from that same file, from THIS module's own copy of the repository
// — no network, no auth manager, no shared static — so it no longer matters whether one
// or two copies of `cli-plugin-auth` are loaded. Accordingly `cli-plugin-auth` is a
// regular `dependency`, not a peer: a second copy is now harmless. The path, auth id
// (`"client-credentials"`), and serialized shape mirror the host CLI's
// `providers.ts`/`init.ts` wiring exactly.

import os from "node:os";
import path from "node:path";

import { Flags } from "@oclif/core";
import {
  AuthCommand,
  AuthorizationError,
  CtpAuthorizedClient,
  CtpClientAuthenticationToken,
  FileBasedAuthenticationRepository,
} from "@commercetools/cli-plugin-auth";
import { loadLocalEnv } from "./loadLocalEnv.js";

/**
 * Where `commercetools auth login` persists the serialized principal, and the auth id
 * it files the client-credentials token under. These mirror the host CLI's
 * `providers.ts` (`@commercetools/cli`) — the on-disk credentials contract — verbatim.
 */
const CREDENTIALS_FILE = path.join(os.homedir(), ".commercetools", "credentials");
const CLIENT_CREDENTIALS_AUTH_ID = "client-credentials";

/**
 * A `FileBasedAuthenticationRepository` over the shared credentials file, wired to
 * deserialize the client-credentials principal. Constructed from THIS module's copy of
 * `cli-plugin-auth`, so `loadAuthentication()` reconstructs the principal regardless of
 * how many copies of the auth plugin are loaded (see the header note).
 */
function persistedAuthenticationRepository(
  credentialsFile: string,
): FileBasedAuthenticationRepository {
  const repository = new FileBasedAuthenticationRepository(credentialsFile);
  repository.addSerializable(
    CLIENT_CREDENTIALS_AUTH_ID,
    CtpClientAuthenticationToken,
    CtpClientAuthenticationToken.Serializable,
  );
  return repository;
}

/**
 * Reconstruct the logged-in principal from the persisted credentials file. Returns
 * undefined when no valid client-credentials login is on disk (absent file, or a
 * different auth kind), so unauthorized commands still run. No network. Exported for
 * tests; commands go through {@link IntegrationLayerCommand.requirePrincipal}.
 */
export async function loadPersistedPrincipal(
  credentialsFile: string = CREDENTIALS_FILE,
): Promise<CtpAuthorizedClient | undefined> {
  const authentication = await persistedAuthenticationRepository(credentialsFile).loadAuthentication();
  const principal = authentication?.getPrincipal();
  return principal instanceof CtpAuthorizedClient ? principal : undefined;
}

/** The resolved, ready-to-use integration-layer context: where to call and as whom. */
export interface IlContext {
  /** The integration-layer edge base URL, trailing slashes trimmed. */
  baseUrl: string;
  projectKey: string;
  /** The logged-in principal's commercetools access token (the `manage_project` bearer). */
  token: string;
}

/** The subset of parsed flags {@link IntegrationLayerCommand.resolveIlContext} reads. */
export interface IlFlagValues {
  "integration-layer-url"?: string;
  "project-key"?: string;
}

/**
 * Derive the integration-layer EXTENSIONS edge base URL from the authenticated
 * principal's commercetools region. The extensions edge serves the CLI's
 * `/<project>/subgraph` + `/<project>/extension/*` routes and follows the same host
 * convention as the commercetools API itself
 * (`<svc>.<region>.commercetools.com`, cf. the auth client's
 * `auth.<region>.commercetools.com`), so a login in region `eu-central-1.aws`
 * resolves to `https://extensions.integration-layer.eu-central-1.aws.commercetools.com`
 * (the production host). `--integration-layer-url` / `INTEGRATION_LAYER_URL` stays
 * the explicit override — e.g. to point at a local edge, or at a non-production zone
 * that doesn't follow the convention. Returns undefined
 * only when the region is absent, so resolveIlContext then fails loudly.
 */
export function edgeUrlForRegion(region: string): string | undefined {
  const trimmed = region.trim();
  if (!trimmed) return undefined;
  return `https://extensions.integration-layer.${trimmed}.commercetools.com`;
}

/**
 * The GRAPHQL edge (the integration-router) for a region — where operations are
 * actually served, at `/{project}/graphql`. A distinct host from the extensions
 * edge above: the extensions edge serves the manage_project routes, the graphql edge
 * is the router. `--graphql-url` / `IL_GRAPHQL_URL` overrides it
 * for non-production zones, which don't follow the convention.
 */
export function graphqlEdgeUrlForRegion(region: string): string | undefined {
  const trimmed = region.trim();
  if (!trimmed) return undefined;
  return `https://graphql.integration-layer.${trimmed}.commercetools.com`;
}

/**
 * The IDENTITY edge for a region — where sessions are minted, at
 * `POST /{project}/session`. Again a distinct host from both of the above: shopper
 * identity, shopper GraphQL, and the machine surface are served on separate
 * ingresses. `--auth-url` / `IL_AUTH_URL` overrides it.
 */
export function authEdgeUrlForRegion(region: string): string | undefined {
  const trimmed = region.trim();
  if (!trimmed) return undefined;
  return `https://auth.integration-layer.${trimmed}.commercetools.com`;
}

export abstract class IntegrationLayerCommand extends AuthCommand {
  /**
   * Whether the command needs a logged-in principal. True for every command that
   * calls the Commerce Integration Layer; a command that only conditionally reaches it (e.g.
   * `serve` in standalone mode) sets this false and relies on {@link resolveIlContext}
   * to fail loudly if the network path is actually taken.
   */
  protected authorized = true;

  /**
   * The principal loaded from `~/.commercetools/credentials` in {@link init}, or
   * undefined when no valid login is persisted. Resolved once per command run so the
   * synchronous {@link requirePrincipal} call sites (here and in `explore`) are unchanged.
   */
  private persistedPrincipal?: CtpAuthorizedClient;

  static override baseFlags = {
    "env-file": Flags.string({
      description:
        "dotenv file to load before the command runs (default: .env in the cwd, if present); does not override variables already set in the environment",
      helpGroup: "GLOBAL",
    }),
    "integration-layer-url": Flags.string({
      description:
        "integration-layer extensions edge base URL (also settable via INTEGRATION_LAYER_URL); overrides the URL derived from your login region",
      env: "INTEGRATION_LAYER_URL",
      helpGroup: "COMMERCE INTEGRATION LAYER",
    }),
    "project-key": Flags.string({
      description: "override the logged-in project key",
      helpGroup: "COMMERCE INTEGRATION LAYER",
    }),
  };

  protected override async init(): Promise<void> {
    // Before oclif resolves flag `env:` bindings (and before `serve` reads
    // EXTENSION_CONFIG_*), so a project `.env` / `--env-file` actually takes effect.
    loadLocalEnv();
    await super.init();
    this.persistedPrincipal = await this.loadPersistedPrincipal();
    if (this.authorized) this.requirePrincipal();
  }

  /**
   * Read the persisted login from `~/.commercetools/credentials`. Returns undefined when
   * no login is on disk (so unauthorized commands like standalone `serve` still run) and
   * only fails loudly when the file is present but malformed. No network — the token was
   * already minted by `auth login` and serialized whole.
   */
  private async loadPersistedPrincipal(): Promise<CtpAuthorizedClient | undefined> {
    return loadPersistedPrincipal();
  }

  /** The logged-in commercetools principal, or an `AuthorizationError` pointing at `auth login`. */
  protected requirePrincipal(): CtpAuthorizedClient {
    if (this.persistedPrincipal) return this.persistedPrincipal;
    throw new AuthorizationError("not logged in — run `commercetools auth login` first");
  }

  /**
   * Resolve the integration-layer base URL + project key from the login context and
   * take the principal's access token as the bearer. Fails loudly (no defensive
   * defaults) when a required value is absent.
   */
  protected async resolveIlContext(flags: IlFlagValues): Promise<IlContext> {
    const principal = this.requirePrincipal();
    const token = principal.getAccessToken().getTokenValue();

    const projectKey = flags["project-key"] ?? principal.getProjectKey();
    if (!projectKey) {
      throw new Error(
        "no project key — log in with `commercetools auth login --project-key <key>` or pass --project-key",
      );
    }

    const baseUrl = flags["integration-layer-url"] ?? edgeUrlForRegion(principal.getRegion());
    if (!baseUrl) {
      throw new Error(
        "could not resolve the Commerce Integration Layer URL: pass --integration-layer-url or set " +
          "INTEGRATION_LAYER_URL (the extensions edge base, e.g. " +
          "https://extensions.integration-layer.eu-central-1.aws.commercetools.com)",
      );
    }

    return { baseUrl: baseUrl.replace(/\/+$/, ""), projectKey, token };
  }
}
