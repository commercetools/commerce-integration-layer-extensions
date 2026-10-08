import { readFile } from "node:fs/promises";
import { Flags } from "@oclif/core";
import { confirm } from "../../../lib/confirmPrompt.js";
import {
  logCoordinates,
  parseCoordinates,
  PUBLISH_PENDING,
  REPUBLISHED,
  storedRules,
} from "../../../lib/fieldVisibility.js";
import { getFieldVisibility, putFieldVisibility } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

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
      next = parseCoordinates(flags.file === "-" ? await readStdin() : await readFile(flags.file, "utf8"));
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
    // The route republishes the schema on every save; a failed republish leaves the rules
    // stored but not yet public, which a pipeline must see as a failure.
    if (saved.publishPending) this.error(PUBLISH_PENDING, { exit: 2 });
    this.log(REPUBLISHED);
  }
}
