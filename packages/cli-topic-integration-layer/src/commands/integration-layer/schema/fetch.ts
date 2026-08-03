import { writeFile } from "node:fs/promises";
import { Flags } from "@oclif/core";
import { fetchSubgraphSdl } from "../../../lib/ilClient.js";
import { IntegrationLayerCommand } from "../../../lib/base.js";

export default class SchemaFetch extends IntegrationLayerCommand {
  static override description =
    "Print (or write) the project's core-subgraph SDL — the input extensions compose against";

  static override examples = [
    "<%= config.bin %> integration-layer schema fetch",
    "<%= config.bin %> integration-layer schema fetch --out subgraph.graphql",
  ];

  static override flags = {
    out: Flags.string({ description: "write the SDL to this file instead of stdout" }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SchemaFetch);
    const { baseUrl, projectKey, authFetch } = await this.resolveIlContext(flags);
    const sdl = await fetchSubgraphSdl(baseUrl, projectKey, authFetch);
    if (flags.out) {
      await writeFile(flags.out, sdl, "utf8");
      this.log(`✓ wrote ${projectKey} core-subgraph SDL → ${flags.out}`);
    } else {
      this.log(sdl);
    }
  }
}
