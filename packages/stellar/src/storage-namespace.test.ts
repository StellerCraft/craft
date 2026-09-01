/**
 * Unit Tests for Storage Namespace Collision Detector
 *
 * Tests the Soroban storage key namespacing functionality:
 * - Round-trip encoding/decoding of namespaced keys
 * - Collision detection across multiple contract storage keys
 * - Error handling for detected collisions
 */

import { describe, it, expect } from 'vitest';
import {
  namespaceKey,
  stripNamespace,
  detectStorageKeyCollisions,
  assertNoStorageKeyCollisions,
  StorageKeyCollisionError,
  StorageKeyEntry,
  StorageKeyCollision,
} from './storage-namespace';

describe('Storage Namespace Functions', () => {
  describe('namespaceKey', () => {
    it('should prefix a key with the contract ID', () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const key = 'counter';
      const result = namespaceKey(contractId, key);
      expect(result).toBe(`${contractId}:${key}`);
    });

    it('should handle empty keys', () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const key = '';
      const result = namespaceKey(contractId, key);
      expect(result).toBe(`${contractId}:`);
    });

    it('should handle keys with colons in them', () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const key = 'nested:key:value';
      const result = namespaceKey(contractId, key);
      expect(result).toBe(`${contractId}:nested:key:value`);
    });

    it('should preserve key content exactly', () => {
      const contractId = 'C' + 'A'.repeat(55);
      const key = 'special!@#$%^&*()_+-=[]{}|;:,.<>?/~`';
      const result = namespaceKey(contractId, key);
      expect(result).toContain(key);
    });
  });

  describe('stripNamespace', () => {
    it('should remove the contract ID prefix', () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const key = 'counter';
      const namespaced = namespaceKey(contractId, key);
      const result = stripNamespace(namespaced);
      expect(result).toBe(key);
    });

    it('should handle keys with colons in them', () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const key = 'nested:key:value';
      const namespaced = namespaceKey(contractId, key);
      const result = stripNamespace(namespaced);
      expect(result).toBe(key);
    });

    it('should handle keys that are empty after colon', () => {
      const namespaced = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4:';
      const result = stripNamespace(namespaced);
      expect(result).toBe('');
    });

    it('should return the full string if no colon is found', () => {
      const nonNamespacedKey = 'some_key_without_namespace';
      const result = stripNamespace(nonNamespacedKey);
      expect(result).toBe(nonNamespacedKey);
    });

    it('should be the inverse of namespaceKey (round-trip)', () => {
      const contractId = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
      const originalKey = 'my_storage_key';
      const namespaced = namespaceKey(contractId, originalKey);
      const restored = stripNamespace(namespaced);
      expect(restored).toBe(originalKey);
    });
  });

  describe('detectStorageKeyCollisions', () => {
    it('should return empty array when there are no collisions', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'balance' },
        { owner: 'contract_c', key: 'owner' },
      ];
      const collisions = detectStorageKeyCollisions(entries);
      expect(collisions).toEqual([]);
    });

    it('should detect a single collision between two contracts', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'counter' },
        { owner: 'contract_b', key: 'balance' },
      ];
      const collisions = detectStorageKeyCollisions(entries);
      expect(collisions).toHaveLength(1);
      expect(collisions[0].key).toBe('counter');
      expect(collisions[0].owners).toContain('contract_a');
      expect(collisions[0].owners).toContain('contract_b');
    });

    it('should detect multiple collisions', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'counter' },
        { owner: 'contract_a', key: 'owner' },
        { owner: 'contract_c', key: 'owner' },
        { owner: 'contract_b', key: 'data' },
      ];
      const collisions = detectStorageKeyCollisions(entries);
      expect(collisions).toHaveLength(2);
      const collisionKeys = collisions.map((c) => c.key).sort();
      expect(collisionKeys).toEqual(['counter', 'owner']);
    });

    it('should detect collisions across multiple owners', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'shared_key' },
        { owner: 'contract_b', key: 'shared_key' },
        { owner: 'contract_c', key: 'shared_key' },
      ];
      const collisions = detectStorageKeyCollisions(entries);
      expect(collisions).toHaveLength(1);
      expect(collisions[0].owners).toHaveLength(3);
      expect(collisions[0].owners.sort()).toEqual(
        ['contract_a', 'contract_b', 'contract_c'].sort()
      );
    });

    it('should ignore duplicate entries from the same owner', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_a', key: 'counter' },
      ];
      const collisions = detectStorageKeyCollisions(entries);
      expect(collisions).toEqual([]);
    });

    it('should handle empty entries array', () => {
      const collisions = detectStorageKeyCollisions([]);
      expect(collisions).toEqual([]);
    });

    it('should handle single entry', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
      ];
      const collisions = detectStorageKeyCollisions(entries);
      expect(collisions).toEqual([]);
    });

    it('should ignore durability field in collision detection', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter', durability: 'Persistent' },
        { owner: 'contract_b', key: 'counter', durability: 'Temporary' },
      ];
      const collisions = detectStorageKeyCollisions(entries);
      expect(collisions).toHaveLength(1);
    });
  });

  describe('assertNoStorageKeyCollisions', () => {
    it('should not throw when there are no collisions', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'balance' },
      ];
      expect(() => {
        assertNoStorageKeyCollisions(entries);
      }).not.toThrow();
    });

    it('should throw StorageKeyCollisionError when collisions are found', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'counter' },
      ];
      expect(() => {
        assertNoStorageKeyCollisions(entries);
      }).toThrow(StorageKeyCollisionError);
    });

    it('should include collision details in error message', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'counter' },
      ];
      try {
        assertNoStorageKeyCollisions(entries);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err instanceof StorageKeyCollisionError).toBe(true);
        expect(err.message).toContain('counter');
        expect(err.message).toContain('contract_a');
        expect(err.message).toContain('contract_b');
      }
    });

    it('should provide collisions property with collision details', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'counter' },
        { owner: 'contract_a', key: 'owner' },
        { owner: 'contract_c', key: 'owner' },
      ];
      try {
        assertNoStorageKeyCollisions(entries);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err instanceof StorageKeyCollisionError).toBe(true);
        expect(err.collisions).toHaveLength(2);
        expect(err.collisions[0].key).toBe('counter');
        expect(err.collisions[1].key).toBe('owner');
      }
    });

    it('should throw error with correct error name', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'counter' },
        { owner: 'contract_b', key: 'counter' },
      ];
      try {
        assertNoStorageKeyCollisions(entries);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.name).toBe('StorageKeyCollisionError');
      }
    });

    it('should handle multiple collisions across different keys', () => {
      const entries: StorageKeyEntry[] = [
        { owner: 'contract_a', key: 'key1' },
        { owner: 'contract_b', key: 'key1' },
        { owner: 'contract_a', key: 'key2' },
        { owner: 'contract_b', key: 'key2' },
        { owner: 'contract_c', key: 'key2' },
      ];
      try {
        assertNoStorageKeyCollisions(entries);
        expect.fail('Should have thrown');
      } catch (err: any) {
        expect(err.collisions).toHaveLength(2);
      }
    });
  });

  describe('StorageKeyCollisionError', () => {
    it('should be an instance of Error', () => {
      const collisions: StorageKeyCollision[] = [
        { key: 'counter', owners: ['contract_a', 'contract_b'] },
      ];
      const error = new StorageKeyCollisionError(collisions);
      expect(error instanceof Error).toBe(true);
    });

    it('should store collisions in public property', () => {
      const testCollisions: StorageKeyCollision[] = [
        { key: 'counter', owners: ['contract_a', 'contract_b'] },
        { key: 'owner', owners: ['contract_b', 'contract_c'] },
      ];
      const error = new StorageKeyCollisionError(testCollisions);
      expect(error.collisions).toEqual(testCollisions);
    });

    it('should format error message with collision details', () => {
      const collisions: StorageKeyCollision[] = [
        { key: 'counter', owners: ['contract_a', 'contract_b'] },
      ];
      const error = new StorageKeyCollisionError(collisions);
      expect(error.message).toContain('Storage key collisions detected');
      expect(error.message).toContain('counter');
      expect(error.message).toContain('contract_a');
      expect(error.message).toContain('contract_b');
    });

    it('should handle multiple collisions in error message', () => {
      const collisions: StorageKeyCollision[] = [
        { key: 'key1', owners: ['a', 'b'] },
        { key: 'key2', owners: ['c', 'd', 'e'] },
      ];
      const error = new StorageKeyCollisionError(collisions);
      expect(error.message).toContain('key1');
      expect(error.message).toContain('key2');
      expect(error.message).toContain('a');
      expect(error.message).toContain('c');
    });
  });
});
