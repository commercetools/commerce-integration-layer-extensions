import { Args, Flags } from "@oclif/core";
import { confirm } from "../../../lib/confirmPrompt.js";
import {
  coordinateKey,
  logCoordinates,
  PUBLISH_PENDING,
  REPUBLISHED,
  SPACES,
  storedRules,
} from "../../../lib/fieldVisibility.js";
import { getFieldVisibility, putFieldVisibility } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class FieldVisibilityShow extends IntegrationLayerCommand {
  static override description =
    "Make hidden fields of one type selectable from the public API again (removes their hide rule)";

  static override examples = [
    "<%= config.bin %> integration-layer field-visibility show --type-key internal-ops costPrice",
    "<%= config.bin %> integration-layer field-visibility show --type-key internal-ops costPrice --force",
  ];

  static override strict = false;

  static override flags = {
    "type-key": Flags.string({ description: "key of the custom Type (or Product Type) the fields belong to", required: true }),
    space: Flags.string({
      description: "customField for a custom Type's field, attribute for a product attribute",
      options: [...SPACES],
      default: "customField",
    }),
    force: Flags.boolean({ description: "apply the change without confirmation", default: false }),
  };

  static override args = {
    field: Args.string({ description: "name of a field to show", required: true }),
  };

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(FieldVisibilityShow);
    const names = [...new Set((argv as string[]).map((f) => f.trim()).filter((f) => f !== ""))];
    if (names.length === 0) this.error("At least one field name is required.");
    const typeKey = flags["type-key"].trim();

    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const { fields } = await getFieldVisibility(baseUrl, projectKey, authFetch);
    const rules = storedRules(fields);

    const targets = new Set(names.map((fieldName) => coordinateKey({ space: flags.space, typeKey, fieldName })));
    const removing = rules.filter((c) => targets.has(coordinateKey(c)));
    if (removing.length === 0) {
      this.log(`Nothing to show — none of those fields is hidden in '${projectKey}'.`);
      return;
    }
    const remaining = rules.filter((c) => !targets.has(coordinateKey(c)));

    const confirmed = await confirm({
      question: `Make ${removing.length} field(s) publicly selectable in '${projectKey}'?`,
      force: flags.force,
      abort: (message) => this.error(message),
      preview: () => {
        this.log(`Project '${projectKey}' — these fields become selectable from the public API:`);
        logCoordinates(removing, (line) => this.log(line));
        this.log("");
      },
    });
    if (!confirmed) {
      this.log("Aborted.");
      return;
    }

    const saved = await putFieldVisibility(baseUrl, projectKey, authFetch, remaining);
    this.log(`✓ showed ${removing.length} field(s) for '${projectKey}' (version ${saved.version}).`);
    // The route republishes the schema on every save; a failed republish leaves the rules
    // stored but not yet public, which a pipeline must see as a failure.
    if (saved.publishPending) this.error(PUBLISH_PENDING, { exit: 2 });
    this.log(REPUBLISHED);
  }
}
