import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unmock crypto functions to test actual implementation
vi.unmock('@/main/core/utils/crypto');

import {
  encrypt,
  decrypt,
  b64Encode,
  b64Decode,
  urlSafeB64Encode,
  urlSafeB64Decode,
  mix,
  unmix,
  md5sum,
} from './crypto';

describe('Crypto Utils', () => {
  const testKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8'); // 32 bytes for AES-256
  const testContent = 'Hello, World!';

  describe('encrypt and decrypt', () => {
    it('should encrypt and decrypt content correctly', () => {
      const encrypted = encrypt(testContent, testKey);
      expect(encrypted).not.toBe(testContent);
      expect(encrypted.length).toBeGreaterThan(0);

      const decrypted = decrypt(encrypted, testKey);
      expect(decrypted).toBe(testContent);
    });

    it('should produce different encrypted output for same input', () => {
      const encrypted1 = encrypt(testContent, testKey);
      const encrypted2 = encrypt(testContent, testKey);
      expect(encrypted1).not.toBe(encrypted2);
    });

    it('should fail to decrypt with wrong key', () => {
      const encrypted = encrypt(testContent, testKey);
      const wrongKey = Buffer.from('wrongkey012345678901234567890123', 'utf8');

      expect(() => decrypt(encrypted, wrongKey)).toThrow();
    });
  });

  describe('b64Encode and b64Decode', () => {
    it('should encode and decode base64 correctly', () => {
      const encoded = b64Encode(testContent);
      expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');

      const decoded = b64Decode(encoded);
      expect(decoded).toBe(testContent);
    });

    it('should handle unicode characters', () => {
      const unicode = '你好，世界！🌍';
      const encoded = b64Encode(unicode);
      const decoded = b64Decode(encoded);
      expect(decoded).toBe(unicode);
    });
  });

  describe('urlSafeB64Encode and urlSafeB64Decode', () => {
    it('should encode and decode URL-safe base64 correctly', () => {
      const content = 'Hello World';
      const encoded = urlSafeB64Encode(content);
      expect(encoded).not.toContain('+');
      expect(encoded).not.toContain('/');
      expect(encoded).not.toContain('=');

      const decoded = urlSafeB64Decode(encoded);
      expect(decoded).toBe(content);
    });
  });

  describe('mix and unmix', () => {
    it('should mix and unmix content correctly', () => {
      const mixed = mix(testContent);
      expect(mixed).not.toBe(testContent);

      const unmixed = unmix(mixed);
      expect(unmixed).toBe(testContent);
    });
  });

  describe('md5sum', () => {
    it('should calculate correct MD5 hash', () => {
      const hash = md5sum(testContent);
      expect(hash).toBe('65a8e27d8879283831b664bd8b7f0ad4');
    });

    it('should produce different hashes for different content', () => {
      const hash1 = md5sum('content1');
      const hash2 = md5sum('content2');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce same hash for same content', () => {
      const hash1 = md5sum(testContent);
      const hash2 = md5sum(testContent);
      expect(hash1).toBe(hash2);
    });
  });
});
