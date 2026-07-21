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
 * Resolve the integration-layer edge base URL from the principal's region. Deferred:
 * octolog has no region→edge-host map yet (its single staging edge isn't a per-region
 * production host), so this returns undefined and the URL must come from
 * `--integration-layer-url` / `INTEGRATION_LAYER_URL`. See TODO.md.
 */
function edgeUrlForRegion(_region: string): string | undefined {
  return undefined;
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
        "integration-layer edge base URL (defaults to INTEGRATION_LAYER_URL; else derived from the login region)",
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
          "INTEGRATION_LAYER_URL (the edge base, e.g. " +
          "https://integration-layer.stage.europe-west1.gcp.commercetools.com)",
      );
    }

    return { baseUrl: baseUrl.replace(/\/+$/, ""), projectKey, token };
  }
}
