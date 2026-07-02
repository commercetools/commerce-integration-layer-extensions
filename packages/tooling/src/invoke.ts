// `ee-ext invoke` — a local harness for API-Extension handlers, so an author can
// fire a sample commercetools callback at their bundle and see the result WITHOUT
// deploying: builds the current example, loads its `apiExtensions`, and runs the
// matching handler(s) against a sample cart payload, printing approve / block /
// modify.
//
// Flags (all optional):
//   --action=Create|Update   the trigger action (default Create)
//   --sku=<sku>              the SKU on the sample cart's line item (default BLOCKED-SKU)
//   --config KEY=VALUE       a config entry the handler reads via ctx.config
//                             (repeatable; also picked up from EXTENSION_CONFIG_<KEY> env)

import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { buildBundle } from './build.js';
import { loadBundleSource } from './loadBundle.js';
import type {
  ApiExtensionAction,
  ApiExtensionDefinition,
  ApiExtensionInput,
  ApiExtensionResult,
} from './apiExtension.js';

interface InvokeArgs {
  action: ApiExtensionAction;
  sku: string;
  config: Record<string, string>;
}

function parseArgs(argv: string[]): InvokeArgs {
  const args: InvokeArgs = { action: 'Create', sku: 'BLOCKED-SKU', config: configFromEnv() };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--action' || arg.startsWith('--action=')) {
      const v = arg.includes('=') ? arg.split('=')[1] : argv[(i += 1)];
      if (v === 'Create' || v === 'Update') args.action = v;
    } else if (arg === '--sku' || arg.startsWith('--sku=')) {
      args.sku = arg.includes('=') ? arg.split('=')[1] : argv[(i += 1)];
    } else if (arg === '--config' || arg.startsWith('--config=')) {
      const pair = arg.includes('=') ? arg.slice(arg.indexOf('=') + 1) : argv[(i += 1)];
      const eq = pair.indexOf('=');
      if (eq > 0) args.config[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
  }
  return args;
}

/** Read config the local run should expose as ctx.config, from EXTENSION_CONFIG_<KEY> env. */
function configFromEnv(): Record<string, string> {
  const config: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('EXTENSION_CONFIG_') && typeof value === 'string') {
      config[key.slice('EXTENSION_CONFIG_'.length)] = value;
    }
  }
  return config;
}

/** A sample commercetools cart callback payload. */
function sampleCartInput(action: ApiExtensionAction, sku: string): ApiExtensionInput {
  // A minimal sample callback for local testing. The real payload is the SDK's
  // ExtensionInput (resource: a full Cart Reference); we send just the fields a
  // cart handler reads, cast to the SDK type.
  return {
    action,
    resource: {
      typeId: 'cart',
      id: 'sample-cart',
      obj: {
        id: 'sample-cart',
        lineItems: [{ id: 'sample-line-item', quantity: 1, variant: { sku } }],
      },
    },
  } as unknown as ApiExtensionInput;
}

function describeResult(result: ApiExtensionResult): string {
  if (result && typeof result === 'object') {
    if (Array.isArray(result.errors) && result.errors.length > 0) {
      return `BLOCK — ${result.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}`;
    }
    if (Array.isArray(result.actions) && result.actions.length > 0) {
      return `MODIFY — ${JSON.stringify(result.actions)}`;
    }
  }
  return 'APPROVE';
}

export async function invokeCommand(): Promise<void> {
  const args = parseArgs(process.argv.slice(3));
  const { outfile } = await buildBundle();
  const mod = loadBundleSource(await readFile(outfile, 'utf8')) as {
    apiExtensions?: unknown;
  };
  const handlers = Array.isArray(mod.apiExtensions)
    ? (mod.apiExtensions as ApiExtensionDefinition[])
    : [];
  if (handlers.length === 0) {
    process.stderr.write('ee-ext invoke: this bundle declares no `apiExtensions`.\n');
    process.exit(1);
  }

  const input = sampleCartInput(args.action, args.sku);
  const ctx = { now: () => Date.now(), config: args.config };
  process.stdout.write(
    `Invoking ${handlers.length} handler(s) with a ${input.action} on cart ` +
      `(line item SKU '${args.sku}')\n`,
  );

  for (const h of handlers) {
    if (h.resourceTypeId !== input.resource.typeId || !h.actions.includes(args.action)) {
      process.stdout.write(`  · ${h.key}: skipped (does not trigger on cart/${args.action})\n`);
      continue;
    }
    const result = await h.handler(input, ctx);
    process.stdout.write(`  → ${h.key}: ${describeResult(result)}\n`);
  }
}
