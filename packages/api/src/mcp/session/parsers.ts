import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type * as t from '../types';
import { formatToolContent as originalFormatToolContent } from '../parsers';

/**
 * Session-aware wrapper for the formatToolContent function.
 * This maintains the same API but uses the correct MCP SDK types.
 * 
 * This wrapper approach avoids modifying the original parsers.ts file,
 * reducing maintenance burden on upstream merges.
 */

/**
 * Format tool content with session-aware type handling
 * 
 * @param result - The CallToolResult object from MCP SDK
 * @param provider - The provider name (google, anthropic, openai)
 * @returns Tuple of content and image_urls
 */
export function formatToolContent(
  result: CallToolResult,
  provider: t.Provider,
): t.FormattedContentResult {
  // The original function expects the same type, just with different import
  // We can safely cast since CallToolResult is the correct type from the MCP SDK
  return originalFormatToolContent(result as any, provider);
}

// Re-export other functions from the original parsers module for convenience
export * from '../parsers';
