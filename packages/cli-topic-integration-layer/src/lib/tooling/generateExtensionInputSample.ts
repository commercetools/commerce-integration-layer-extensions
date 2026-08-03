import type { ApiExtensionAction } from "./apiExtension.js";

/** Resource type ids commercetools API Extensions can trigger on. */
export const EXTENSION_RESOURCE_TYPE_IDS = [
  "cart",
  "order",
  "payment",
  "payment-method",
  "customer",
  "customer-group",
  "quote-request",
  "staged-quote",
  "quote",
  "business-unit",
  "shopping-list",
] as const;

export type ExtensionResourceTypeId = (typeof EXTENSION_RESOURCE_TYPE_IDS)[number];

export interface GenerateExtensionInputSampleOptions {
  action: ApiExtensionAction;
  resourceTypeId: string;
  /** Override the sample resource id (defaults to `sample-<resourceType>-id`). */
  id?: string;
}

export interface ExtensionInputSample {
  action: ApiExtensionAction;
  resource: {
    typeId: string;
    id: string;
    obj: Record<string, unknown>;
  };
}

const money = (centAmount: number, currencyCode = "EUR") => ({
  type: "centPrecision" as const,
  currencyCode,
  centAmount,
  fractionDigits: 2,
});

function sampleId(resourceTypeId: string, id?: string): string {
  return id ?? `sample-${resourceTypeId}-id`;
}

function sampleObj(
  resourceTypeId: ExtensionResourceTypeId,
  action: ApiExtensionAction,
  id: string,
): Record<string, unknown> {
  const version = action === "Update" ? 2 : 1;
  const base = { id, version };

  switch (resourceTypeId) {
    case "cart":
      return {
        ...base,
        currency: "EUR",
        lineItems: [
          {
            id: "sample-line-item-id",
            productId: "sample-product-id",
            name: { en: "Sample product" },
            quantity: 1,
            variant: { id: 1, sku: "SAMPLE-SKU" },
            price: {
              value: money(1000),
            },
          },
        ],
        totalPrice: money(1000),
      };
    case "order":
      return {
        ...base,
        orderNumber: "SAMPLE-ORDER-001",
        orderState: "Open",
        currency: "EUR",
        lineItems: [
          {
            id: "sample-line-item-id",
            productId: "sample-product-id",
            name: { en: "Sample product" },
            quantity: 1,
            variant: { id: 1, sku: "SAMPLE-SKU" },
            price: {
              value: money(1000),
            },
          },
        ],
        totalPrice: money(1000),
      };
    case "payment":
      return {
        ...base,
        amountPlanned: money(1000),
        paymentMethodInfo: {
          paymentInterface: "Sample",
          method: "card",
        },
        paymentStatus: { interfaceCode: "Pending", interfaceText: "Pending" },
      };
    case "payment-method":
      return {
        ...base,
        key: "sample-payment-method",
        name: { en: "Sample card" },
        paymentInterface: "Sample",
      };
    case "customer":
      return {
        ...base,
        email: "sample.customer@example.com",
        firstName: "Sample",
        lastName: "Customer",
        addresses: [
          {
            id: "sample-address-id",
            country: "DE",
            city: "Berlin",
            streetName: "Sample Street",
            streetNumber: "1",
            postalCode: "10115",
          },
        ],
      };
    case "customer-group":
      return {
        ...base,
        key: "sample-customer-group",
        name: "Sample customer group",
      };
    case "quote-request":
      return {
        ...base,
        quoteRequestState: "Submitted",
        comment: "Sample quote request",
        lineItems: [
          {
            id: "sample-line-item-id",
            productId: "sample-product-id",
            name: { en: "Sample product" },
            quantity: 1,
            variant: { id: 1, sku: "SAMPLE-SKU" },
          },
        ],
      };
    case "staged-quote":
      return {
        ...base,
        stagedQuoteState: "InProgress",
        quoteRequest: { typeId: "quote-request", id: "sample-quote-request-id" },
        lineItems: [
          {
            id: "sample-line-item-id",
            productId: "sample-product-id",
            name: { en: "Sample product" },
            quantity: 1,
            variant: { id: 1, sku: "SAMPLE-SKU" },
          },
        ],
      };
    case "quote":
      return {
        ...base,
        quoteState: "Pending",
        stagedQuote: { typeId: "staged-quote", id: "sample-staged-quote-id" },
        lineItems: [
          {
            id: "sample-line-item-id",
            productId: "sample-product-id",
            name: { en: "Sample product" },
            quantity: 1,
            variant: { id: 1, sku: "SAMPLE-SKU" },
          },
        ],
        totalPrice: money(1000),
      };
    case "business-unit":
      return {
        ...base,
        key: "sample-business-unit",
        name: "Sample business unit",
        unitType: "Company",
      };
    case "shopping-list":
      return {
        ...base,
        name: { en: "Sample shopping list" },
        lineItems: [
          {
            id: "sample-line-item-id",
            productId: "sample-product-id",
            name: { en: "Sample product" },
            quantity: 1,
            variant: { id: 1, sku: "SAMPLE-SKU" },
          },
        ],
      };
  }
}

export function isExtensionResourceTypeId(value: string): value is ExtensionResourceTypeId {
  return (EXTENSION_RESOURCE_TYPE_IDS as readonly string[]).includes(value);
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
  const id = sampleId(resourceTypeId, options.id);
  return {
    action,
    resource: {
      typeId: resourceTypeId,
      id,
      obj: sampleObj(resourceTypeId, action, id),
    },
  };
}
