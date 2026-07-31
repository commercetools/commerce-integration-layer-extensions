// oclif discovers commands from the `oclif.commands` directory (see package.json).
// The package `main` re-exports the extension authoring API so an author can import
// the helpers/types when writing `src/extension.ts`.
export {
  defineApiExtension,
  approve,
  block,
  update,
  type ApiExtensionAction,
  type ApiExtensionDefinition,
  type ApiExtensionError,
  type ApiExtensionInput,
  type ApiExtensionResult,
  type ExtensionContext,
  type ExtensionInput,
} from "./lib/tooling/apiExtension.js";
