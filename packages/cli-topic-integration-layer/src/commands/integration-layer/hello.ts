import { Command } from "@oclif/core";

export default class IntegrationLayerHelloCommand extends Command {
  static override description = "Print a hello world message from the integration-layer topic";

  static override examples = ["<%= config.bin %> integration-layer hello"];

  async run(): Promise<void> {
    await this.parse(IntegrationLayerHelloCommand);
    this.log("Hello, world!");
  }
}
