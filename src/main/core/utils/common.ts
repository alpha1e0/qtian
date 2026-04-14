import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';

/**
 * Get current time as formatted string
 * @returns Time string in format 'YYYY-MM-DD HH:MM:SS'
 */
export function currentTimeObjToStr(): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');

  const year = now.getFullYear();
  const month = pad(now.getMonth() + 1);
  const day = pad(now.getDate());
  const hours = pad(now.getHours());
  const minutes = pad(now.getMinutes());
  const seconds = pad(now.getSeconds());

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * Convert time string to Date object
 * @param strTime - Time string in format 'YYYY-MM-DD HH:MM:SS'
 * @returns Date object
 */
export function timeStrToObj(strTime: string): Date {
  const [datePart, timePart] = strTime.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hours, minutes, seconds] = timePart.split(':').map(Number);

  return new Date(year, month - 1, day, hours, minutes, seconds);
}

/**
 * Generate a random string
 * @param length - Length of the random string (default: 6)
 * @returns Random string containing letters and numbers
 */
export function generateRandomString(length: number = 6): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a unique ID using UUID v4
 * @returns UUID string
 */
export function generateUniqueId(): string {
  return uuidv4();
}

/**
 * Get file size in megabytes
 * @param filePath - Path to file
 * @returns File size in MB rounded to 3 decimal places
 */
export function getFileSizeMB(filePath: string): number {
  const stats = require('fs').statSync(filePath);
  return Math.round((stats.size / 1024 / 1024) * 1000) / 1000;
}

/**
 * Get file size in bytes
 * @param filePath - Path to file
 * @returns File size in bytes
 */
export function getFileSizeBytes(filePath: string): number {
  const stats = require('fs').statSync(filePath);
  return stats.size;
}

/**
 * Check if a file exists
 * @param filePath - Path to file
 * @returns True if file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a directory exists
 * @param dirPath - Path to directory
 * @returns True if directory exists
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read JSON file
 * @param filePath - Path to JSON file
 * @returns Parsed JSON object
 */
export async function readJsonFile<T = any>(filePath: string): Promise<T> {
  const content = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(content) as T;
}

/**
 * Write JSON file
 * @param filePath - Path to JSON file
 * @param data - Object to write
 */
export async function writeJsonFile(filePath: string, data: any): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Deep sleep for specified milliseconds
 * @param ms - Milliseconds to sleep
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if running in development mode
 * @returns True if in development mode
 */
export function isDevelopment(): boolean {
  return process.env.NODE_ENV !== 'production';
}

/**
 * Check if running on Windows
 * @returns True if platform is win32
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Check if running on macOS
 * @returns True if platform is darwin
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Check if running on Linux
 * @returns True if platform is linux
 */
export function isLinux(): boolean {
  return process.platform === 'linux';
}

/**
 * Format number with thousands separator
 * @param num - Number to format
 * @returns Formatted string
 */
export function formatNumber(num: number): string {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Truncate string to specified length
 * @param str - String to truncate
 * @param maxLength - Maximum length
 * @param suffix - Suffix to add if truncated (default: '...')
 * @returns Truncated string
 */
export function truncateString(str: string, maxLength: number, suffix: string = '...'): string {
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength - suffix.length) + suffix;
}

/**
 * Debounce function execution
 * @param func - Function to debounce
 * @param wait - Wait time in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

/**
 * Throttle function execution
 * @param func - Function to throttle
 * @param limit - Time limit in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
