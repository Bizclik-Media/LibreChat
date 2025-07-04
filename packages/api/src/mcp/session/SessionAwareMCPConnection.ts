import { logger } from '@librechat/data-schemas';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { MCPConnection } from '../connection';
import type { MCPOAuthTokens } from '../oauth/types';
import type * as t from '../types';
import type * as sessionTypes from './types';

/**
 * Session-aware extension of MCPConnection that adds session management functionality
 * without modifying the original class. This reduces maintenance burden on upstream merges.
 */
export class SessionAwareMCPConnection extends MCPConnection {
  private sessionInfo: sessionTypes.MCPSessionInfo | null = null;
  private sessionTerminated = false;

  constructor(
    serverName: string,
    options: t.MCPOptions,
    userId?: string,
    oauthTokens?: MCPOAuthTokens | null,
  ) {
    super(serverName, options, userId, oauthTokens);
    this.setupSessionEventListeners();
  }

  /** Get current session information */
  public getSessionInfo(): sessionTypes.MCPSessionInfo | null {
    return this.sessionInfo;
  }

  /** Set session information */
  public setSession(sessionInfo: sessionTypes.MCPSessionInfo): void {
    this.sessionInfo = sessionInfo;
    this.sessionTerminated = false;
    logger.debug(`${this.getSessionLogPrefix()} Session set: ${sessionInfo.sessionId.substring(0, 8)}...`);
    this.emit('sessionCreated', sessionInfo);
  }

  /** Clear session state */
  public clearSession(): void {
    if (this.sessionInfo) {
      logger.debug(`${this.getSessionLogPrefix()} Session cleared`);
      this.sessionInfo = null;
      this.sessionTerminated = false;
      this.emit('sessionCleared');
    }
  }

  /** Mark session as terminated */
  public markSessionTerminated(): void {
    if (this.sessionInfo) {
      this.sessionInfo.terminated = true;
      this.sessionTerminated = true;
      logger.info(`${this.getSessionLogPrefix()} Session marked as terminated`);
      this.emit('sessionTerminated', this.sessionInfo);
    }
  }

  /** Get log prefix with session information */
  private getSessionLogPrefix(): string {
    // Access the private method through any cast since it's not exposed
    const basePrefix = (this as any).getLogPrefix ? (this as any).getLogPrefix() : `[MCP][${this.serverName}]`;
    const sessionPart = this.sessionInfo?.sessionId ? `[Session: ${this.sessionInfo.sessionId.substring(0, 8)}...]` : '';
    return basePrefix.replace(`[${this.serverName}]`, `${sessionPart}[${this.serverName}]`);
  }

  /** Validate session ID format per MCP specification */
  private isValidSessionId(sessionId: string): boolean {
    // Session ID must only contain visible ASCII characters (0x21 to 0x7E)
    return /^[\x21-\x7E]+$/.test(sessionId);
  }

  /** Setup session-specific event listeners */
  private setupSessionEventListeners(): void {
    // Listen for connection changes to handle session lifecycle
    this.on('connectionChange', (state: t.ConnectionState) => {
      if (state === 'connected') {
        // Extract session from connection after successful connect
        this.extractSessionFromConnection().catch((error) => {
          logger.debug(`${this.getSessionLogPrefix()} Could not extract session ID:`, error);
        });
      } else if (state === 'disconnected') {
        // Clear session state when disconnected
        this.clearSession();
      }
    });
  }

  /** Override connect to add session support for streamable HTTP */
  public async connect(): Promise<void> {
    // Call parent connect first
    await super.connect();

    // Add session handling for streamable HTTP transport after connection
    const options = (this as any).options;
    if (options && this.isStreamableHTTPOptions(options)) {
      const transport = (this as any).transport;
      if (transport) {
        this.enhanceStreamableHTTPTransport(transport, options);
      }
    }
  }

  /** Check if options are for streamable HTTP transport */
  private isStreamableHTTPOptions(options: t.MCPOptions): options is t.StreamableHTTPOptions {
    if ('url' in options && options.type === 'streamable-http') {
      const protocol = new URL(options.url).protocol;
      return protocol !== 'ws:' && protocol !== 'wss:';
    }
    return false;
  }

  /** Enhance streamable HTTP transport with session support */
  private enhanceStreamableHTTPTransport(transport: any, options: t.StreamableHTTPOptions): void {
    const url = new URL(options.url);
    logger.info(`${this.getSessionLogPrefix()} Creating streamable HTTP transport with session support: ${url.toString()}`);

    // Store original handlers
    const originalOnError = transport.onerror;
    const originalOnMessage = transport.onmessage;

    // Enhanced error handler with session error detection
    transport.onerror = (error: Error | unknown) => {
      logger.error(`${this.getSessionLogPrefix()} Streamable HTTP transport error:`, error);

      // Check for session-related errors
      if (this.sessionInfo) {
        const sessionError = this.detectSessionError(error);
        if (sessionError) {
          logger.warn(`${this.getSessionLogPrefix()} Session error detected: ${sessionError.type}`);
          this.emit('sessionError', sessionError);

          // Handle session recovery for specific error types
          if (sessionError.type === 'session_terminated' || sessionError.type === 'session_expired') {
            this.handleSessionRecovery(sessionError).catch((recoveryError) => {
              logger.error(`${this.getSessionLogPrefix()} Session recovery failed:`, recoveryError);
            });
            return; // Don't emit connection error for recoverable session errors
          }
        }
      }

      // Call original error handler
      if (originalOnError) {
        originalOnError(error);
      }
    };

    // Enhanced message handler for session debugging
    transport.onmessage = (message: JSONRPCMessage) => {
      logger.debug(`${this.getSessionLogPrefix()} Message received: ${JSON.stringify(message)}`);

      // Call original message handler
      if (originalOnMessage) {
        originalOnMessage(message);
      }
    };
  }

  /**
   * Extract session ID from streamable HTTP connection after initialization.
   * This is a workaround since the MCP SDK doesn't expose session IDs directly.
   */
  private async extractSessionFromConnection(): Promise<void> {
    try {
      // For streamable HTTP, check if the transport has session info
      const transport = (this as any).transport;
      if (transport && 'sessionId' in transport) {
        const sessionId = transport.sessionId;
        if (sessionId && typeof sessionId === 'string') {
          const sessionInfo: sessionTypes.MCPSessionInfo = {
            sessionId,
            createdAt: new Date(),
            terminated: false,
          };

          this.setSession(sessionInfo);
          logger.info(`${this.getSessionLogPrefix()} Session extracted: ${sessionId.substring(0, 8)}...`);
        }
      }
    } catch (error) {
      logger.debug(`${this.getSessionLogPrefix()} Could not extract session ID:`, error);
      // This is not a critical error - session management is optional
    }
  }

  /**
   * Handle session recovery when session is terminated or expired
   */
  private async handleSessionRecovery(sessionError: sessionTypes.SessionError): Promise<void> {
    // Access private properties through any cast
    const isReconnecting = (this as any).isReconnecting;
    const shouldStopReconnecting = (this as any).shouldStopReconnecting;
    const isInitializing = (this as any).isInitializing;

    if (isReconnecting || shouldStopReconnecting || isInitializing) {
      logger.debug(`${this.getSessionLogPrefix()} Session recovery skipped - connection state prevents recovery`);
      return;
    }

    logger.info(`${this.getSessionLogPrefix()} Starting session recovery for error: ${sessionError.type}`);

    try {
      // Clear the terminated session
      this.clearSession();

      // Set a flag to indicate we're doing session recovery
      const wasReconnecting = (this as any).isReconnecting;
      (this as any).isReconnecting = true;

      try {
        // Close current transport if it exists
        const transport = (this as any).transport;
        if (transport) {
          await transport.close();
          (this as any).transport = null;
        }

        // Wait a short delay before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Attempt to reconnect with a fresh session
        await this.connect();

        logger.info(`${this.getSessionLogPrefix()} Session recovery successful`);
      } finally {
        (this as any).isReconnecting = wasReconnecting;
      }
    } catch (error) {
      logger.error(`${this.getSessionLogPrefix()} Session recovery failed:`, error);

      // If session recovery fails, fall back to normal reconnection logic
      if (!(this as any).isReconnecting) {
        this.emit('connectionChange', 'error');
      }
      throw error;
    }
  }

  /**
   * Detect session-related errors from transport errors.
   * Since the MCP SDK doesn't expose HTTP status codes directly,
   * we need to infer session errors from error patterns.
   */
  private detectSessionError(error: unknown): sessionTypes.SessionError | null {
    if (!error || typeof error !== 'object') {
      return null;
    }

    const errorStr = error.toString().toLowerCase();
    const errorMessage = 'message' in error ? String(error.message).toLowerCase() : errorStr;

    // Check for HTTP 404 (session terminated)
    if (errorStr.includes('404') || errorMessage.includes('not found') ||
        errorMessage.includes('session not found') || errorMessage.includes('session terminated')) {
      return {
        type: 'session_terminated',
        message: 'Session has been terminated by the server',
        sessionId: this.sessionInfo?.sessionId,
      };
    }

    // Check for HTTP 400 (invalid session)
    if (errorStr.includes('400') || errorMessage.includes('bad request') ||
        errorMessage.includes('invalid session') || errorMessage.includes('session invalid')) {
      return {
        type: 'session_invalid',
        message: 'Session ID is invalid or malformed',
        sessionId: this.sessionInfo?.sessionId,
      };
    }

    // Check for session timeout/expiry
    if (errorMessage.includes('timeout') || errorMessage.includes('expired') ||
        errorMessage.includes('session expired')) {
      return {
        type: 'session_expired',
        message: 'Session has expired',
        sessionId: this.sessionInfo?.sessionId,
      };
    }

    return null;
  }

  /**
   * Terminate the current session by sending a DELETE request to the session endpoint.
   * This follows the MCP specification for explicit session termination.
   */
  private async terminateSession(): Promise<void> {
    if (!this.sessionInfo || !this.url) {
      return;
    }

    try {
      const sessionUrl = new URL(this.url);
      sessionUrl.pathname = sessionUrl.pathname.replace(/\/$/, '') + '/session';

      const headers: Record<string, string> = {
        'Mcp-Session-Id': this.sessionInfo.sessionId,
      };

      // Add OAuth token if available
      const oauthTokens = (this as any).oauthTokens;
      if (oauthTokens?.access_token) {
        headers['Authorization'] = `Bearer ${oauthTokens.access_token}`;
      }

      const response = await fetch(sessionUrl.toString(), {
        method: 'DELETE',
        headers,
      });

      if (response.ok) {
        logger.debug(`${this.getSessionLogPrefix()} Session terminated successfully`);
        this.markSessionTerminated();
      } else if (response.status === 405) {
        // Method Not Allowed - server doesn't support explicit termination
        logger.debug(`${this.getSessionLogPrefix()} Server doesn't support explicit session termination (405)`);
      } else {
        logger.warn(`${this.getSessionLogPrefix()} Session termination failed with status: ${response.status}`);
      }
    } catch (error) {
      logger.debug(`${this.getSessionLogPrefix()} Session termination request failed:`, error);
      // Not a critical error - session will expire naturally
    }
  }

  /** Override disconnect to handle session termination */
  public async disconnect(): Promise<void> {
    try {
      // Explicitly terminate session for streamable HTTP connections
      const options = (this as any).options;
      if (options && this.isStreamableHTTPOptions(options) &&
          this.sessionInfo && !this.sessionInfo.terminated) {
        try {
          await this.terminateSession();
          logger.debug(`${this.getSessionLogPrefix()} Session terminated explicitly during disconnect`);
        } catch (error) {
          logger.warn(`${this.getSessionLogPrefix()} Failed to terminate session during disconnect:`, error);
        }
      }

      // Call parent disconnect
      await super.disconnect();

      // Clear session state
      this.clearSession();
    } catch (error) {
      // Clear session state even if disconnect fails
      this.clearSession();
      throw error;
    }
  }
}
