import type { Address, CentPrecisionMoney, ExtensionResourceTypeId } from "@commercetools/platform-sdk";
import {
  AuthenticationModeValues,
  BusinessUnitTypeValues,
  CartOriginValues,
  CartStateValues,
  ExtensionResourceTypeIdValues,
  InventoryModeValues,
  OrderStateValues,
  PaymentMethodStatusValues,
  QuoteRequestStateValues,
  QuoteStateValues,
  RoundingModeValues,
  ShippingModeValues,
  StagedQuoteStateValues,
  TaxCalculationModeValues,
  TaxModeValues,
} from "@commercetools/platform-sdk";

export interface SampleContext {
  resourceTypeId: ExtensionResourceTypeId;
  id: string;
  version: number;
}

type SampleObjBuilder = (ctx: SampleContext) => Record<string, unknown>;

const SAMPLE = {
  productId: "sample-product-id",
  productTypeId: "sample-product-type-id",
  lineItemId: "sample-line-item-id",
  cartId: "sample-cart-id",
  sku: "SAMPLE-SKU",
  currency: "EUR",
  email: "sample.customer@example.com",
  quoteRequestId: "sample-quote-request-id",
  stagedQuoteId: "sample-staged-quote-id",
  timestamp: "2024-01-01T00:00:00.000Z",
} as const;

function sampleMoney(centAmount = 1000): CentPrecisionMoney {
  return {
    type: "centPrecision",
    currencyCode: SAMPLE.currency,
    centAmount,
    fractionDigits: 2,
  };
}

function sampleAddress(id = "sample-address-id"): Address {
  return {
    id,
    country: "DE",
    city: "Berlin",
    streetName: "Sample Street",
    streetNumber: "1",
    postalCode: "10115",
  };
}

function sampleProductTypeRef() {
  return { typeId: "product-type", id: SAMPLE.productTypeId };
}

function sampleCartLineItem() {
  return {
    id: SAMPLE.lineItemId,
    productId: SAMPLE.productId,
    productType: sampleProductTypeRef(),
    name: { en: "Sample product" },
    quantity: 1,
    variant: { id: 1, sku: SAMPLE.sku },
    price: { value: sampleMoney() },
  };
}

function sampleShoppingListLineItem() {
  return {
    id: SAMPLE.lineItemId,
    addedAt: SAMPLE.timestamp,
    productId: SAMPLE.productId,
    productType: sampleProductTypeRef(),
    name: { en: "Sample product" },
    published: true,
    quantity: 1,
    variant: { id: 1, sku: SAMPLE.sku },
  };
}

function sampleCartFields(ctx: SampleContext) {
  return {
    id: ctx.id,
    version: ctx.version,
    currency: SAMPLE.currency,
    lineItems: [sampleCartLineItem()],
    customLineItems: [],
    totalPrice: sampleMoney(),
    taxMode: TaxModeValues.Platform,
    priceRoundingMode: RoundingModeValues.HalfEven,
    taxRoundingMode: RoundingModeValues.HalfEven,
    taxCalculationMode: TaxCalculationModeValues.LineItemLevel,
    inventoryMode: InventoryModeValues.None,
    cartState: CartStateValues.Active,
    shippingMode: ShippingModeValues.Single,
    shipping: [],
    discountCodes: [],
    directDiscounts: [],
    refusedGifts: [],
    origin: CartOriginValues.Customer,
    itemShippingAddresses: [],
  };
}

const sampleObjBuilders = {
  [ExtensionResourceTypeIdValues.Cart]: sampleCartFields,

  [ExtensionResourceTypeIdValues.Order]: (ctx: SampleContext) => ({
    ...sampleCartFields(ctx),
    orderNumber: "SAMPLE-ORDER-001",
    orderState: OrderStateValues.Open,
  }),

  [ExtensionResourceTypeIdValues.Payment]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    amountPlanned: sampleMoney(),
    paymentMethodInfo: {
      paymentInterface: "Sample",
      method: "card",
    },
    paymentStatus: {
      interfaceCode: "Pending",
      interfaceText: "Pending",
    },
  }),

  [ExtensionResourceTypeIdValues.PaymentMethod]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    key: "sample-payment-method",
    name: { en: "Sample card" },
    paymentInterface: "Sample",
    paymentMethodStatus: PaymentMethodStatusValues.Active,
    default: false,
  }),

  [ExtensionResourceTypeIdValues.Customer]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    email: SAMPLE.email,
    firstName: "Sample",
    lastName: "Customer",
    authenticationMode: AuthenticationModeValues.Password,
    addresses: [sampleAddress()],
  }),

  [ExtensionResourceTypeIdValues.CustomerGroup]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    key: "sample-customer-group",
    name: "Sample customer group",
  }),

  [ExtensionResourceTypeIdValues.QuoteRequest]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    quoteRequestState: QuoteRequestStateValues.Submitted,
    comment: "Sample quote request",
    lineItems: [sampleCartLineItem()],
  }),

  [ExtensionResourceTypeIdValues.StagedQuote]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    stagedQuoteState: StagedQuoteStateValues.InProgress,
    quoteRequest: {
      typeId: ExtensionResourceTypeIdValues.QuoteRequest,
      id: SAMPLE.quoteRequestId,
    },
    quotationCart: {
      typeId: ExtensionResourceTypeIdValues.Cart,
      id: SAMPLE.cartId,
    },
  }),

  [ExtensionResourceTypeIdValues.Quote]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    quoteState: QuoteStateValues.Pending,
    stagedQuote: {
      typeId: ExtensionResourceTypeIdValues.StagedQuote,
      id: SAMPLE.stagedQuoteId,
    },
    lineItems: [sampleCartLineItem()],
    totalPrice: sampleMoney(),
  }),

  [ExtensionResourceTypeIdValues.BusinessUnit]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    key: "sample-business-unit",
    name: "Sample business unit",
    unitType: BusinessUnitTypeValues.Company,
  }),

  [ExtensionResourceTypeIdValues.ShoppingList]: (ctx: SampleContext) => ({
    id: ctx.id,
    version: ctx.version,
    name: { en: "Sample shopping list" },
    lineItems: [sampleShoppingListLineItem()],
  }),
} satisfies Record<
  (typeof ExtensionResourceTypeIdValues)[keyof typeof ExtensionResourceTypeIdValues],
  SampleObjBuilder
>;

/** Build the expanded `resource.obj` for an API-Extension resource type. */
export function sampleExtensionResourceObj(
  resourceTypeId: ExtensionResourceTypeId,
  ctx: SampleContext,
): Record<string, unknown> {
  const build = sampleObjBuilders[resourceTypeId as keyof typeof sampleObjBuilders];
  if (!build) {
    throw new Error(`no sample builder registered for resource type '${resourceTypeId}'`);
  }
  return build(ctx);
}
