import { EventEmitter } from 'events';
import { MCPConnection } from './connection';
import { MCPManager } from './manager';
import type * as t from './types';
import { logger } from '@librechat/data-schemas';

// Mock the MCP SDK with more realistic behavior
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    close: jest.fn(),
    request: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/http.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation((url, options) => {
    const transport = new EventEmitter();
    return Object.assign(transport, {
      onclose: null,
      onerror: null,
      onmessage: null,
      send: jest.fn(),
      close: jest.fn(),
      sessionId: options?.sessionId || null,
    });
  }),
}));

// Mock fetch for session termination
const mockFetch = jest.fn();
Object.assign(mockFetch, { preconnect: jest.fn() });
global.fetch = mockFetch as any;

describe('MCP Session Integration Tests', () => {
  let manager: MCPManager;
  let connection: MCPConnection;
  let mockOptions: t.StreamableHTTPOptions;

  beforeEach(() => {
    jest.clearAllMocks();

    mockOptions = {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: {},
    };

    manager = MCPManager.getInstance();
    connection = new MCPConnection('test-server', mockOptions);

    // Mock fetch responses
    (mockFetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
    });
  });

  afterEach(() => {
    connection.removeAllListeners();
    MCPManager.destroyInstance();
  });

  describe('Session Error Recovery', () => {
    it('should recover from session terminated error', async () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      // Mock the connect method to simulate successful recovery
      const connectSpy = jest.spyOn(connection, 'connect').mockResolvedValue();
      const clearSessionSpy = jest.spyOn(connection, 'clearSession');

      const sessionError: t.SessionError = {
        type: 'session_terminated',
        message: 'Session terminated',
        sessionId: 'test-session-123',
      };

      // Trigger session recovery
      await (connection as any).handleSessionRecovery(sessionError);

      expect(clearSessionSpy).toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalled();
    });

    it('should recover from session expired error', async () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      const connectSpy = jest.spyOn(connection, 'connect').mockResolvedValue();
      const clearSessionSpy = jest.spyOn(connection, 'clearSession');

      const sessionError: t.SessionError = {
        type: 'session_expired',
        message: 'Session expired',
        sessionId: 'test-session-123',
      };

      await (connection as any).handleSessionRecovery(sessionError);

      expect(clearSessionSpy).toHaveBeenCalled();
      expect(connectSpy).toHaveBeenCalled();
    });

    it('should not attempt recovery when already reconnecting', async () => {
      (connection as any).isReconnecting = true;

      const connectSpy = jest.spyOn(connection, 'connect');

      const sessionError: t.SessionError = {
        type: 'session_terminated',
        message: 'Session terminated',
        sessionId: 'test-session-123',
      };

      await (connection as any).handleSessionRecovery(sessionError);

      expect(connectSpy).not.toHaveBeenCalled();
    });

    it('should handle recovery failure gracefully', async () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      // Mock connect to fail
      const connectSpy = jest.spyOn(connection, 'connect').mockRejectedValue(new Error('Connection failed'));
      const emitSpy = jest.spyOn(connection, 'emit');

      const sessionError: t.SessionError = {
        type: 'session_terminated',
        message: 'Session terminated',
        sessionId: 'test-session-123',
      };

      await expect((connection as any).handleSessionRecovery(sessionError)).rejects.toThrow('Connection failed');
      expect(emitSpy).toHaveBeenCalledWith('connectionChange', 'error');
    });
  });

  describe('Session Lifecycle Integration', () => {
    it('should handle complete session lifecycle', async () => {
      // Track session creation
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);
      expect(connection.getSessionInfo()).toEqual(sessionInfo);

      // Simulate session termination
      connection.markSessionTerminated();
      const terminatedSession = connection.getSessionInfo();
      expect(terminatedSession?.terminated).toBe(true);

      // Clear session
      connection.clearSession();
      expect(connection.getSessionInfo()).toBeNull();
    });

    it('should handle session termination on disconnect', async () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      // Mock client close
      const mockClient = (connection as any).client;
      mockClient.close = jest.fn().mockResolvedValue(undefined);

      await connection.disconnect();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/session',
        {
          method: 'DELETE',
          headers: {
            'Mcp-Session-Id': 'test-session-123',
          },
        }
      );
    });

    it('should handle session extraction after connection', async () => {
      // Mock transport with session ID
      const mockTransport = {
        sessionId: 'extracted-session-456',
        onclose: null,
        onerror: null,
        onmessage: null,
        send: jest.fn(),
        close: jest.fn(),
      };

      (connection as any).transport = mockTransport;

      await (connection as any).extractSessionFromConnection();

      const sessionInfo = connection.getSessionInfo();
      expect(sessionInfo?.sessionId).toBe('extracted-session-456');
      expect(sessionInfo?.terminated).toBe(false);
    });
  });

  describe('Transport Error Handling', () => {
    it('should detect and handle session errors in transport', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      // Mock transport
      const mockTransport = new EventEmitter();
      (connection as any).transport = mockTransport;

      const sessionErrorSpy = jest.spyOn(connection, 'emit');
      const handleRecoverySpy = jest.spyOn(connection as any, 'handleSessionRecovery').mockResolvedValue(undefined);

      // Set up transport error handlers
      (connection as any).setupTransportErrorHandlers(mockTransport);

      // Simulate a 404 error (session terminated)
      const error = new Error('404 Not Found');
      mockTransport.emit('error', error);

      expect(sessionErrorSpy).toHaveBeenCalledWith('sessionError', expect.objectContaining({
        type: 'session_terminated',
        message: 'Session has been terminated by the server',
        sessionId: 'test-session-123',
      }));

      expect(handleRecoverySpy).toHaveBeenCalled();
    });

    it('should not trigger session recovery for non-session errors', () => {
      // Mock transport
      const mockTransport = new EventEmitter();
      (connection as any).transport = mockTransport;

      const handleRecoverySpy = jest.spyOn(connection as any, 'handleSessionRecovery');
      const connectionErrorSpy = jest.spyOn(connection, 'emit');

      // Set up transport error handlers
      (connection as any).setupTransportErrorHandlers(mockTransport);

      // Simulate a generic network error
      const error = new Error('Network timeout');
      mockTransport.emit('error', error);

      expect(handleRecoverySpy).not.toHaveBeenCalled();
      expect(connectionErrorSpy).toHaveBeenCalledWith('connectionChange', 'error');
    });

    it('should handle OAuth errors separately from session errors', () => {
      // Mock transport
      const mockTransport = new EventEmitter();
      (connection as any).transport = mockTransport;

      const oauthErrorSpy = jest.spyOn(connection, 'emit');

      // Set up transport error handlers
      (connection as any).setupTransportErrorHandlers(mockTransport);

      // Simulate OAuth error
      const error = { code: 401, message: 'Unauthorized' };
      mockTransport.emit('error', error);

      expect(oauthErrorSpy).toHaveBeenCalledWith('oauthError', error);
    });
  });

  describe('Manager Session Integration', () => {
    it('should track sessions across multiple connections', () => {
      const sessionInfo1: t.MCPSessionInfo = {
        sessionId: 'session-1',
        createdAt: new Date(),
        terminated: false,
      };

      const sessionInfo2: t.MCPSessionInfo = {
        sessionId: 'session-2',
        createdAt: new Date(),
        terminated: false,
      };

      // Simulate session tracking through manager
      (manager as any).trackSession('user-1', 'server-1', sessionInfo1);
      (manager as any).trackSession('user-2', 'server-1', sessionInfo2);

      const stats = manager.getSessionStats();
      expect(stats.totalUsers).toBe(2);
      expect(stats.totalSessions).toBe(2);
      expect(stats.activeSessions).toBe(2);

      // Terminate one session
      (manager as any).trackSession('user-1', 'server-1', null);

      const updatedStats = manager.getSessionStats();
      expect(updatedStats.totalUsers).toBe(1);
      expect(updatedStats.totalSessions).toBe(1);
      expect(updatedStats.activeSessions).toBe(1);
    });
  });

  describe('Edge Cases', () => {
    it('should handle session termination when no session exists', async () => {
      // Should not throw when no session is set
      await expect((connection as any).terminateSession()).resolves.toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should handle session extraction when transport has no sessionId', async () => {
      const mockTransport = {
        onclose: null,
        onerror: null,
        onmessage: null,
        send: jest.fn(),
        close: jest.fn(),
        // No sessionId property
      };

      (connection as any).transport = mockTransport;

      await (connection as any).extractSessionFromConnection();

      // Should not set any session info
      expect(connection.getSessionInfo()).toBeNull();
    });

    it('should handle malformed session IDs gracefully', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: '', // Empty session ID
        createdAt: new Date(),
        terminated: false,
      };

      // Should not throw
      expect(() => connection.setSession(sessionInfo)).not.toThrow();
      expect(connection.getSessionInfo()).toEqual(sessionInfo);
    });

    it('should handle concurrent session operations', () => {
      const sessionInfo1: t.MCPSessionInfo = {
        sessionId: 'session-1',
        createdAt: new Date(),
        terminated: false,
      };

      const sessionInfo2: t.MCPSessionInfo = {
        sessionId: 'session-2',
        createdAt: new Date(),
        terminated: false,
      };

      // Set multiple sessions rapidly
      connection.setSession(sessionInfo1);
      connection.setSession(sessionInfo2);

      // Should have the last session set
      expect(connection.getSessionInfo()).toEqual(sessionInfo2);
    });
  });
});
