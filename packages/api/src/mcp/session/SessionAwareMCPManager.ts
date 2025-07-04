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
    // Store reference to the original MCPConnection import
    const connectionModule = require('../connection');
    const originalMCPConnection = connectionModule.MCPConnection;

    try {
      // Temporarily replace MCPConnection with SessionAwareMCPConnection
      connectionModule.MCPConnection = SessionAwareMCPConnection;

      // Call the parent method which will now use SessionAwareMCPConnection
      await super.initializeMCP(params);

      // Set up session handlers for all created connections
      for (const [serverName, connection] of (this as any).connections.entries()) {
        if (connection instanceof SessionAwareMCPConnection) {
          this.setupSessionEventHandlers(connection, serverName, CONSTANTS.SYSTEM_USER_ID);
        }
      }
    } finally {
      // Always restore the original constructor
      connectionModule.MCPConnection = originalMCPConnection;
    }
  }

  /** Override getUserConnection to use session-aware connections */
  public async getUserConnection(params: any): Promise<any> {
    // Store reference to the original MCPConnection import
    const connectionModule = require('../connection');
    const originalMCPConnection = connectionModule.MCPConnection;

    try {
      // Temporarily replace MCPConnection with SessionAwareMCPConnection
      connectionModule.MCPConnection = SessionAwareMCPConnection;

      // Call the parent method which will now use SessionAwareMCPConnection
      const connection = await super.getUserConnection(params);

      // Set up session handlers for the new connection
      if (connection instanceof SessionAwareMCPConnection) {
        this.setupSessionEventHandlers(
          connection,
          (connection as any).serverName,
          params.user?.id || CONSTANTS.SYSTEM_USER_ID
        );
      }

      return connection;
    } finally {
      // Always restore the original constructor
      connectionModule.MCPConnection = originalMCPConnection;
    }
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
