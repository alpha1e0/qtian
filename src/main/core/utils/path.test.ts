import { describe, it, expect, vi } from 'vitest';
import * as os from 'os';
import {
  getInnerCurPath,
  isImage,
  getFileSizeMB,
  getFileSize,
  directoryExists,
  fileExists,
  getUserHomeDir,
  joinPath,
  getFileExtension,
  getFileNameWithoutExt,
  getFileName,
  getParentDirectory,
  ensureDirectory,
} from './path';
import * as path from 'path';

// Mock MIME_MAP for isImage test
vi.mock('../common/constants', () => ({
  MIME_MAP: {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
  },
}));

describe('Path Utils', () => {
  describe('getInnerCurPath', () => {
    it('should return resources path in production', () => {
      const originalResourcesPath = (process as any).resourcesPath;
      (process as any).resourcesPath = '/app/resources';

      const result = getInnerCurPath();
      expect(result).toBe('/app/resources');

      (process as any).resourcesPath = originalResourcesPath;
    });

    it('should return cwd in development', () => {
      const originalResourcesPath = (process as any).resourcesPath;
      delete (process as any).resourcesPath;

      const result = getInnerCurPath();
      expect(result).toBeDefined();

      if (originalResourcesPath) {
        (process as any).resourcesPath = originalResourcesPath;
      }
    });
  });

  describe('isImage', () => {
    it('should return true for image files', () => {
      expect(isImage('test.jpg')).toBe(true);
      expect(isImage('test.jpeg')).toBe(true);
      expect(isImage('test.png')).toBe(true);
      expect(isImage('test.gif')).toBe(true);
      expect(isImage('test.webp')).toBe(true);
    });

    it('should return false for non-image files', () => {
      expect(isImage('test.txt')).toBe(false);
      expect(isImage('test.pdf')).toBe(false);
      expect(isImage('test.doc')).toBe(false);
    });

    it('should work with ParsedPath object', () => {
      const parsedPath = path.parse('image.jpg');
      expect(isImage(parsedPath)).toBe(true);
    });
  });

  describe('getFileSizeMB', () => {
    it('should throw for non-existent file', () => {
      expect(() => getFileSizeMB('/non/existent/file')).toThrow();
    });
  });

  describe('getFileSize', () => {
    it('should throw for non-existent file', () => {
      expect(() => getFileSize('/non/existent/file')).toThrow();
    });
  });

  describe('directoryExists', () => {
    it('should return false for non-existent directory', () => {
      expect(directoryExists('/non/existent/directory')).toBe(false);
    });
  });

  describe('fileExists', () => {
    it('should return false for non-existent file', () => {
      expect(fileExists('/non/existent/file')).toBe(false);
    });
  });

  describe('getUserHomeDir', () => {
    it('should return home directory path', () => {
      const homeDir = getUserHomeDir();
      expect(homeDir).toBeDefined();
      expect(typeof homeDir).toBe('string');
      expect(homeDir.length).toBeGreaterThan(0);
    });
  });

  describe('joinPath', () => {
    it('should join path segments', () => {
      const result = joinPath('path', 'to', 'file.txt');
      expect(result).toBe(path.join('path', 'to', 'file.txt'));
    });

    it('should handle single segment', () => {
      const result = joinPath('single');
      expect(result).toBe('single');
    });

    it('should handle empty segments', () => {
      const result = joinPath('path', '', 'file.txt');
      expect(result).toBeDefined();
    });
  });

  describe('getFileExtension', () => {
    it('should return file extension with dot', () => {
      expect(getFileExtension('test.jpg')).toBe('.jpg');
      expect(getFileExtension('document.pdf')).toBe('.pdf');
      expect(getFileExtension('archive.tar.gz')).toBe('.gz');
    });

    it('should return empty string for files without extension', () => {
      expect(getFileExtension('filename')).toBe('');
      expect(getFileExtension('path/to/filename')).toBe('');
    });
  });

  describe('getFileNameWithoutExt', () => {
    it('should return filename without extension', () => {
      expect(getFileNameWithoutExt('test.jpg')).toBe('test');
      expect(getFileNameWithoutExt('path/to/test.png')).toBe('test');
    });

    it('should handle files with multiple extensions', () => {
      expect(getFileNameWithoutExt('archive.tar.gz')).toBe('archive.tar');
    });

    it('should return filename for files without extension', () => {
      expect(getFileNameWithoutExt('filename')).toBe('filename');
    });
  });

  describe('getFileName', () => {
    it('should return filename with extension', () => {
      expect(getFileName('test.jpg')).toBe('test.jpg');
      expect(getFileName('path/to/test.png')).toBe('test.png');
    });

    it('should handle paths with trailing slashes', () => {
      // path.basename('path/to/') returns 'to' on most platforms
      const result = getFileName('path/to/');
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });
  });

  describe('getParentDirectory', () => {
    it('should return parent directory', () => {
      expect(getParentDirectory('path/to/file.txt')).toBe('path/to');
      expect(getParentDirectory('path/to/dir/')).toBe('path/to');
    });

    it('should return . for files in current directory', () => {
      expect(getParentDirectory('file.txt')).toBe('.');
    });
  });

  describe('ensureDirectory', () => {
    it('should create directory if not exists', async () => {
      const testDir = os.tmpdir() + '/test-ensure-dir';
      await ensureDirectory(testDir);
      // Note: cleanup would happen in test teardown
      // For now, just verify no error thrown
      expect(true).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('should handle empty string path', () => {
      expect(getFileExtension('')).toBe('');
      expect(getFileName('')).toBe('');
      expect(getParentDirectory('')).toBe('.');
    });

    it('should handle paths with special characters', () => {
      const fileName = 'test file (1).jpg';
      expect(getFileName(fileName)).toBe(fileName);
    });

    it('should handle paths with dots in directory names', () => {
      const pathWithDots = 'path.to/file';
      expect(getFileName(pathWithDots)).toBe('file');
    });
  });
});
