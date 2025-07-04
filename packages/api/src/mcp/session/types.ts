/**
 * Session management types for MCP connections
 * 
 * This module contains all session-related types that were previously
 * mixed into the main types file. Keeping them separate reduces
 * maintenance burden on upstream merges.
 */

/** Session management types for MCP connections */
export interface MCPSessionInfo {
  /** The session ID assigned by the server */
  sessionId: string;
  /** Timestamp when the session was created */
  createdAt: Date;
  /** Whether the session has been terminated */
  terminated: boolean;
}

/** Session error types based on MCP specification */
export type SessionErrorType = 'session_terminated' | 'session_invalid' | 'session_expired';

/** Session-related error information */
export interface SessionError {
  type: SessionErrorType;
  sessionId?: string;
  message: string;
}

/** Extended connection state that includes session-aware states */
export type SessionAwareConnectionState = 
  | 'disconnected' 
  | 'connecting' 
  | 'connected' 
  | 'error' 
  | 'reconnecting';

/** Session event types for event emitters */
export interface SessionEvents {
  sessionCreated: (sessionInfo: MCPSessionInfo) => void;
  sessionTerminated: (sessionInfo: MCPSessionInfo) => void;
  sessionCleared: () => void;
  sessionError: (error: SessionError) => void;
}

/** Session statistics for monitoring */
export interface SessionStats {
  totalUsers: number;
  totalSessions: number;
  activeSessions: number;
}

/** Session tracking data structure */
export type SessionTracker = Map<string, Map<string, MCPSessionInfo | null>>;
