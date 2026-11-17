import { writeFile } from "node:fs/promises";
import { Flags } from "@oclif/core";
import { fetchPublicApiSchemaSdl, fetchSubgraphSdl } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class SchemaFetch extends IntegrationLayerCommand {
  static override description =
    "Print (or write) the project's core-subgraph SDL — the input extensions compose against — or, with --public, its deployed public API schema";

  static override examples = [
    "<%= config.bin %> integration-layer schema fetch",
    "<%= config.bin %> integration-layer schema fetch --out subgraph.graphql",
    "<%= config.bin %> integration-layer schema fetch --public --out schema.graphql",
  ];

  static override flags = {
    public: Flags.boolean({
      description:
        "fetch the schema as deployed (what a shopper can query, with no hidden fields) instead of the core subgraph. Your local extension is not included",
    }),
    out: Flags.string({ description: "write the SDL to this file instead of stdout" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaFetch);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const sdl = flags.public
      ? await fetchPublicApiSchemaSdl(baseUrl, projectKey, authFetch)
      : await fetchSubgraphSdl(baseUrl, projectKey, authFetch);
    if (flags.out) {
      await writeFile(flags.out, sdl, "utf8");
      this.log(`✓ wrote ${projectKey} ${flags.public ? "public API schema" : "core-subgraph SDL"} → ${flags.out}`);
    } else {
      this.log(sdl);
    }
  }
}
