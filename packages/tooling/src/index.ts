// Public surface of the shared tooling, consumed by the example smoke tests in
// this package's own `tests/` (the examples themselves only run the `ee-ext`
// flow). The CLI/command functions import the implementation modules directly.

export { buildBundle, HOST_PROVIDED_EXTERNALS } from "./build.js";
export type { BuildResult } from "./build.js";
export { validateBundle, BundleValidationError } from "./validateBundle.js";
export type { ValidationResult } from "./validateBundle.js";
export { loadBundleSource } from "./loadBundle.js";
export type { EvaluatedBundle } from "./loadBundle.js";
export { analyzeSources } from "./staticAnalysis.js";
export type { AnalysisIssue } from "./staticAnalysis.js";
