/**
 * Session Management Module for MCP
 * 
 * This module provides session-aware extensions of the core MCP classes
 * without modifying the original files. This approach reduces maintenance
 * burden when merging from upstream repositories.
 * 
 * Usage:
 * - Replace MCPConnection imports with SessionAwareMCPConnection
 * - Replace MCPManager imports with SessionAwareMCPManager  
 * - Use session-aware parsers for consistent type handling
 */

// Export session-aware classes
export { SessionAwareMCPConnection } from './SessionAwareMCPConnection';
export { SessionAwareMCPManager } from './SessionAwareMCPManager';

// Export session-aware parsers
export { formatToolContent } from './parsers';

// Export session types
export * from './types';

// Re-export original types for convenience
export type * from '../types';
