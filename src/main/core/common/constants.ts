/**
 * Application Version
 */
export const VERSION = '1.0.0';

/**
 * Enable content mixing (base64 encoding)
 */
export const ENABLE_MIX = true;

/**
 * MIME type mapping for supported image formats
 */
export const MIME_MAP: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.JPG': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.JPEG': 'image/jpeg',
  '.png': 'image/png',
  '.PNG': 'image/png',
  '.gif': 'image/gif',
  '.GIF': 'image/gif',
};
