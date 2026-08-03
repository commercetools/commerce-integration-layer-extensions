// Base class for the topic's commands that reach the Commerce Integration Layer's
// `manage_project` boundary. An ordinary `AuthCommand` topic: the logged-in principal
// comes from the inherited `getAuthentication()` (the security context our prerun hook
// fills — see `hooks/authentication.ts`), and outbound calls go through a
// `CtpAuthFetchFactory` fetch that injects the bearer and transparently refreshes/retries
// it, exactly like the `connect` topic. There is no bespoke credential reading here; the
// one topic-specific concession is the prerun hook.

import { Flags } from "@oclif/core";
import {
  AuthCommand,
  AuthorizationError,
  CtpAuthFetchFactory,
  CtpAuthorizedClient,
} from "@commercetools/cli-plugin-auth";
import { loadLocalEnv } from "./loadLocalEnv.js";

/** The resolved, ready-to-use integration-layer context: where to call and as whom. */
export interface IlContext {
  /** The integration-layer edge base URL, trailing slashes trimmed. */
  baseUrl: string;
  projectKey: string;
  /**
   * Authenticated fetch bound to the logged-in `manage_project` principal — it injects
   * the bearer and transparently refreshes/retries it (`CtpAuthFetchFactory`). Hand it
   * straight to the `ilClient` calls in place of a raw token.
   */
  authFetch: typeof fetch;
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
   * Authenticated fetch for the `manage_project` boundary — injects the bearer and
   * refreshes/retries it. Built once in {@link init} (after the prerun hook has
   * configured the auth plugin + filled the security context).
   */
  protected authFetch!: typeof fetch;

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
    // The prerun hook has configured the auth plugin + filled this copy's security
    // context by now, so the inherited accessors resolve as in any other topic.
    this.authFetch = new CtpAuthFetchFactory(
      this.getAuthenticationManager(),
      this.getAuthenticationRepository(),
    ).create();
    if (this.authorized) this.requirePrincipal();
  }

  /** The logged-in commercetools principal, or an `AuthorizationError` pointing at `auth login`. */
  protected requirePrincipal(): CtpAuthorizedClient {
    const principal = this.getAuthentication()?.getPrincipal();
    if (principal instanceof CtpAuthorizedClient) return principal;
    throw new AuthorizationError("not logged in — run `commercetools auth login` first");
  }

  /**
   * Resolve the integration-layer base URL + project key from the login context and
   * hand back the authenticated fetch as the bearer. Fails loudly (no defensive
   * defaults) when a required value is absent.
   */
  protected async resolveIlContext(flags: IlFlagValues): Promise<IlContext> {
    const principal = this.requirePrincipal();

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

    return { baseUrl: baseUrl.replace(/\/+$/, ""), projectKey, authFetch: this.authFetch };
  }
}
