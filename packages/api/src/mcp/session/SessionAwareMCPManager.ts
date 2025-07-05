import { logger } from '@librechat/data-schemas';
import { MCPManager } from '../manager';
import { SessionAwareMCPConnection } from './SessionAwareMCPConnection';
import { CONSTANTS } from '../enum';
import type * as sessionTypes from './types';

/**
 * Session-aware extension of MCPManager that adds session tracking functionality
 * without modifying the original class. This reduces maintenance burden on upstream merges.
 *
 * This class overrides connection creation to use SessionAwareMCPConnection instances
 * and adds session tracking on top of the existing MCPManager functionality.
 */
export class SessionAwareMCPManager extends MCPManager {
  /** Track session information for monitoring */
  private sessionTracker: sessionTypes.SessionTracker = new Map();

  public static getInstance(): SessionAwareMCPManager {
    if (!(MCPManager as any).instance) {
      (MCPManager as any).instance = new SessionAwareMCPManager();
    }
    return (MCPManager as any).instance as SessionAwareMCPManager;
  }

  /** Create a session-aware connection */
  private createSessionAwareConnection(
    serverName: string,
    config: any,
    userId?: string,
    tokens?: any
  ): SessionAwareMCPConnection {
    const connection = new SessionAwareMCPConnection(serverName, config, userId, tokens);

    // Set up session event handlers for the new connection
    this.setupSessionEventHandlers(connection, serverName, userId || CONSTANTS.SYSTEM_USER_ID);

    return connection;
  }

  /** Set up session event handlers for a connection */
  private setupSessionEventHandlers(
    connection: SessionAwareMCPConnection, 
    serverName: string, 
    userId: string
  ): void {
    const logPrefix = userId === CONSTANTS.SYSTEM_USER_ID 
      ? `[MCP][${serverName}]` 
      : `[MCP][User: ${userId}][${serverName}]`;

    connection.on('sessionCreated', (sessionInfo: sessionTypes.MCPSessionInfo) => {
      logger.info(`${logPrefix} Session created: ${sessionInfo.sessionId.substring(0, 8)}...`);
      this.trackSession(userId, serverName, sessionInfo);
    });

    connection.on('sessionTerminated', (sessionInfo: sessionTypes.MCPSessionInfo) => {
      logger.info(`${logPrefix} Session terminated: ${sessionInfo.sessionId.substring(0, 8)}...`);
      this.trackSession(userId, serverName, null);
    });

    connection.on('sessionCleared', () => {
      logger.debug(`${logPrefix} Session cleared`);
      this.trackSession(userId, serverName, null);
    });

    connection.on('sessionError', (error: sessionTypes.SessionError) => {
      logger.warn(`${logPrefix} Session error: ${error.type} - ${error.message}`);
      // Session errors are handled by the connection's recovery logic
    });
  }

  /** Track session information for monitoring */
  private trackSession(
    userId: string, 
    serverName: string, 
    sessionInfo: sessionTypes.MCPSessionInfo | null
  ): void {
    if (!this.sessionTracker.has(userId)) {
      this.sessionTracker.set(userId, new Map());
    }

    const userSessions = this.sessionTracker.get(userId)!;
    userSessions.set(serverName, sessionInfo);

    // Clean up empty user session maps
    if (sessionInfo === null && userSessions.size === 0) {
      this.sessionTracker.delete(userId);
    }
  }

  /** Get session information for a specific user and server */
  public getSessionInfo(userId: string, serverName: string): sessionTypes.MCPSessionInfo | null {
    return this.sessionTracker.get(userId)?.get(serverName) || null;
  }

  /** Get all active sessions for monitoring */
  public getAllActiveSessions(): sessionTypes.SessionTracker {
    return new Map(this.sessionTracker);
  }

  /** Get session statistics for monitoring */
  public getSessionStats(): sessionTypes.SessionStats {
    let totalSessions = 0;
    let activeSessions = 0;

    for (const userSessions of this.sessionTracker.values()) {
      for (const sessionInfo of userSessions.values()) {
        totalSessions++;
        if (sessionInfo && !sessionInfo.terminated) {
          activeSessions++;
        }
      }
    }

    return {
      totalUsers: this.sessionTracker.size,
      totalSessions,
      activeSessions,
    };
  }

  /** Override initializeMCP to use session-aware connections */
  public async initializeMCP(params: any): Promise<void> {
    // Call the parent method first to create all connections normally
    await super.initializeMCP(params);

    // Now replace all created connections with session-aware versions
    const connections = (this as any).connections as Map<string, any>;
    const newConnections = new Map();

    for (const [serverName, connection] of connections.entries()) {
      // Create a new session-aware connection with the same parameters
      const sessionAwareConnection = new SessionAwareMCPConnection(
        (connection as any).serverName,
        (connection as any).options,
        undefined, // system-level connections don't have userId
        (connection as any).oauthTokens
      );

      // Copy the connection state if it was connected
      try {
        const isConnected = await connection.isConnected();
        if (isConnected) {
          await sessionAwareConnection.connect();
        }
      } catch (error) {
        logger.warn(`Failed to connect session-aware replacement for ${serverName}:`, error);
      }

      // Set up session handlers
      this.setupSessionEventHandlers(sessionAwareConnection, serverName, CONSTANTS.SYSTEM_USER_ID);

      // Disconnect the old connection
      try {
        await connection.disconnect();
      } catch (error) {
        logger.debug(`Error disconnecting original connection for ${serverName}:`, error);
      }

      newConnections.set(serverName, sessionAwareConnection);
    }

    // Replace the connections map
    (this as any).connections = newConnections;
  }

  /** Override getUserConnection to use session-aware connections */
  public async getUserConnection(params: any): Promise<any> {
    // Call the parent method first to get or create the connection
    const connection = await super.getUserConnection(params);

    // If it's not already a session-aware connection, replace it
    if (!(connection instanceof SessionAwareMCPConnection)) {
      // Create a new session-aware connection with the same parameters
      const sessionAwareConnection = new SessionAwareMCPConnection(
        (connection as any).serverName,
        (connection as any).options,
        params.user?.id,
        (connection as any).oauthTokens
      );

      // Copy the connection state if it was connected
      try {
        const isConnected = await connection.isConnected();
        if (isConnected) {
          await sessionAwareConnection.connect();
        }
      } catch (error) {
        logger.warn(`Failed to connect session-aware replacement for user connection:`, error);
      }

      // Set up session handlers
      this.setupSessionEventHandlers(
        sessionAwareConnection,
        (connection as any).serverName,
        params.user?.id || CONSTANTS.SYSTEM_USER_ID
      );

      // Replace in the user connections map
      const userId = params.user?.id;
      if (userId) {
        const userConnections = (this as any).userConnections.get(userId);
        if (userConnections) {
          userConnections.set((connection as any).serverName, sessionAwareConnection);
        }
      }

      // Disconnect the old connection
      try {
        await connection.disconnect();
      } catch (error) {
        logger.debug(`Error disconnecting original user connection:`, error);
      }

      return sessionAwareConnection;
    }

    return connection;
  }

  /** Override to ensure session tracking is cleared when connections are removed */
  public async disconnectUserConnection(userId: string, serverName: string): Promise<void> {
    // Clear session tracking
    this.trackSession(userId, serverName, null);
    
    // Call parent method
    await super.disconnectUserConnection(userId, serverName);
  }

  /** Override to ensure session tracking is cleared when all user connections are removed */
  public async disconnectUserConnections(userId: string): Promise<void> {
    // Clear all session tracking for this user
    this.sessionTracker.delete(userId);
    
    // Call parent method
    await super.disconnectUserConnections(userId);
  }

  /** Override to ensure session tracking is cleared when all connections are removed */
  public async disconnectAll(): Promise<void> {
    // Clear all session tracking
    this.sessionTracker.clear();
    
    // Call parent method
    await super.disconnectAll();
  }

  /** Override destroyInstance to clear session tracking */
  public static async destroyInstance(): Promise<void> {
    if ((MCPManager as any).instance && (MCPManager as any).instance instanceof SessionAwareMCPManager) {
      // Clear session tracking
      ((MCPManager as any).instance as SessionAwareMCPManager).sessionTracker.clear();
    }

    // Call parent method
    await MCPManager.destroyInstance();
  }
}
