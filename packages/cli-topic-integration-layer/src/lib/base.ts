// Base class for the topic's commands that reach the integration layer's
// `manage_project` boundary. It extends the host CLI's `AuthCommand`
// (`@commercetools/cli-plugin-auth`), so the bearer is the token
// `commercetools auth login` already persisted to `~/.commercetools/credentials`
// (loaded into the security context by the auth plugin's prerun hook) — no separate
// credential handling, exactly as the `connect` topic does.
//
// `@commercetools/cli-plugin-auth` is a PEER dependency: at runtime the plugin uses
// the HOST CLI's copy, so the static auth manager/repository the host wires up are
// the same singletons this class reads (a bundled second copy would see an empty
// security context and reject every logged-in caller).

import { Flags } from "@oclif/core";
import {
  AuthCommand,
  AuthorizationError,
  CtpAuthorizedClient,
} from "@commercetools/cli-plugin-auth";

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
 * principal's commercetools region. The extensions edge — the connector-backend pod
 * that serves the CLI's `/<project>/subgraph` + `/<project>/extension/*` routes —
 * follows the same host convention as the commercetools API itself
 * (`<svc>.<region>.commercetools.com`, cf. the auth client's
 * `auth.<region>.commercetools.com`), so a login in region `eu-central-1.aws`
 * resolves to `https://extensions.integration-layer.eu-central-1.aws.commercetools.com`
 * (the production host). `--integration-layer-url` / `INTEGRATION_LAYER_URL` stays
 * the explicit override — e.g. to point at a local edge or a staging edge on the
 * escemo/stage zone, which don't follow the production convention. Returns undefined
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
 * edge above: the extensions edge is the connector backend (manage_project routes),
 * the graphql edge is the router. `--graphql-url` / `IL_GRAPHQL_URL` overrides it
 * for staging zones, which don't follow the production convention.
 */
export function graphqlEdgeUrlForRegion(region: string): string | undefined {
  const trimmed = region.trim();
  if (!trimmed) return undefined;
  return `https://graphql.integration-layer.${trimmed}.commercetools.com`;
}

/**
 * The IDENTITY edge (the storefront pod) for a region — where sessions are minted,
 * at `POST /{project}/session`. Again a distinct host from both of the above; the
 * four-pod split put shopper identity, shopper GraphQL, and the machine surface on
 * separate ingresses. `--auth-url` / `IL_AUTH_URL` overrides it.
 */
export function authEdgeUrlForRegion(region: string): string | undefined {
  const trimmed = region.trim();
  if (!trimmed) return undefined;
  return `https://auth.integration-layer.${trimmed}.commercetools.com`;
}

export abstract class IntegrationLayerCommand extends AuthCommand {
  /**
   * Whether the command needs a logged-in principal. True for every command that
   * calls the integration layer; a command that only conditionally reaches it (e.g.
   * `serve` in standalone mode) sets this false and relies on {@link resolveIlContext}
   * to fail loudly if the network path is actually taken.
   */
  protected authorized = true;

  static override baseFlags = {
    "integration-layer-url": Flags.string({
      description:
        "integration-layer extensions edge base URL (also settable via INTEGRATION_LAYER_URL); overrides the URL derived from your login region",
      env: "INTEGRATION_LAYER_URL",
      helpGroup: "INTEGRATION LAYER",
    }),
    "project-key": Flags.string({
      description: "override the logged-in project key",
      helpGroup: "INTEGRATION LAYER",
    }),
  };

  protected override async init(): Promise<void> {
    await super.init();
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
        "could not resolve the integration layer URL: pass --integration-layer-url or set " +
          "INTEGRATION_LAYER_URL (the extensions edge base, e.g. " +
          "https://extensions.integration-layer.eu-central-1.aws.commercetools.com)",
      );
    }

    return { baseUrl: baseUrl.replace(/\/+$/, ""), projectKey, token };
  }
}
