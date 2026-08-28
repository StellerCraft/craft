import { describe, it, expect } from 'vitest';
import {
  parseTaxExemptStatus,
  isTaxExempt,
  buildTaxExemptUpdate,
  getTaxConfiguration,
  buildCheckoutTaxParams,
} from './tax';

describe('tax', () => {
  describe('parseTaxExemptStatus', () => {
    it('returns "none" for a null value', () => {
      expect(parseTaxExemptStatus(null)).toBe('none');
    });

    it('returns "none" for an undefined value', () => {
      expect(parseTaxExemptStatus(undefined)).toBe('none');
    });

    it('returns "exempt" for an "exempt" value', () => {
      expect(parseTaxExemptStatus('exempt')).toBe('exempt');
    });

    it('returns "reverse" for a "reverse" value', () => {
      expect(parseTaxExemptStatus('reverse')).toBe('reverse');
    });

    it('returns "none" for an "none" value', () => {
      expect(parseTaxExemptStatus('none')).toBe('none');
    });

    it('returns "none" for an unrecognized string value', () => {
      expect(parseTaxExemptStatus('unknown')).toBe('none');
      expect(parseTaxExemptStatus('invalid')).toBe('none');
    });

    it('handles empty string as "none"', () => {
      expect(parseTaxExemptStatus('')).toBe('none');
    });
  });

  describe('isTaxExempt', () => {
    it('returns true for "exempt" status', () => {
      expect(isTaxExempt('exempt')).toBe(true);
    });

    it('returns true for "reverse" status', () => {
      expect(isTaxExempt('reverse')).toBe(true);
    });

    it('returns false for "none" status', () => {
      expect(isTaxExempt('none')).toBe(false);
    });
  });

  describe('buildTaxExemptUpdate', () => {
    it('returns the correct update payload for "exempt" status', () => {
      const result = buildTaxExemptUpdate('exempt');
      expect(result).toEqual({ tax_exempt: 'exempt' });
    });

    it('returns the correct update payload for "reverse" status', () => {
      const result = buildTaxExemptUpdate('reverse');
      expect(result).toEqual({ tax_exempt: 'reverse' });
    });

    it('returns the correct update payload for "none" status', () => {
      const result = buildTaxExemptUpdate('none');
      expect(result).toEqual({ tax_exempt: 'none' });
    });
  });

  describe('getTaxConfiguration', () => {
    it('returns configuration based on environment variables', () => {
      const config = getTaxConfiguration();
      expect(config).toHaveProperty('enabled');
      expect(config).toHaveProperty('collectTaxId');
    });
  });

  describe('buildCheckoutTaxParams', () => {
    it('returns empty object when tax is disabled', () => {
      const result = buildCheckoutTaxParams({ enabled: false, collectTaxId: false });
      expect(result).toEqual({});
    });

    it('returns automatic_tax when tax is enabled', () => {
      const result = buildCheckoutTaxParams({ enabled: true, collectTaxId: false });
      expect(result).toHaveProperty('automatic_tax');
      expect(result.automatic_tax).toEqual({ enabled: true });
    });

    it('includes tax_id_collection when collectTaxId is true', () => {
      const result = buildCheckoutTaxParams({ enabled: true, collectTaxId: true });
      expect(result).toHaveProperty('tax_id_collection');
      expect(result.tax_id_collection).toEqual({ enabled: true });
    });
  });

  describe('integration: parsing and using tax status', () => {
    it('safely handles null tax_exempt from Stripe API', () => {
      const rawTaxExempt = null;
      const parsed = parseTaxExemptStatus(rawTaxExempt);
      const isExempt = isTaxExempt(parsed);
      expect(isExempt).toBe(false);
    });

    it('preserves "exempt" status through parse and check', () => {
      const rawTaxExempt = 'exempt';
      const parsed = parseTaxExemptStatus(rawTaxExempt);
      const isExempt = isTaxExempt(parsed);
      const update = buildTaxExemptUpdate(parsed);
      expect(isExempt).toBe(true);
      expect(update.tax_exempt).toBe('exempt');
    });

    it('safely transitions from undefined to "none" and back', () => {
      const rawTaxExempt = undefined;
      const parsed = parseTaxExemptStatus(rawTaxExempt);
      const update = buildTaxExemptUpdate(parsed);
      expect(update).toEqual({ tax_exempt: 'none' });
    });
  });
});
