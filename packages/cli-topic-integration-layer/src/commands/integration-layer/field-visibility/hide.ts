import { Args, Flags } from "@oclif/core";
import {
  assertWithinLimits,
  coordinateKey,
  PUBLISH_PENDING,
  REPUBLISHED,
  SPACES,
  storedRules,
} from "../../../lib/fieldVisibility.js";
import { getFieldVisibility, putFieldVisibility, type SourceCoordinate } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class FieldVisibilityHide extends IntegrationLayerCommand {
  static override description =
    "Hide fields of one type from the public API. They stay resolvable internally, so an extension can still read them";

  static override examples = [
    "<%= config.bin %> integration-layer field-visibility hide --type-key internal-ops costPrice marginBand",
    "<%= config.bin %> integration-layer field-visibility hide --space attribute --type-key shoes internalCode",
  ];

  // Variadic: several fields of the same type.
  static override strict = false;

  static override flags = {
    "type-key": Flags.string({
      description: "key of the custom Type (or Product Type, for attributes) the fields belong to",
      required: true,
    }),
    space: Flags.string({
      description: "customField for a custom Type's field, attribute for a product attribute",
      options: [...SPACES],
      default: "customField",
    }),
  };

  static override args = {
    field: Args.string({ description: "name of a field to hide", required: true }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(FieldVisibilityHide);
    const names = [...new Set((argv as string[]).map((f) => f.trim()).filter((f) => f !== ""))];
    if (names.length === 0) this.error("At least one field name is required.");
    const typeKey = flags["type-key"].trim();
    if (!typeKey) this.error("--type-key must not be empty.");

    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const { fields } = await getFieldVisibility(baseUrl, projectKey, authFetch);
    const rules = storedRules(fields);
    const have = new Set(rules.map(coordinateKey));
    const known = new Set(fields.filter((r) => r.fieldType).map((r) => coordinateKey(r.coordinate)));

    const added: SourceCoordinate[] = [];
    for (const fieldName of names) {
      const coordinate = { space: flags.space, typeKey, fieldName };
      const key = coordinateKey(coordinate);
      if (have.has(key)) {
        this.log(`'${fieldName}' is already hidden.`);
        continue;
      }
      if (!known.has(key)) {
        // Valid: hiding before creating leaves no window where the field is public.
        this.log(`Note: '${typeKey}' has no field '${fieldName}' yet — the rule is stored for when it exists.`);
      }
      added.push(coordinate);
    }
    if (added.length === 0) return;

    try {
      assertWithinLimits([...rules, ...added]);
    } catch (e) {
      this.error((e as Error).message);
    }

    const saved = await putFieldVisibility(baseUrl, projectKey, authFetch, [...rules, ...added]);
    this.log(`✓ hid ${added.length} field(s) for '${projectKey}' (version ${saved.version}).`);
    // The route republishes the schema on every save; a failed republish leaves the rules
    // stored but not yet public, which a pipeline must see as a failure.
    if (saved.publishPending) this.error(PUBLISH_PENDING, { exit: 2 });
    this.log(REPUBLISHED);
  }
}
