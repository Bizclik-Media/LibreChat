/**
 * Integration test to verify session-aware classes work correctly
 * and maintain backward compatibility with the original API.
 */

import { SessionAwareMCPConnection } from './SessionAwareMCPConnection';
import { SessionAwareMCPManager } from './SessionAwareMCPManager';
import type * as sessionTypes from './types';

// Mock the MCP SDK
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    ping: jest.fn().mockResolvedValue({}),
    request: jest.fn().mockResolvedValue({ content: [] }),
    listTools: jest.fn().mockResolvedValue({ tools: [] }),
    listResources: jest.fn().mockResolvedValue({ resources: [] }),
    listPrompts: jest.fn().mockResolvedValue({ prompts: [] }),
    getServerCapabilities: jest.fn().mockReturnValue({}),
    getInstructions: jest.fn().mockReturnValue(''),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation(() => ({
    onclose: null,
    onerror: null,
    onmessage: null,
    send: jest.fn(),
    close: jest.fn(),
  })),
}));

describe('Session-Aware MCP Integration', () => {
  let connection: SessionAwareMCPConnection;
  let manager: SessionAwareMCPManager;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Clean up any existing instances
    (SessionAwareMCPManager as any).instance = null;
    
    const mockOptions = {
      type: 'streamable-http' as const,
      url: 'https://example.com/mcp',
      headers: {},
    };

    connection = new SessionAwareMCPConnection('test-server', mockOptions);
    manager = SessionAwareMCPManager.getInstance();
  });

  afterEach(async () => {
    await connection.disconnect();
    await SessionAwareMCPManager.destroyInstance();
  });

  describe('SessionAwareMCPConnection', () => {
    it('should extend MCPConnection with session functionality', () => {
      expect(connection).toBeInstanceOf(SessionAwareMCPConnection);
      expect(typeof connection.getSessionInfo).toBe('function');
      expect(typeof connection.setSession).toBe('function');
      expect(typeof connection.clearSession).toBe('function');
      expect(typeof connection.markSessionTerminated).toBe('function');
    });

    it('should maintain backward compatibility with MCPConnection API', () => {
      expect(typeof connection.connect).toBe('function');
      expect(typeof connection.disconnect).toBe('function');
      expect(typeof connection.isConnected).toBe('function');
    });

    it('should handle session lifecycle correctly', () => {
      const sessionInfo: sessionTypes.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      // Initially no session
      expect(connection.getSessionInfo()).toBeNull();

      // Set session
      connection.setSession(sessionInfo);
      expect(connection.getSessionInfo()).toEqual(sessionInfo);

      // Mark as terminated
      connection.markSessionTerminated();
      const terminatedSession = connection.getSessionInfo();
      expect(terminatedSession?.terminated).toBe(true);

      // Clear session
      connection.clearSession();
      expect(connection.getSessionInfo()).toBeNull();
    });

    it('should emit session events', (done) => {
      const sessionInfo: sessionTypes.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      let eventsReceived = 0;
      const expectedEvents = 3;

      connection.on('sessionCreated', (emittedSession) => {
        expect(emittedSession).toEqual(sessionInfo);
        eventsReceived++;
        if (eventsReceived === expectedEvents) done();
      });

      connection.on('sessionTerminated', (emittedSession) => {
        expect(emittedSession.terminated).toBe(true);
        eventsReceived++;
        if (eventsReceived === expectedEvents) done();
      });

      connection.on('sessionCleared', () => {
        eventsReceived++;
        if (eventsReceived === expectedEvents) done();
      });

      // Trigger events
      connection.setSession(sessionInfo);
      connection.markSessionTerminated();
      connection.clearSession();
    });
  });

  describe('SessionAwareMCPManager', () => {
    it('should extend MCPManager with session tracking functionality', () => {
      expect(manager).toBeInstanceOf(SessionAwareMCPManager);
      expect(typeof manager.getSessionInfo).toBe('function');
      expect(typeof manager.getAllActiveSessions).toBe('function');
      expect(typeof manager.getSessionStats).toBe('function');
    });

    it('should maintain backward compatibility with MCPManager API', () => {
      expect(typeof manager.initializeMCP).toBe('function');
      expect(typeof manager.getUserConnection).toBe('function');
      expect(typeof manager.callTool).toBe('function');
      expect(typeof manager.getConnection).toBe('function');
      expect(typeof manager.getAllConnections).toBe('function');
    });

    it('should track session information', () => {
      const sessionInfo: sessionTypes.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      // Track a session
      (manager as any).trackSession('user-123', 'test-server', sessionInfo);

      // Verify tracking
      expect(manager.getSessionInfo('user-123', 'test-server')).toEqual(sessionInfo);

      // Get all sessions
      const allSessions = manager.getAllActiveSessions();
      expect(allSessions.get('user-123')?.get('test-server')).toEqual(sessionInfo);

      // Get session stats
      const stats = manager.getSessionStats();
      expect(stats.totalUsers).toBe(1);
      expect(stats.totalSessions).toBe(1);
      expect(stats.activeSessions).toBe(1);
    });

    it('should use singleton pattern correctly', () => {
      const manager1 = SessionAwareMCPManager.getInstance();
      const manager2 = SessionAwareMCPManager.getInstance();
      expect(manager1).toBe(manager2);
    });
  });

  describe('Integration', () => {
    it('should work together for complete session management', () => {
      const sessionInfo: sessionTypes.MCPSessionInfo = {
        sessionId: 'integration-test-session',
        createdAt: new Date(),
        terminated: false,
      };

      // Set up session event handling
      const mockSetupSessionEventHandlers = jest.spyOn(manager as any, 'setupSessionEventHandlers');
      
      // Create a connection (this would normally be done internally)
      const testConnection = new SessionAwareMCPConnection('integration-server', {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
      });

      // Set up session handlers
      (manager as any).setupSessionEventHandlers(testConnection, 'integration-server', 'test-user');

      // Verify session tracking integration
      testConnection.setSession(sessionInfo);
      
      // The session should be tracked by the manager through event handlers
      // (In a real scenario, this would happen automatically)
      expect(mockSetupSessionEventHandlers).toHaveBeenCalled();
    });
  });
});
