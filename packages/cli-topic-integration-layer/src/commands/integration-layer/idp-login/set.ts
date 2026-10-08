import { Flags } from "@oclif/core";
import {
  getIdpConfig,
  putIdpConfig,
  type IdpClaimMapping,
  type IdpConfigInput,
} from "../../../lib/ilClient.js";
import { isHttpUrlWithoutCredentials } from "../../../lib/httpUrl.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

// What the Merchant Center form pre-fills for a project with no IdP yet.
const DEFAULT_CLAIMS: IdpClaimMapping = {
  externalId: "sub",
  email: "email",
  firstName: "given_name",
  lastName: "family_name",
  phone: "phone_number",
};

const REQUIRED = [
  "issuer",
  "token-endpoint",
  "revocation-endpoint",
  "jwks-uri",
  "client-id",
  "redirect-uri",
] as const;

export default class IdpLoginSet extends IntegrationLayerCommand {
  static override description =
    "Create or update the project's external OpenID Connect identity provider (IdP login); on an existing configuration only the fields you pass change";

  static override examples = [
    "<%= config.bin %> integration-layer idp-login set --issuer https://idp.example.com --token-endpoint https://idp.example.com/token --revocation-endpoint https://idp.example.com/revoke --jwks-uri https://idp.example.com/jwks --client-id abc --client-secret s3cret --redirect-uri https://shop.example.com/callback",
    "<%= config.bin %> integration-layer idp-login set --match-strategy email",
    "IDP_CLIENT_SECRET=s3cret <%= config.bin %> integration-layer idp-login set --client-id new-id",
  ];

  static override flags = {
    issuer: Flags.string({ description: "issuer (iss) of the identity provider" }),
    "token-endpoint": Flags.string({ description: "token endpoint URL" }),
    "revocation-endpoint": Flags.string({ description: "revocation endpoint URL" }),
    "jwks-uri": Flags.string({ description: "JWKS URI" }),
    "authorization-endpoint": Flags.string({
      description: "authorization endpoint URL (optional; pass an empty string to clear)",
    }),
    "client-id": Flags.string({ description: "OAuth client ID" }),
    "client-secret": Flags.string({
      description:
        "OAuth client secret; omit to keep the stored one. Prefer the environment variable — a flag is visible in the process list and shell history",
      env: "IDP_CLIENT_SECRET",
    }),
    "redirect-uri": Flags.string({ description: "redirect URI registered with the provider" }),
    "claim-external-id": Flags.string({ description: "token claim for the customer's externalId (default sub)" }),
    "claim-email": Flags.string({ description: "token claim for the email (default email)" }),
    "claim-first-name": Flags.string({ description: "token claim for the first name (default given_name)" }),
    "claim-last-name": Flags.string({ description: "token claim for the last name (default family_name)" }),
    "claim-phone": Flags.string({ description: "token claim for the phone number (default phone_number)" }),
    "match-strategy": Flags.string({
      description: "how a login is matched to a customer",
      options: ["externalId", "email"],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(IdpLoginSet);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);

    // Trim; a blank value is only meaningful for the optional authorization endpoint.
    const given = (name: keyof typeof flags): string | undefined => {
      const value = flags[name];
      if (typeof value !== "string") return undefined;
      const trimmed = name === "client-secret" ? value : value.trim();
      if (trimmed === "" && name !== "authorization-endpoint" && name !== "client-secret") {
        this.error(`--${name} must not be empty.`);
      }
      return trimmed;
    };

    const current = await getIdpConfig(baseUrl, projectKey, authFetch);

    // Required fields that neither the flags nor the stored configuration supply.
    const have: Record<(typeof REQUIRED)[number], string | undefined> = {
      issuer: given("issuer") ?? current?.issuer,
      "token-endpoint": given("token-endpoint") ?? current?.tokenEndpoint,
      "revocation-endpoint": given("revocation-endpoint") ?? current?.revocationEndpoint,
      "jwks-uri": given("jwks-uri") ?? current?.jwksUri,
      "client-id": given("client-id") ?? current?.clientId,
      "redirect-uri": given("redirect-uri") ?? current?.redirectUri,
    };
    const missing = REQUIRED.filter((name) => !have[name]).map((name) => `--${name}`);
    // The Commerce Integration Layer trims the secret, so a blank one means "not given".
    const secret = given("client-secret")?.trim() ?? "";
    // A first save must supply the secret; an update may keep the stored one.
    if (!current?.hasClientSecret && !secret) {
      missing.push("--client-secret (or IDP_CLIENT_SECRET)");
    }
    if (missing.length > 0) {
      this.error(
        `No IdP login is configured for '${projectKey}' yet; missing required: ${missing.join(", ")}`,
      );
    }

    // The endpoints the Commerce Integration Layer itself calls: refused there if they
    // are not plain http(s) URLs, but only at save time — check them first.
    for (const name of ["token-endpoint", "revocation-endpoint", "jwks-uri"] as const) {
      if (!isHttpUrlWithoutCredentials(have[name]!)) {
        this.error(`--${name} must be an absolute http(s) URL without credentials (got '${have[name]}').`);
      }
    }

    const claims: IdpClaimMapping = { ...(current?.claims ?? DEFAULT_CLAIMS) };
    claims.externalId = given("claim-external-id") ?? claims.externalId;
    claims.email = given("claim-email") ?? claims.email;
    claims.firstName = given("claim-first-name") ?? claims.firstName;
    claims.lastName = given("claim-last-name") ?? claims.lastName;
    claims.phone = given("claim-phone") ?? claims.phone;

    const authorizationEndpoint =
      given("authorization-endpoint") ?? current?.authorizationEndpoint;

    const input: IdpConfigInput = {
      issuer: have.issuer!,
      tokenEndpoint: have["token-endpoint"]!,
      revocationEndpoint: have["revocation-endpoint"]!,
      jwksUri: have["jwks-uri"]!,
      authorizationEndpoint: authorizationEndpoint || undefined,
      clientId: have["client-id"]!,
      // Empty keeps the stored secret.
      clientSecret: secret,
      redirectUri: have["redirect-uri"]!,
      claims,
      matchStrategy:
        (flags["match-strategy"] as IdpConfigInput["matchStrategy"] | undefined) ??
        current?.matchStrategy ??
        "externalId",
    };

    const saved = await putIdpConfig(baseUrl, projectKey, authFetch, input);
    this.log(`✓ ${current ? "updated" : "configured"} IdP login for '${projectKey}'.`);
    this.log(`  issuer:             ${saved.issuer}`);
    this.log(`  client id:          ${saved.clientId}`);
    this.log(`  client secret:      ${saved.hasClientSecret ? "set" : "not set"}`);
    this.log(`  customer matching:  by ${saved.matchStrategy}`);
  }
}
