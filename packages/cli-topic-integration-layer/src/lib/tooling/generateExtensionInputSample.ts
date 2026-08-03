import type { ExtensionResourceTypeId } from "@commercetools/platform-sdk";
import {
  ExtensionActionValues,
  ExtensionResourceTypeIdValues,
} from "@commercetools/platform-sdk";
import type { ApiExtensionAction } from "./apiExtension.js";
import { sampleExtensionResourceObj } from "./extensionInputSampleObj.js";

/** Resource type ids the platform SDK exposes for API Extensions. */
export const EXTENSION_RESOURCE_TYPE_IDS = Object.freeze(
  Object.values(ExtensionResourceTypeIdValues).sort(),
) as readonly ExtensionResourceTypeId[];

export type ExtensionResourceTypeIdValue = (typeof EXTENSION_RESOURCE_TYPE_IDS)[number];

export interface GenerateExtensionInputSampleOptions {
  action: ApiExtensionAction;
  resourceTypeId: string;
  /** Override the sample resource id (defaults to `sample-<resourceType>-id`). */
  id?: string;
}

export interface ExtensionInputSample {
  action: ApiExtensionAction;
  resource: {
    typeId: ExtensionResourceTypeId;
    id: string;
    obj: Record<string, unknown>;
  };
}

const supportedResourceTypes = new Set<string>(EXTENSION_RESOURCE_TYPE_IDS);

export function isExtensionResourceTypeId(value: string): value is ExtensionResourceTypeId {
  return supportedResourceTypes.has(value);
}

function sampleId(resourceTypeId: string, id?: string): string {
  return id ?? `sample-${resourceTypeId}-id`;
}

/** Build a commercetools ExtensionInput sample for local handler testing. */
export function generateExtensionInputSample(
  options: GenerateExtensionInputSampleOptions,
): ExtensionInputSample {
  const { action, resourceTypeId } = options;
  if (!isExtensionResourceTypeId(resourceTypeId)) {
    throw new Error(
      `unsupported resource type '${resourceTypeId}' — supported: ${EXTENSION_RESOURCE_TYPE_IDS.join(", ")}`,
    );
  }
  if (action !== ExtensionActionValues.Create && action !== ExtensionActionValues.Update) {
    throw new Error(
      `unsupported action '${action}' — supported: ${ExtensionActionValues.Create}, ${ExtensionActionValues.Update}`,
    );
  }

  const id = sampleId(resourceTypeId, options.id);
  const version = action === ExtensionActionValues.Update ? 2 : 1;
  return {
    action,
    resource: {
      typeId: resourceTypeId,
      id,
      obj: sampleExtensionResourceObj(resourceTypeId, {
        resourceTypeId,
        id,
        version,
      }),
    },
  };
}
