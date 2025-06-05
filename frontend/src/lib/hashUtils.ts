import { sha256 } from 'js-sha256';

/**
 * Calculates the SHA-256 hash of a string.
 * @param content The string content to hash.
 * @returns The SHA-256 hash as a hexadecimal string.
 */
export function calculateHash(content: string): string {
  return sha256(content);
} 