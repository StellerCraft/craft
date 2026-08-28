/**
 * Stripe Tax configuration helpers for regional subscription pricing compliance.
 *
 * Stripe Tax automatically calculates and applies the correct tax rates based
 * on the customer's billing address. This module configures automatic tax
 * collection and handles tax-exempt customers.
 *
 * Requirements
 * ────────────
 * - STRIPE_TAX_ENABLED env var must be "true" to activate tax collection.
 * - Tax-exempt status is stored per-customer on the Stripe Customer object
 *   (tax_exempt: "none" | "exempt" | "reverse").
 * - Tax-inclusive pricing is enabled in regions where required (e.g. EU VAT).
 *
 * Supported exemption types
 * ─────────────────────────
 * none     : Regular taxable customer (default).
 * exempt   : Tax-exempt organisations (e.g. non-profits, governments).
 * reverse  : B2B customers in eligible regions (VAT reverse charge).
 *
 * Asymmetry: Nullable on read, non-nullable on write
 * ──────────────────────────────────────────────────
 * When reading from Stripe's API, the tax_exempt field can be null (for customers
 * predating tax configuration or created outside this code path). Always route raw
 * Stripe API responses through parseTaxExemptStatus() before passing to isTaxExempt()
 * or buildTaxExemptUpdate().
 *
 * When writing, buildTaxExemptUpdate() only accepts the three valid TaxExemptStatus
 * values — the type system enforces that invariant.
 *
 * Feature: stripe-tax-rate-configuration
 * Issue: #655, #937
 */

export type TaxExemptStatus = 'none' | 'exempt' | 'reverse';

export interface TaxConfiguration {
    /** Whether Stripe Tax automatic calculation is enabled. */
    enabled: boolean;
    /** Whether to collect the customer's tax ID at checkout. */
    collectTaxId: boolean;
}

/** Returns the current Stripe Tax configuration from environment variables. */
export function getTaxConfiguration(): TaxConfiguration {
    return {
        enabled: process.env.STRIPE_TAX_ENABLED === 'true',
        collectTaxId: process.env.STRIPE_TAX_COLLECT_ID === 'true',
    };
}

/**
 * Returns Stripe checkout session params for automatic tax calculation.
 * Call this and spread the result into the checkout session `create` call.
 */
export function buildCheckoutTaxParams(config: TaxConfiguration): {
    automatic_tax?: { enabled: boolean };
    tax_id_collection?: { enabled: boolean };
} {
    if (!config.enabled) return {};

    return {
        automatic_tax: { enabled: true },
        ...(config.collectTaxId ? { tax_id_collection: { enabled: true } } : {}),
    };
}

/**
 * Returns the Stripe Customer update payload to apply a tax exemption status.
 * Pass the result to `stripe.customers.update(customerId, payload)`.
 */
export function buildTaxExemptUpdate(status: TaxExemptStatus): { tax_exempt: TaxExemptStatus } {
    return { tax_exempt: status };
}

/**
 * Parse a raw Stripe tax_exempt value (which may be null) into a safe TaxExemptStatus.
 * Handles nulls, undefineds, and unrecognized values by defaulting to 'none'.
 *
 * @param raw - The value from Stripe's Customer.tax_exempt field
 * @returns A valid TaxExemptStatus, never null or undefined
 */
export function parseTaxExemptStatus(raw: string | null | undefined): TaxExemptStatus {
    if (raw === 'exempt' || raw === 'reverse' || raw === 'none') {
        return raw;
    }
    return 'none';
}

/**
 * Returns whether a customer's exemption status means they should not be
 * charged tax.
 */
export function isTaxExempt(status: TaxExemptStatus): boolean {
    return status === 'exempt' || status === 'reverse';
}
