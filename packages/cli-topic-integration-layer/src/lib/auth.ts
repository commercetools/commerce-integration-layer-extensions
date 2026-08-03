// The auth-plugin wiring this topic hands to `configureAuth`, mirroring the host CLI's
// `providers.ts` (`@commercetools/cli`) verbatim: a `client_credentials` authentication
// manager (which re-mints an access token from the stored client id/secret when the old
// one lapses) and a `FileBasedAuthenticationRepository` over the shared
// `~/.commercetools/credentials` file `commercetools auth login` writes. The prerun hook
// (`hooks/authentication.ts`) is what actually calls these; see its header for why the
// topic has to do this itself instead of inheriting the host's copy.
//
// We reproduce those ~15 lines rather than import the host's, because they are NOT
// available as a supported API. `@commercetools/cli` re-exports only `run` from its entry
// (`src/index.ts`) — its `providers.ts` is private application wiring. The functions are
// reachable solely by deep-importing compiled internals
// (`@commercetools/cli/dist/providers.js`), which resolves only because that package
// happens to declare no `exports` map — an unversioned path that can vanish on any patch.
// Doing so would also invert the dependency graph: a topic pulling in the host CLI
// *application* (a `bin` package) to reuse two factories. The classes composed below —
// `CtpAuthenticationManager`, `CtpHttpAuthClient`, `FileBasedAuthenticationRepository`,
// `CtpClientAuthenticationToken` — ARE the public exports of `@commercetools/cli-plugin-auth`
// (the dependency we already declare), so composing them here is the supported path, not a
// workaround: it is exactly what the host's `providers.ts` does, against the same public API.

import os from "node:os";
import path from "node:path";

import {
  CtpAuthenticationManager,
  CtpClientAuthenticationToken,
  CtpHttpAuthClient,
  FileBasedAuthenticationRepository,
  type AuthenticationManager,
  type AuthenticationRepository,
} from "@commercetools/cli-plugin-auth";

/**
 * Where `commercetools auth login` persists the serialized principal, and the auth id it
 * files the client-credentials token under. These mirror the host CLI's `providers.ts`
 * (`@commercetools/cli`) — the on-disk credentials contract — verbatim.
 */
const CREDENTIALS_FILE = path.join(os.homedir(), ".commercetools", "credentials");
const CLIENT_CREDENTIALS_AUTH_ID = "client-credentials";

/** The `client_credentials` manager that re-mints an access token from the stored secret. */
export function provideAuthenticationManager(): AuthenticationManager {
  return new CtpAuthenticationManager(new CtpHttpAuthClient());
}

/** The repository over the shared credentials file, wired to (de)serialize the login. */
export function provideAuthenticationRepository(): AuthenticationRepository {
  const repository = new FileBasedAuthenticationRepository(CREDENTIALS_FILE);
  repository.addSerializable(
    CLIENT_CREDENTIALS_AUTH_ID,
    CtpClientAuthenticationToken,
    CtpClientAuthenticationToken.Serializable,
  );
  return repository;
}
