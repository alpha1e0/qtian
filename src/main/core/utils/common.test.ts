import { describe, it, expect } from 'vitest';
import {
  currentTimeObjToStr,
  timeStrToObj,
  generateRandomString,
  generateUniqueId,
  formatNumber,
  truncateString,
  debounce,
  throttle,
} from './common';

describe('Common Utils', () => {
  describe('currentTimeObjToStr', () => {
    it('should return current time in correct format', () => {
      const result = currentTimeObjToStr();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    });

    it('should return different values on consecutive calls (if not in same second)', async () => {
      const time1 = currentTimeObjToStr();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const time2 = currentTimeObjToStr();
      expect(time1).not.toBe(time2);
    });
  });

  describe('timeStrToObj', () => {
    it('should convert time string to Date object', () => {
      const timeStr = '2024-03-03 12:30:45';
      const date = timeStrToObj(timeStr);
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(2); // Month is 0-indexed
      expect(date.getDate()).toBe(3);
      expect(date.getHours()).toBe(12);
      expect(date.getMinutes()).toBe(30);
      expect(date.getSeconds()).toBe(45);
    });
  });

  describe('generateRandomString', () => {
    it('should generate string of default length 6', () => {
      const result = generateRandomString();
      expect(result).toHaveLength(6);
    });

    it('should generate string of specified length', () => {
      const result = generateRandomString(10);
      expect(result).toHaveLength(10);
    });

    it('should generate different strings on consecutive calls', () => {
      const str1 = generateRandomString();
      const str2 = generateRandomString();
      expect(str1).not.toBe(str2);
    });
  });

  describe('generateUniqueId', () => {
    it('should generate valid UUID', () => {
      const result = generateUniqueId();
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('should generate unique IDs', () => {
      const id1 = generateUniqueId();
      const id2 = generateUniqueId();
      expect(id1).not.toBe(id2);
    });
  });

  describe('formatNumber', () => {
    it('should format number with thousands separator', () => {
      expect(formatNumber(1000)).toBe('1,000');
      expect(formatNumber(1000000)).toBe('1,000,000');
      expect(formatNumber(1234567)).toBe('1,234,567');
    });

    it('should handle small numbers', () => {
      expect(formatNumber(123)).toBe('123');
      expect(formatNumber(0)).toBe('0');
    });
  });

  describe('truncateString', () => {
    it('should truncate string longer than max length', () => {
      const result = truncateString('Hello World', 8);
      expect(result).toBe('Hello...');
      expect(result.length).toBe(8);
    });

    it('should not truncate string shorter than max length', () => {
      const result = truncateString('Hi', 10);
      expect(result).toBe('Hi');
    });

    it('should use custom suffix', () => {
      const result = truncateString('Hello World', 8, '---');
      expect(result).toBe('Hello---');
    });
  });

  describe('debounce', () => {
    it('should debounce function calls', async () => {
      let count = 0;
      const fn = debounce(() => {
        count++;
      }, 100);

      fn();
      fn();
      fn();

      expect(count).toBe(0);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(count).toBe(1);
    });
  });

  describe('throttle', () => {
    it('should throttle function calls', async () => {
      let count = 0;
      const fn = throttle(() => {
        count++;
      }, 100);

      fn();
      fn();
      fn();

      expect(count).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 150));
      fn();
      expect(count).toBe(2);
    });
  });
});
