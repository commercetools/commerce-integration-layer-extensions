import { Flags } from "@oclif/core";
import { confirm } from "../../../lib/confirmPrompt.js";
import {
  logCoordinates,
  parseCoordinates,
  PUBLISH_PENDING_SET,
  reportRepublish,
  storedRules,
} from "../../../lib/fieldVisibility.js";
import { getFieldVisibility, putFieldVisibility } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";
import { readFileOrStdin } from "../../../lib/readInput.js";

export default class FieldVisibilitySet extends IntegrationLayerCommand {
  static override description =
    "Replace the ENTIRE set of hidden fields with the coordinates in a JSON file (an empty list shows everything)";

  static override examples = [
    "<%= config.bin %> integration-layer field-visibility set --file hidden-fields.json",
    "cat hidden-fields.json | <%= config.bin %> integration-layer field-visibility set --file - --force",
  ];

  static override flags = {
    file: Flags.string({
      description:
        'JSON file, or - for stdin: an array like [{"space":"customField","typeKey":"internal-ops","fieldName":"costPrice"}], or { "hiddenFields": [...] }',
      required: true,
    }),
    force: Flags.boolean({ description: "apply the change without confirmation", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FieldVisibilitySet);

    let next;
    try {
      next = parseCoordinates(await readFileOrStdin(flags.file));
    } catch (e) {
      this.error((e as Error).message);
    }

    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const current = storedRules((await getFieldVisibility(baseUrl, projectKey, authFetch)).fields);

    const confirmed = await confirm({
      question: `Replace the hidden fields for '${projectKey}'?`,
      force: flags.force,
      abort: (message) => this.error(message),
      preview: () => {
        this.log(`Project '${projectKey}' — hidden fields set:`);
        this.log("  Current:");
        logCoordinates(current, (line) => this.log(`  ${line}`));
        this.log("  After:");
        logCoordinates(next, (line) => this.log(`  ${line}`));
        this.log("");
      },
    });
    if (!confirmed) {
      this.log("Aborted.");
      return;
    }

    const saved = await putFieldVisibility(baseUrl, projectKey, authFetch, next);
    this.log(`✓ set ${saved.hiddenFields.length} hidden field(s) for '${projectKey}' (version ${saved.version}).`);
    reportRepublish(saved.publishPending, PUBLISH_PENDING_SET, this);
  }
}
