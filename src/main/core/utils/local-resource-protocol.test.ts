import { describe, it, expect, vi } from 'vitest';
import { toLocalResourceUrl, fromLocalResourceUrl } from './local-resource-protocol';

// Mock MIME_MAP
vi.mock('../common/constants', () => ({
  MIME_MAP: {
    '.jpg': 'image/jpeg',
    '.JPG': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.JPEG': 'image/jpeg',
    '.png': 'image/png',
    '.PNG': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  },
}));

describe('Local Resource Protocol', () => {
  describe('toLocalResourceUrl', () => {
    it('should convert Windows path to local-resource URL', () => {
      const url = toLocalResourceUrl('C:\\Users\\test\\image.jpg');
      expect(url).toBe('local-resource://C:/Users/test/image.jpg');
    });

    it('should handle forward slash paths', () => {
      const url = toLocalResourceUrl('/home/user/image.png');
      expect(url).toBe('local-resource:///home/user/image.png');
    });

    it('should handle mixed separators', () => {
      const url = toLocalResourceUrl('D:\\photos\\2024/photo.jpg');
      expect(url).toBe('local-resource://D:/photos/2024/photo.jpg');
    });
  });

  describe('fromLocalResourceUrl', () => {
    it('should extract path from three-slash URL', () => {
      const filePath = fromLocalResourceUrl('local-resource:///C:/Users/test/image.jpg');
      expect(filePath).toBe('C:/Users/test/image.jpg');
    });

    it('should extract path from two-slash URL', () => {
      const filePath = fromLocalResourceUrl('local-resource://C:/Users/test/image.jpg');
      expect(filePath).toBe('C:/Users/test/image.jpg');
    });

    it('should handle URL-encoded characters', () => {
      const filePath = fromLocalResourceUrl('local-resource:///C:/path%20with%20spaces/img.jpg');
      expect(filePath).toBe('C:/path with spaces/img.jpg');
    });

    it('should handle Linux-style paths', () => {
      const filePath = fromLocalResourceUrl('local-resource:///home/user/image.png');
      expect(filePath).toBe('/home/user/image.png');
    });
  });

  describe('round-trip', () => {
    it('should round-trip a Windows path', () => {
      const original = 'C:\\Users\\test\\Pictures\\photo.jpg';
      const url = toLocalResourceUrl(original);
      const restored = fromLocalResourceUrl(url);
      expect(restored).toBe('C:/Users/test/Pictures/photo.jpg');
    });
  });
});
