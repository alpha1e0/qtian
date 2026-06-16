/**
 * Application Version
 */
export const VERSION = '1.0.0';

/**
 * Enable content mixing (base64 encoding)
 */
export const ENABLE_MIX = true;

/**
 * MIME type mapping for supported image and attachment formats
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
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.zip': 'application/zip',
  '.gz': 'application/gzip',
  '.json': 'application/json',
  '.html': 'text/html',
};
