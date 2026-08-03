// THE ONE HACK — and it is deliberately the only one.
//
// Every other topic gets its auth wiring for free: the host CLI's own `init` hook calls
// `configureAuth(...)` and the auth plugin's `prerun` hook fills the in-memory
// `SecurityContextHolder`, after which `AuthCommand` hands commands the logged-in
// principal + a self-refreshing fetch. But that machinery all lives on the HOST's copy of
// `@commercetools/cli-plugin-auth`. When this topic is installed via `oclif plugins
// install` it lands in the oclif data dir with its OWN second copy of that module, whose
// statics the host never touches — so `getAuthentication()` from our commands would read
// an empty context and reject every logged-in caller ("not logged in").
//
// We close that gap here, and ONLY here: this prerun hook configures + fills THIS copy
// from the same on-disk credentials file, resolved through the same bare specifier our
// commands import, so the copy it fills is exactly the copy they read. When the topic is
// instead bundled into the host (a single shared copy) this just re-does the host's work
// idempotently. With this in place `base.ts` is an ordinary `AuthCommand` topic — do NOT
// "simplify" it back to reading credentials off disk by hand.

import { AuthCommand, SecurityContextHolder, configureAuth } from "@commercetools/cli-plugin-auth";
import type { Hook } from "@oclif/core";

import {
  provideAuthenticationManager,
  provideAuthenticationRepository,
} from "../lib/auth.js";

const authentication: Hook.Prerun = async (params) => {
  // Only our own commands need this; leave every other command's context untouched.
  if (!(params.Command.prototype instanceof AuthCommand)) return;

  const authenticationRepository = provideAuthenticationRepository();
  configureAuth({
    authenticationManager: provideAuthenticationManager(),
    authenticationRepository,
  });

  const authentication = await authenticationRepository.loadAuthentication();
  SecurityContextHolder.getContext().setAuthentication(authentication);
};

export default authentication;
