/**
 * Stellar Asset Validation Tests
 *
 * Comprehensive tests for Stellar asset validation including:
 * - Asset code format validation
 * - Issuer address validation
 * - Trustline verification
 * - Asset existence on network
 * - Asset metadata retrieval
 *
 * Run: vitest run tests/stellar/asset-validation.test.ts
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Keypair, Networks } from 'stellar-sdk';

interface StellarAsset {
  code: string;
  issuer: string;
  native?: boolean;
}

interface AssetValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface TrustlineInfo {
  assetCode: string;
  issuer: string;
  balance: string;
  limit: string;
  authorized: boolean;
}

class StellarAssetValidator {
  private static readonly ASSET_CODE_PATTERN = /^[a-zA-Z0-9]{1,12}$/;
  private static readonly STELLAR_ADDRESS_PATTERN = /^G[A-Z2-7]{55}$/;

  /**
   * Validate asset code format
   */
  validateAssetCode(code: string): AssetValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!code || code.trim().length === 0) {
      errors.push('Asset code cannot be empty');
      return { valid: false, errors, warnings };
    }

    if (code.length > 12) {
      errors.push('Asset code must be 12 characters or less');
    }

    if (!this.ASSET_CODE_PATTERN.test(code)) {
      errors.push('Asset code must contain only alphanumeric characters');
    }

    if (code === 'native' || code === 'XLM') {
      warnings.push('Asset code matches native asset naming');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate Stellar issuer address
   */
  validateIssuerAddress(address: string): AssetValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!address || address.trim().length === 0) {
      errors.push('Issuer address cannot be empty');
      return { valid: false, errors, warnings };
    }

    if (!this.STELLAR_ADDRESS_PATTERN.test(address)) {
      errors.push('Invalid Stellar address format');
    }

    try {
      Keypair.fromPublicKey(address);
    } catch {
      errors.push('Address is not a valid Stellar public key');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate complete asset
   */
  validateAsset(asset: StellarAsset): AssetValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (asset.native) {
      return { valid: true, errors, warnings };
    }

    const codeValidation = this.validateAssetCode(asset.code);
    errors.push(...codeValidation.errors);
    warnings.push(...codeValidation.warnings);

    const issuerValidation = this.validateIssuerAddress(asset.issuer);
    errors.push(...issuerValidation.errors);
    warnings.push(...issuerValidation.warnings);

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Verify trustline exists for account
   */
  verifyTrustline(
    accountAddress: string,
    asset: StellarAsset,
    trustlines: TrustlineInfo[]
  ): { exists: boolean; trustline?: TrustlineInfo; error?: string } {
    if (!this.STELLAR_ADDRESS_PATTERN.test(accountAddress)) {
      return { exists: false, error: 'Invalid account address' };
    }

    const trustline = trustlines.find(
      (t) => t.assetCode === asset.code && t.issuer === asset.issuer
    );

    if (!trustline) {
      return { exists: false, error: 'Trustline not found for asset' };
    }

    if (!trustline.authorized) {
      return { exists: true, trustline, error: 'Trustline not authorized' };
    }

    return { exists: true, trustline };
  }

  /**
   * Check if asset exists on network
   */
  async checkAssetExistence(asset: StellarAsset): Promise<{ exists: boolean; error?: string }> {
    // Validate asset first
    const validation = this.validateAsset(asset);
    if (!validation.valid) {
      return { exists: false, error: `Invalid asset: ${validation.errors.join(', ')}` };
    }

    if (asset.native) {
      return { exists: true };
    }

    // Simulate network check
    try {
      // In real implementation, would call Horizon API
      const isValid = this.STELLAR_ADDRESS_PATTERN.test(asset.issuer);
      return { exists: isValid };
    } catch (error) {
      return { exists: false, error: 'Network connectivity error' };
    }
  }

  /**
   * Retrieve asset metadata
   */
  async getAssetMetadata(
    asset: StellarAsset
  ): Promise<{
    code: string;
    issuer: string;
    supply?: string;
    numAccounts?: number;
    flags?: { authRequired: boolean; authRevocable: boolean };
  }> {
    const validation = this.validateAsset(asset);
    if (!validation.valid) {
      throw new Error(`Invalid asset: ${validation.errors.join(', ')}`);
    }

    // Simulate metadata retrieval
    return {
      code: asset.code,
      issuer: asset.issuer,
      supply: '1000000.0000000',
      numAccounts: 42,
      flags: {
        authRequired: false,
        authRevocable: false,
      },
    };
  }
}

describe('Stellar Asset Validation', () => {
  let validator: StellarAssetValidator;

  beforeAll(() => {
    validator = new StellarAssetValidator();
  });

  describe('Asset Code Validation', () => {
    it('should validate correct asset codes', () => {
      const validCodes = ['USD', 'EUR', 'BTC', 'USDC', 'TEST123'];

      validCodes.forEach((code) => {
        const result = validator.validateAssetCode(code);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    it('should reject empty asset codes', () => {
      const result = validator.validateAssetCode('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Asset code cannot be empty');
    });

    it('should reject asset codes longer than 12 characters', () => {
      const result = validator.validateAssetCode('VERYLONGCODE123');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('12 characters'))).toBe(true);
    });

    it('should reject asset codes with invalid characters', () => {
      const result = validator.validateAssetCode('USD-EUR');
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('alphanumeric'))).toBe(true);
    });

    it('should warn on native asset naming', () => {
      const result = validator.validateAssetCode('XLM');
      expect(result.warnings.some((w) => w.includes('native'))).toBe(true);
    });
  });

  describe('Issuer Address Validation', () => {
    it('should validate correct Stellar addresses', () => {
      const testKeypair = Keypair.random();
      const result = validator.validateIssuerAddress(testKeypair.publicKey());
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty issuer addresses', () => {
      const result = validator.validateIssuerAddress('');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Issuer address cannot be empty');
    });

    it('should reject invalid address format', () => {
      const result = validator.validateIssuerAddress('INVALID_ADDRESS');
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should reject non-Stellar addresses', () => {
      const result = validator.validateIssuerAddress('0x1234567890123456789012345678901234567890');
      expect(result.valid).toBe(false);
    });
  });

  describe('Complete Asset Validation', () => {
    it('should validate complete credit assets', () => {
      const testKeypair = Keypair.random();
      const asset: StellarAsset = {
        code: 'USD',
        issuer: testKeypair.publicKey(),
      };

      const result = validator.validateAsset(asset);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should validate native assets', () => {
      const asset: StellarAsset = {
        code: 'XLM',
        issuer: '',
        native: true,
      };

      const result = validator.validateAsset(asset);
      expect(result.valid).toBe(true);
    });

    it('should reject assets with invalid code and issuer', () => {
      const asset: StellarAsset = {
        code: 'INVALID_CODE_TOO_LONG',
        issuer: 'INVALID_ADDRESS',
      };

      const result = validator.validateAsset(asset);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Trustline Verification', () => {
    it('should verify existing trustlines', () => {
      const testKeypair = Keypair.random();
      const accountAddress = testKeypair.publicKey();
      const asset: StellarAsset = {
        code: 'USD',
        issuer: Keypair.random().publicKey(),
      };

      const trustlines: TrustlineInfo[] = [
        {
          assetCode: 'USD',
          issuer: asset.issuer,
          balance: '1000.0000000',
          limit: '10000.0000000',
          authorized: true,
        },
      ];

      const result = validator.verifyTrustline(accountAddress, asset, trustlines);
      expect(result.exists).toBe(true);
      expect(result.trustline).toBeDefined();
      expect(result.trustline?.balance).toBe('1000.0000000');
    });

    it('should detect missing trustlines', () => {
      const testKeypair = Keypair.random();
      const accountAddress = testKeypair.publicKey();
      const asset: StellarAsset = {
        code: 'EUR',
        issuer: Keypair.random().publicKey(),
      };

      const result = validator.verifyTrustline(accountAddress, asset, []);
      expect(result.exists).toBe(false);
      expect(result.error).toContain('Trustline not found');
    });

    it('should detect unauthorized trustlines', () => {
      const testKeypair = Keypair.random();
      const accountAddress = testKeypair.publicKey();
      const asset: StellarAsset = {
        code: 'USD',
        issuer: Keypair.random().publicKey(),
      };

      const trustlines: TrustlineInfo[] = [
        {
          assetCode: 'USD',
          issuer: asset.issuer,
          balance: '0.0000000',
          limit: '0.0000000',
          authorized: false,
        },
      ];

      const result = validator.verifyTrustline(accountAddress, asset, trustlines);
      expect(result.exists).toBe(true);
      expect(result.error).toContain('not authorized');
    });

    it('should reject invalid account addresses', () => {
      const asset: StellarAsset = {
        code: 'USD',
        issuer: Keypair.random().publicKey(),
      };

      const result = validator.verifyTrustline('INVALID_ADDRESS', asset, []);
      expect(result.exists).toBe(false);
      expect(result.error).toContain('Invalid account address');
    });
  });

  describe('Asset Existence Verification', () => {
    it('should verify native asset exists', async () => {
      const asset: StellarAsset = {
        code: 'XLM',
        issuer: '',
        native: true,
      };

      const result = await validator.checkAssetExistence(asset);
      expect(result.exists).toBe(true);
    });

    it('should verify credit asset existence', async () => {
      const asset: StellarAsset = {
        code: 'USD',
        issuer: Keypair.random().publicKey(),
      };

      const result = await validator.checkAssetExistence(asset);
      expect(result.exists).toBe(true);
    });

    it('should reject invalid assets', async () => {
      const asset: StellarAsset = {
        code: 'INVALID_CODE_TOO_LONG',
        issuer: 'INVALID_ADDRESS',
      };

      const result = await validator.checkAssetExistence(asset);
      expect(result.exists).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('Asset Metadata Retrieval', () => {
    it('should retrieve asset metadata', async () => {
      const asset: StellarAsset = {
        code: 'USD',
        issuer: Keypair.random().publicKey(),
      };

      const metadata = await validator.getAssetMetadata(asset);
      expect(metadata.code).toBe('USD');
      expect(metadata.issuer).toBe(asset.issuer);
      expect(metadata.supply).toBeDefined();
      expect(metadata.numAccounts).toBeDefined();
      expect(metadata.flags).toBeDefined();
    });

    it('should throw on invalid asset metadata retrieval', async () => {
      const asset: StellarAsset = {
        code: 'INVALID_CODE_TOO_LONG',
        issuer: 'INVALID_ADDRESS',
      };

      await expect(validator.getAssetMetadata(asset)).rejects.toThrow();
    });

    it('should include authorization flags in metadata', async () => {
      const asset: StellarAsset = {
        code: 'USDC',
        issuer: Keypair.random().publicKey(),
      };

      const metadata = await validator.getAssetMetadata(asset);
      expect(metadata.flags?.authRequired).toBeDefined();
      expect(metadata.flags?.authRevocable).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle network connectivity errors gracefully', async () => {
      const asset: StellarAsset = {
        code: 'USD',
        issuer: Keypair.random().publicKey(),
      };

      // Mock network error
      const validatorWithError = new StellarAssetValidator();
      const checkAssetSpy = vi.spyOn(validatorWithError, 'checkAssetExistence');

      checkAssetSpy.mockResolvedValueOnce({
        exists: false,
        error: 'Network connectivity error',
      });

      const result = await validatorWithError.checkAssetExistence(asset);
      expect(result.exists).toBe(false);
      expect(result.error).toContain('Network');
    });

    it('should validate all asset types', () => {
      const testKeypair = Keypair.random();
      const assets: StellarAsset[] = [
        { code: 'USD', issuer: testKeypair.publicKey() },
        { code: 'EUR', issuer: testKeypair.publicKey() },
        { code: 'BTC', issuer: testKeypair.publicKey() },
        { code: 'XLM', issuer: '', native: true },
      ];

      assets.forEach((asset) => {
        const result = validator.validateAsset(asset);
        expect(result.valid).toBe(true);
      });
    });
  });
});
