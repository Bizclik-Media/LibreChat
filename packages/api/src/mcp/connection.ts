import { EventEmitter } from 'events';
import { logger } from '@librechat/data-schemas';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { ResourceListChangedNotificationSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { MCPOAuthTokens } from './oauth/types';
import type * as t from './types';

function isStdioOptions(options: t.MCPOptions): options is t.StdioOptions {
  return 'command' in options;
}

function isWebSocketOptions(options: t.MCPOptions): options is t.WebSocketOptions {
  if ('url' in options) {
    const protocol = new URL(options.url).protocol;
    return protocol === 'ws:' || protocol === 'wss:';
  }
  return false;
}

function isSSEOptions(options: t.MCPOptions): options is t.SSEOptions {
  if ('url' in options) {
    const protocol = new URL(options.url).protocol;
    return protocol !== 'ws:' && protocol !== 'wss:';
  }
  return false;
}

/**
 * Checks if the provided options are for a Streamable HTTP transport.
 *
 * Streamable HTTP is an MCP transport that uses HTTP POST for sending messages
 * and supports streaming responses. It provides better performance than
 * SSE transport while maintaining compatibility with most network environments.
 *
 * @param options MCP connection options to check
 * @returns True if options are for a streamable HTTP transport
 */
function isStreamableHTTPOptions(options: t.MCPOptions): options is t.StreamableHTTPOptions {
  if ('url' in options && options.type === 'streamable-http') {
    const protocol = new URL(options.url).protocol;
    return protocol !== 'ws:' && protocol !== 'wss:';
  }
  return false;
}

const FIVE_MINUTES = 5 * 60 * 1000;
export class MCPConnection extends EventEmitter {
  private static instance: MCPConnection | null = null;
  public client: Client;
  private transport: Transport | null = null; // Make this nullable
  private connectionState: t.ConnectionState = 'disconnected';
  private connectPromise: Promise<void> | null = null;
  private lastError: Error | null = null;
  private lastConfigUpdate = 0;
  private readonly CONFIG_TTL = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_RECONNECT_ATTEMPTS = 3;
  public readonly serverName: string;
  private shouldStopReconnecting = false;
  private isReconnecting = false;
  private isInitializing = false;
  private reconnectAttempts = 0;
  private readonly userId?: string;
  private lastPingTime: number;
  private oauthTokens?: MCPOAuthTokens | null;
  private oauthRequired = false;
  private sessionInfo: t.MCPSessionInfo | null = null;
  private sessionTerminated = false;
  iconPath?: string;
  timeout?: number;
  url?: string;

  constructor(
    serverName: string,
    private readonly options: t.MCPOptions,
    userId?: string,
    oauthTokens?: MCPOAuthTokens | null,
  ) {
    super();
    this.serverName = serverName;
    this.userId = userId;
    this.iconPath = options.iconPath;
    this.timeout = options.timeout;
    this.lastPingTime = Date.now();
    if (oauthTokens) {
      this.oauthTokens = oauthTokens;
    }
    this.client = new Client(
      {
        name: '@librechat/api-client',
        version: '1.2.3',
      },
      {
        capabilities: {},
      },
    );

    this.setupEventListeners();
  }

  /** Helper to generate consistent log prefixes */
  private getLogPrefix(): string {
    const userPart = this.userId ? `[User: ${this.userId}]` : '';
    const sessionPart = this.sessionInfo?.sessionId ? `[Session: ${this.sessionInfo.sessionId.substring(0, 8)}...]` : '';
    return `[MCP]${userPart}${sessionPart}[${this.serverName}]`;
  }

  /** Get current session information */
  public getSessionInfo(): t.MCPSessionInfo | null {
    return this.sessionInfo;
  }

  /** Set session information */
  private setSession(sessionInfo: t.MCPSessionInfo): void {
    this.sessionInfo = sessionInfo;
    this.sessionTerminated = false;
    logger.debug(`${this.getLogPrefix()} Session set: ${sessionInfo.sessionId.substring(0, 8)}...`);
  }

  /** Clear session state */
  private clearSession(): void {
    if (this.sessionInfo) {
      logger.debug(`${this.getLogPrefix()} Session cleared`);
      this.sessionInfo = null;
      this.sessionTerminated = false;
    }
  }

  /** Mark session as terminated */
  private markSessionTerminated(): void {
    if (this.sessionInfo) {
      this.sessionInfo.terminated = true;
      this.sessionTerminated = true;
      logger.info(`${this.getLogPrefix()} Session marked as terminated`);
    }
  }

  /** Validate session ID format per MCP specification */
  private isValidSessionId(sessionId: string): boolean {
    // Session ID must only contain visible ASCII characters (0x21 to 0x7E)
    return /^[\x21-\x7E]+$/.test(sessionId);
  }

  public static getInstance(
    serverName: string,
    options: t.MCPOptions,
    userId?: string,
  ): MCPConnection {
    if (!MCPConnection.instance) {
      MCPConnection.instance = new MCPConnection(serverName, options, userId);
    }
    return MCPConnection.instance;
  }

  public static getExistingInstance(): MCPConnection | null {
    return MCPConnection.instance;
  }

  public static async destroyInstance(): Promise<void> {
    if (MCPConnection.instance) {
      await MCPConnection.instance.disconnect();
      MCPConnection.instance = null;
    }
  }

  private emitError(error: unknown, errorContext: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`${this.getLogPrefix()} ${errorContext}: ${errorMessage}`);
    this.emit('error', new Error(`${errorContext}: ${errorMessage}`));
  }

  private constructTransport(options: t.MCPOptions): Transport {
    try {
      let type: t.MCPOptions['type'];
      if (isStdioOptions(options)) {
        type = 'stdio';
      } else if (isWebSocketOptions(options)) {
        type = 'websocket';
      } else if (isStreamableHTTPOptions(options)) {
        type = 'streamable-http';
      } else if (isSSEOptions(options)) {
        type = 'sse';
      } else {
        throw new Error(
          'Cannot infer transport type: options.type is not provided and cannot be inferred from other properties.',
        );
      }

      switch (type) {
        case 'stdio':
          if (!isStdioOptions(options)) {
            throw new Error('Invalid options for stdio transport.');
          }
          return new StdioClientTransport({
            command: options.command,
            args: options.args,
            // workaround bug of mcp sdk that can't pass env:
            // https://github.com/modelcontextprotocol/typescript-sdk/issues/216
            env: { ...getDefaultEnvironment(), ...(options.env ?? {}) },
          });

        case 'websocket':
          if (!isWebSocketOptions(options)) {
            throw new Error('Invalid options for websocket transport.');
          }
          this.url = options.url;
          return new WebSocketClientTransport(new URL(options.url));

        case 'sse': {
          if (!isSSEOptions(options)) {
            throw new Error('Invalid options for sse transport.');
          }
          this.url = options.url;
          const url = new URL(options.url);
          logger.info(`${this.getLogPrefix()} Creating SSE transport: ${url.toString()}`);
          const abortController = new AbortController();

          /** Add OAuth token to headers if available */
          const headers = { ...options.headers };
          if (this.oauthTokens?.access_token) {
            headers['Authorization'] = `Bearer ${this.oauthTokens.access_token}`;
          }

          const transport = new SSEClientTransport(url, {
            requestInit: {
              headers,
              signal: abortController.signal,
            },
            eventSourceInit: {
              fetch: (url, init) => {
                const fetchHeaders = new Headers(Object.assign({}, init?.headers, headers));
                return fetch(url, {
                  ...init,
                  headers: fetchHeaders,
                });
              },
            },
          });

          transport.onclose = () => {
            logger.info(`${this.getLogPrefix()} SSE transport closed`);
            this.emit('connectionChange', 'disconnected');
          };

          transport.onerror = (error) => {
            logger.error(`${this.getLogPrefix()} SSE transport error:`, error);
            this.emitError(error, 'SSE transport error:');
          };

          transport.onmessage = (message) => {
            logger.info(`${this.getLogPrefix()} Message received: ${JSON.stringify(message)}`);
          };

          this.setupTransportErrorHandlers(transport);
          return transport;
        }

        case 'streamable-http': {
          if (!isStreamableHTTPOptions(options)) {
            throw new Error('Invalid options for streamable-http transport.');
          }
          this.url = options.url;
          const url = new URL(options.url);
          logger.info(
            `${this.getLogPrefix()} Creating streamable-http transport with session support: ${url.toString()}`,
          );

          // Add OAuth token to headers if available
          const headers = { ...options.headers };
          if (this.oauthTokens?.access_token) {
            headers['Authorization'] = `Bearer ${this.oauthTokens.access_token}`;
          }

          // Create transport with session ID if available
          const transportOptions: any = {
            requestInit: {
              headers,
            },
          };

          // Include session ID if we have one from a previous connection
          if (this.sessionInfo?.sessionId) {
            transportOptions.sessionId = this.sessionInfo.sessionId;
            logger.debug(`${this.getLogPrefix()} Using existing session ID: ${this.sessionInfo.sessionId.substring(0, 8)}...`);
          }

          const transport = new StreamableHTTPClientTransport(url, transportOptions);

          transport.onclose = () => {
            logger.info(`${this.getLogPrefix()} Streamable HTTP transport closed`);
            this.emit('connectionChange', 'disconnected');
          };

          transport.onerror = (error: Error | unknown) => {
            logger.error(`${this.getLogPrefix()} Streamable HTTP transport error:`, error);
            this.emitError(error, 'Streamable HTTP transport error:');
          };

          transport.onmessage = (message: JSONRPCMessage) => {
            logger.debug(`${this.getLogPrefix()} Message received: ${JSON.stringify(message)}`);
          };

          this.setupTransportErrorHandlers(transport);
          return transport;
        }

        default: {
          throw new Error(`Unsupported transport type: ${type}`);
        }
      }
    } catch (error) {
      this.emitError(error, 'Failed to construct transport:');
      throw error;
    }
  }

  private setupEventListeners(): void {
    this.isInitializing = true;
    this.on('connectionChange', (state: t.ConnectionState) => {
      this.connectionState = state;
      if (state === 'connected') {
        this.isReconnecting = false;
        this.isInitializing = false;
        this.shouldStopReconnecting = false;
        this.reconnectAttempts = 0;
        /**
         * // FOR DEBUGGING
         * // this.client.setRequestHandler(PingRequestSchema, async (request, extra) => {
         * //    logger.info(`[MCP][${this.serverName}] PingRequest: ${JSON.stringify(request)}`);
         * //    if (getEventListeners && extra.signal) {
         * //      const listenerCount = getEventListeners(extra.signal, 'abort').length;
         * //      logger.debug(`Signal has ${listenerCount} abort listeners`);
         * //    }
         * //    return {};
         * //  });
         */
      } else if (state === 'error' && !this.isReconnecting && !this.isInitializing) {
        this.handleReconnection().catch((error) => {
          logger.error(`${this.getLogPrefix()} Reconnection handler failed:`, error);
        });
      }
    });

    this.subscribeToResources();
  }

  private async handleReconnection(): Promise<void> {
    if (
      this.isReconnecting ||
      this.shouldStopReconnecting ||
      this.isInitializing ||
      this.oauthRequired
    ) {
      if (this.oauthRequired) {
        logger.info(`${this.getLogPrefix()} OAuth required, skipping reconnection attempts`);
      }
      return;
    }

    this.isReconnecting = true;
    const backoffDelay = (attempt: number) => Math.min(1000 * Math.pow(2, attempt), 30000);

    try {
      while (
        this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS &&
        !(this.shouldStopReconnecting as boolean)
      ) {
        this.reconnectAttempts++;
        const delay = backoffDelay(this.reconnectAttempts);

        logger.info(
          `${this.getLogPrefix()} Reconnecting ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} (delay: ${delay}ms)`,
        );

        await new Promise((resolve) => setTimeout(resolve, delay));

        try {
          await this.connect();
          this.reconnectAttempts = 0;
          return;
        } catch (error) {
          logger.error(`${this.getLogPrefix()} Reconnection attempt failed:`, error);

          if (
            this.reconnectAttempts === this.MAX_RECONNECT_ATTEMPTS ||
            (this.shouldStopReconnecting as boolean)
          ) {
            logger.error(`${this.getLogPrefix()} Stopping reconnection attempts`);
            return;
          }
        }
      }
    } finally {
      this.isReconnecting = false;
    }
  }

  /**
   * Handle session recovery when session is terminated or expired
   */
  private async handleSessionRecovery(sessionError: t.SessionError): Promise<void> {
    if (this.isReconnecting || this.shouldStopReconnecting || this.isInitializing) {
      logger.debug(`${this.getLogPrefix()} Session recovery skipped - connection state prevents recovery`);
      return;
    }

    logger.info(`${this.getLogPrefix()} Starting session recovery for error: ${sessionError.type}`);

    try {
      // Clear the terminated session
      this.clearSession();

      // Set a flag to indicate we're doing session recovery
      const wasReconnecting = this.isReconnecting;
      this.isReconnecting = true;

      try {
        // Close current transport if it exists
        if (this.transport) {
          await this.transport.close();
          this.transport = null;
        }

        // Wait a short delay before retrying
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Attempt to reconnect with a fresh session
        await this.connect();

        logger.info(`${this.getLogPrefix()} Session recovery successful`);
      } finally {
        this.isReconnecting = wasReconnecting;
      }
    } catch (error) {
      logger.error(`${this.getLogPrefix()} Session recovery failed:`, error);

      // If session recovery fails, fall back to normal reconnection logic
      if (!this.isReconnecting) {
        this.emit('connectionChange', 'error');
      }
      throw error;
    }
  }

  private subscribeToResources(): void {
    this.client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => {
      this.invalidateCache();
      this.emit('resourcesChanged');
    });
  }

  private invalidateCache(): void {
    // this.cachedConfig = null;
    this.lastConfigUpdate = 0;
  }

  async connectClient(): Promise<void> {
    if (this.connectionState === 'connected') {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    if (this.shouldStopReconnecting) {
      return;
    }

    this.emit('connectionChange', 'connecting');

    this.connectPromise = (async () => {
      try {
        if (this.transport) {
          try {
            await this.client.close();
            this.transport = null;
            // Clear session state when closing transport
            this.clearSession();
          } catch (error) {
            logger.warn(`${this.getLogPrefix()} Error closing connection:`, error);
          }
        }

        this.transport = this.constructTransport(this.options);
        this.setupTransportDebugHandlers();

        const connectTimeout = this.options.initTimeout ?? 120000;
        await Promise.race([
          this.client.connect(this.transport),
          new Promise((_resolve, reject) =>
            setTimeout(
              () => reject(new Error(`Connection timeout after ${connectTimeout}ms`)),
              connectTimeout,
            ),
          ),
        ]);

        // Extract session ID for streamable-http connections
        if (isStreamableHTTPOptions(this.options)) {
          await this.extractSessionFromConnection();
        }

        this.connectionState = 'connected';
        this.emit('connectionChange', 'connected');
        this.reconnectAttempts = 0;
      } catch (error) {
        // Check if it's an OAuth authentication error
        if (this.isOAuthError(error)) {
          logger.warn(`${this.getLogPrefix()} OAuth authentication required`);
          this.oauthRequired = true;
          const serverUrl = this.url;
          logger.debug(`${this.getLogPrefix()} Server URL for OAuth: ${serverUrl}`);

          const oauthTimeout = this.options.initTimeout ?? 60000;
          /** Promise that will resolve when OAuth is handled */
          const oauthHandledPromise = new Promise<void>((resolve, reject) => {
            let timeoutId: NodeJS.Timeout | null = null;
            let oauthHandledListener: (() => void) | null = null;
            let oauthFailedListener: ((error: Error) => void) | null = null;

            /** Cleanup function to remove listeners and clear timeout */
            const cleanup = () => {
              if (timeoutId) {
                clearTimeout(timeoutId);
              }
              if (oauthHandledListener) {
                this.off('oauthHandled', oauthHandledListener);
              }
              if (oauthFailedListener) {
                this.off('oauthFailed', oauthFailedListener);
              }
            };

            // Success handler
            oauthHandledListener = () => {
              cleanup();
              resolve();
            };

            // Failure handler
            oauthFailedListener = (error: Error) => {
              cleanup();
              reject(error);
            };

            // Timeout handler
            timeoutId = setTimeout(() => {
              cleanup();
              reject(new Error(`OAuth handling timeout after ${oauthTimeout}ms`));
            }, oauthTimeout);

            // Listen for both success and failure events
            this.once('oauthHandled', oauthHandledListener);
            this.once('oauthFailed', oauthFailedListener);
          });

          // Emit the event
          this.emit('oauthRequired', {
            serverName: this.serverName,
            error,
            serverUrl,
            userId: this.userId,
          });

          try {
            // Wait for OAuth to be handled
            await oauthHandledPromise;
            // Reset the oauthRequired flag
            this.oauthRequired = false;
            // Don't throw the error - just return so connection can be retried
            logger.info(
              `${this.getLogPrefix()} OAuth handled successfully, connection will be retried`,
            );
            return;
          } catch (oauthError) {
            // OAuth failed or timed out
            this.oauthRequired = false;
            logger.error(`${this.getLogPrefix()} OAuth handling failed:`, oauthError);
            // Re-throw the original authentication error
            throw error;
          }
        }

        this.connectionState = 'error';
        this.emit('connectionChange', 'error');
        throw error;
      } finally {
        this.connectPromise = null;
      }
    })();

    return this.connectPromise;
  }

  private setupTransportDebugHandlers(): void {
    if (!this.transport) {
      return;
    }

    this.transport.onmessage = (msg) => {
      logger.debug(`${this.getLogPrefix()} Transport received: ${JSON.stringify(msg)}`);
    };

    const originalSend = this.transport.send.bind(this.transport);
    this.transport.send = async (msg) => {
      if ('result' in msg && !('method' in msg) && Object.keys(msg.result ?? {}).length === 0) {
        if (Date.now() - this.lastPingTime < FIVE_MINUTES) {
          throw new Error('Empty result');
        }
        this.lastPingTime = Date.now();
      }
      logger.debug(`${this.getLogPrefix()} Transport sending: ${JSON.stringify(msg)}`);
      return originalSend(msg);
    };
  }

  /**
   * Extract session ID from streamable HTTP connection after initialization.
   * This is a workaround since the MCP SDK doesn't expose session IDs directly.
   */
  private async extractSessionFromConnection(): Promise<void> {
    try {
      // For streamable HTTP, we need to make a test request to see if we get a session ID
      // The session ID would have been set during the initialization process
      // Since the MCP SDK handles this internally, we'll check if the transport has session info

      if (this.transport && 'sessionId' in this.transport) {
        const sessionId = (this.transport as any).sessionId;
        if (sessionId && typeof sessionId === 'string') {
          const sessionInfo: t.MCPSessionInfo = {
            sessionId,
            createdAt: new Date(),
            terminated: false,
          };

          this.setSession(sessionInfo);
          logger.info(`${this.getLogPrefix()} Session extracted: ${sessionId.substring(0, 8)}...`);
          this.emit('sessionCreated', sessionInfo);
        }
      }
    } catch (error) {
      logger.debug(`${this.getLogPrefix()} Could not extract session ID:`, error);
      // This is not a critical error - session management is optional
    }
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
      if (this.oauthTokens?.access_token) {
        headers['Authorization'] = `Bearer ${this.oauthTokens.access_token}`;
      }

      const response = await fetch(sessionUrl.toString(), {
        method: 'DELETE',
        headers,
      });

      if (response.ok) {
        logger.debug(`${this.getLogPrefix()} Session terminated successfully`);
        this.markSessionTerminated();
      } else if (response.status === 405) {
        // Method Not Allowed - server doesn't support explicit termination
        logger.debug(`${this.getLogPrefix()} Server doesn't support explicit session termination (405)`);
      } else {
        logger.warn(`${this.getLogPrefix()} Session termination failed with status: ${response.status}`);
      }
    } catch (error) {
      logger.debug(`${this.getLogPrefix()} Session termination request failed:`, error);
      // Not a critical error - session will expire naturally
    }
  }

  async connect(): Promise<void> {
    try {
      await this.disconnect();
      await this.connectClient();
      if (!this.isConnected()) {
        throw new Error('Connection not established');
      }
    } catch (error) {
      logger.error(`${this.getLogPrefix()} Connection failed:`, error);
      throw error;
    }
  }

  private setupTransportErrorHandlers(transport: Transport): void {
    transport.onerror = (error) => {
      logger.error(`${this.getLogPrefix()} Transport error:`, error);

      // Check for session-related errors
      if (isStreamableHTTPOptions(this.options) && this.sessionInfo) {
        const sessionError = this.detectSessionError(error);
        if (sessionError) {
          logger.warn(`${this.getLogPrefix()} Session error detected: ${sessionError.type}`);
          this.emit('sessionError', sessionError);

          // Handle session recovery for specific error types
          if (sessionError.type === 'session_terminated' || sessionError.type === 'session_expired') {
            this.handleSessionRecovery(sessionError).catch((recoveryError) => {
              logger.error(`${this.getLogPrefix()} Session recovery failed:`, recoveryError);
            });
            return; // Don't emit connection error for recoverable session errors
          }
        }
      }

      // Check if it's an OAuth authentication error
      if (error && typeof error === 'object' && 'code' in error) {
        const errorCode = (error as unknown as { code?: number }).code;
        if (errorCode === 401 || errorCode === 403) {
          logger.warn(`${this.getLogPrefix()} OAuth authentication error detected`);
          this.emit('oauthError', error);
        }
      }

      this.emit('connectionChange', 'error');
    };
  }

  /**
   * Detect session-related errors from transport errors.
   * Since the MCP SDK doesn't expose HTTP status codes directly,
   * we need to infer session errors from error patterns.
   */
  private detectSessionError(error: unknown): t.SessionError | null {
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
        timestamp: new Date(),
      };
    }

    // Check for HTTP 400 (invalid session)
    if (errorStr.includes('400') || errorMessage.includes('bad request') ||
        errorMessage.includes('invalid session') || errorMessage.includes('session invalid')) {
      return {
        type: 'session_invalid',
        message: 'Session ID is invalid or malformed',
        sessionId: this.sessionInfo?.sessionId,
        timestamp: new Date(),
      };
    }

    // Check for session timeout/expiry
    if (errorMessage.includes('timeout') || errorMessage.includes('expired') ||
        errorMessage.includes('session expired')) {
      return {
        type: 'session_expired',
        message: 'Session has expired',
        sessionId: this.sessionInfo?.sessionId,
        timestamp: new Date(),
      };
    }

    return null;
  }

  public async disconnect(): Promise<void> {
    try {
      if (this.transport) {
        // Explicitly terminate session for streamable HTTP connections
        if (isStreamableHTTPOptions(this.options) && this.sessionInfo && !this.sessionInfo.terminated) {
          try {
            await this.terminateSession();
            logger.debug(`${this.getLogPrefix()} Session terminated explicitly during disconnect`);
          } catch (error) {
            logger.warn(`${this.getLogPrefix()} Failed to terminate session during disconnect:`, error);
          }
        }

        await this.client.close();
        this.transport = null;
      }

      // Clear session state
      this.clearSession();

      if (this.connectionState === 'disconnected') {
        return;
      }
      this.connectionState = 'disconnected';
      this.emit('connectionChange', 'disconnected');
    } catch (error) {
      this.emit('error', error);
      throw error;
    } finally {
      this.invalidateCache();
      this.connectPromise = null;
    }
  }

  async fetchResources(): Promise<t.MCPResource[]> {
    try {
      const { resources } = await this.client.listResources();
      return resources;
    } catch (error) {
      this.emitError(error, 'Failed to fetch resources:');
      return [];
    }
  }

  async fetchTools() {
    try {
      const { tools } = await this.client.listTools();
      return tools;
    } catch (error) {
      this.emitError(error, 'Failed to fetch tools:');
      return [];
    }
  }

  async fetchPrompts(): Promise<t.MCPPrompt[]> {
    try {
      const { prompts } = await this.client.listPrompts();
      return prompts;
    } catch (error) {
      this.emitError(error, 'Failed to fetch prompts:');
      return [];
    }
  }

  // public async modifyConfig(config: ContinueConfig): Promise<ContinueConfig> {
  //   try {
  //     // Check cache
  //     if (this.cachedConfig && Date.now() - this.lastConfigUpdate < this.CONFIG_TTL) {
  //       return this.cachedConfig;
  //     }

  //     await this.connectClient();

  //     // Fetch and process resources
  //     const resources = await this.fetchResources();
  //     const submenuItems = resources.map(resource => ({
  //       title: resource.name,
  //       description: resource.description,
  //       id: resource.uri,
  //     }));

  //     if (!config.contextProviders) {
  //       config.contextProviders = [];
  //     }

  //     config.contextProviders.push(
  //       new MCPContextProvider({
  //         submenuItems,
  //         client: this.client,
  //       }),
  //     );

  //     // Fetch and process tools
  //     const tools = await this.fetchTools();
  //     const continueTools: Tool[] = tools.map(tool => ({
  //       displayTitle: tool.name,
  //       function: {
  //         description: tool.description,
  //         name: tool.name,
  //         parameters: tool.inputSchema,
  //       },
  //       readonly: false,
  //       type: 'function',
  //       wouldLikeTo: `use the ${tool.name} tool`,
  //       uri: `mcp://${tool.name}`,
  //     }));

  //     config.tools = [...(config.tools || []), ...continueTools];

  //     // Fetch and process prompts
  //     const prompts = await this.fetchPrompts();
  //     if (!config.slashCommands) {
  //       config.slashCommands = [];
  //     }

  //     const slashCommands: SlashCommand[] = prompts.map(prompt =>
  //       constructMcpSlashCommand(
  //         this.client,
  //         prompt.name,
  //         prompt.description,
  //         prompt.arguments?.map(a => a.name),
  //       ),
  //     );
  //     config.slashCommands.push(...slashCommands);

  //     // Update cache
  //     this.cachedConfig = config;
  //     this.lastConfigUpdate = Date.now();

  //     return config;
  //   } catch (error) {
  //     this.emit('error', error);
  //     // Return original config if modification fails
  //     return config;
  //   }
  // }

  public async isConnected(): Promise<boolean> {
    try {
      await this.client.ping();
      return this.connectionState === 'connected';
    } catch (error) {
      logger.error(`${this.getLogPrefix()} Ping failed:`, error);
      return false;
    }
  }

  public setOAuthTokens(tokens: MCPOAuthTokens): void {
    this.oauthTokens = tokens;
  }

  private isOAuthError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false;
    }

    // Check for SSE error with 401 status
    if ('message' in error && typeof error.message === 'string') {
      return error.message.includes('401') || error.message.includes('Non-200 status code (401)');
    }

    // Check for error code
    if ('code' in error) {
      const code = (error as { code?: number }).code;
      return code === 401 || code === 403;
    }

    return false;
  }
}
