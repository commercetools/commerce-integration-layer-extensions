import { Flags } from "@oclif/core";
import { hasRule, reasonText } from "../../../lib/fieldVisibility.js";
import { getFieldVisibility, type FieldVisibilityRow } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class FieldVisibilityList extends IntegrationLayerCommand {
  static override description =
    "List the project's custom fields and product attributes and which ones are hidden from the public API";

  static override examples = [
    "<%= config.bin %> integration-layer field-visibility list",
    "<%= config.bin %> integration-layer field-visibility list --hidden",
    "<%= config.bin %> integration-layer field-visibility list --json",
  ];

  static override flags = {
    hidden: Flags.boolean({ description: "only show fields a rule hides", default: false }),
    json: Flags.boolean({ description: "print the rows as JSON", default: false }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(FieldVisibilityList);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const { fields } = await getFieldVisibility(baseUrl, projectKey, authFetch);
    const rows = flags.hidden ? fields.filter(hasRule) : fields;

    if (flags.json) {
      this.log(JSON.stringify(rows, null, 2));
      return;
    }
    if (rows.length === 0) {
      this.log(flags.hidden ? `No fields are hidden for '${projectKey}'.` : `No custom fields in '${projectKey}'.`);
      return;
    }

    this.log(`Field visibility for '${projectKey}' (${fields.filter(hasRule).length} rule(s)):`);
    const groups = new Map<string, FieldVisibilityRow[]>();
    for (const row of rows) {
      const key = `${row.coordinate.typeKey} (${row.coordinate.space})`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    for (const [group, groupRows] of groups) {
      this.log(group);
      for (const row of groupRows) {
        const mark = hasRule(row) ? "hidden " : "visible";
        const notes: string[] = [];
        if (row.reason) notes.push(`rule not in force: ${reasonText(row.reason)}`);
        else if (row.notInSchemaReason) notes.push(`not in the GraphQL schema: ${row.notInSchemaReason}`);
        this.log(
          `  [${mark}] ${row.coordinate.fieldName}${row.fieldType ? ` : ${row.fieldType}` : ""}` +
            (notes.length ? `  — ${notes.join("; ")}` : ""),
        );
      }
    }
  }
}
