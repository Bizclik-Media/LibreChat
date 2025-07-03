import { MCPManager } from './manager';
import { MCPConnection } from './connection';
import type * as t from './types';
import { logger } from '@librechat/data-schemas';

// Mock MCPConnection
jest.mock('./connection', () => ({
  MCPConnection: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    isConnected: jest.fn().mockReturnValue(true),
    getSessionInfo: jest.fn().mockReturnValue(null),
    setSession: jest.fn(),
    clearSession: jest.fn(),
    markSessionTerminated: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    removeAllListeners: jest.fn(),
    emit: jest.fn(),
  })),
}));

describe('MCPManager Session Management', () => {
  let manager: MCPManager;
  let mockConnection: jest.Mocked<MCPConnection>;

  beforeEach(() => {
    jest.clearAllMocks();
    manager = MCPManager.getInstance();
    
    // Clear any existing connections
    (manager as any).connections.clear();
    (manager as any).sessionTracker.clear();

    // Create a mock connection
    mockConnection = new MCPConnection('test-server', {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
    }) as jest.Mocked<MCPConnection>;
  });

  afterEach(() => {
    MCPManager.destroyInstance();
  });

  describe('Session Tracking', () => {
    it('should track session creation', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      (manager as any).trackSession('user-123', 'test-server', sessionInfo);

      const retrievedSession = manager.getSessionInfo('user-123', 'test-server');
      expect(retrievedSession).toEqual(sessionInfo);
    });

    it('should track session termination', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      (manager as any).trackSession('user-123', 'test-server', sessionInfo);
      (manager as any).trackSession('user-123', 'test-server', null);

      const retrievedSession = manager.getSessionInfo('user-123', 'test-server');
      expect(retrievedSession).toBeNull();
    });

    it('should return null for non-existent session', () => {
      const retrievedSession = manager.getSessionInfo('user-123', 'test-server');
      expect(retrievedSession).toBeNull();
    });

    it('should clean up empty user session maps', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      (manager as any).trackSession('user-123', 'test-server', sessionInfo);
      (manager as any).trackSession('user-123', 'test-server', null);

      const allSessions = manager.getAllActiveSessions();
      expect(allSessions.has('user-123')).toBe(false);
    });
  });

  describe('Session Statistics', () => {
    it('should return correct session statistics', () => {
      const sessionInfo1: t.MCPSessionInfo = {
        sessionId: 'session-1',
        createdAt: new Date(),
        terminated: false,
      };

      const sessionInfo2: t.MCPSessionInfo = {
        sessionId: 'session-2',
        createdAt: new Date(),
        terminated: true,
      };

      const sessionInfo3: t.MCPSessionInfo = {
        sessionId: 'session-3',
        createdAt: new Date(),
        terminated: false,
      };

      (manager as any).trackSession('user-1', 'server-1', sessionInfo1);
      (manager as any).trackSession('user-1', 'server-2', sessionInfo2);
      (manager as any).trackSession('user-2', 'server-1', sessionInfo3);

      const stats = manager.getSessionStats();
      expect(stats).toEqual({
        totalUsers: 2,
        totalSessions: 3,
        activeSessions: 2, // Only non-terminated sessions
      });
    });

    it('should return zero stats when no sessions exist', () => {
      const stats = manager.getSessionStats();
      expect(stats).toEqual({
        totalUsers: 0,
        totalSessions: 0,
        activeSessions: 0,
      });
    });
  });

  describe('Session Event Handling', () => {
    it('should set up session event handlers for system connections', () => {
      const mockOn = jest.fn();
      mockConnection.on = mockOn;

      (manager as any).setupSessionEventHandlers(mockConnection, 'test-server', 'SYSTEM_USER_ID');

      expect(mockOn).toHaveBeenCalledWith('sessionCreated', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('sessionTerminated', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('sessionCleared', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('sessionError', expect.any(Function));
    });

    it('should set up session event handlers for user connections', () => {
      const mockOn = jest.fn();
      mockConnection.on = mockOn;

      (manager as any).setupSessionEventHandlers(mockConnection, 'test-server', 'user-123');

      expect(mockOn).toHaveBeenCalledWith('sessionCreated', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('sessionTerminated', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('sessionCleared', expect.any(Function));
      expect(mockOn).toHaveBeenCalledWith('sessionError', expect.any(Function));
    });

    it('should handle sessionCreated event', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      const mockOn = jest.fn((event, handler) => {
        if (event === 'sessionCreated') {
          handler(sessionInfo);
        }
      });
      mockConnection.on = mockOn;

      const trackSessionSpy = jest.spyOn(manager as any, 'trackSession');

      (manager as any).setupSessionEventHandlers(mockConnection, 'test-server', 'user-123');

      expect(trackSessionSpy).toHaveBeenCalledWith('user-123', 'test-server', sessionInfo);
    });

    it('should handle sessionTerminated event', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: true,
      };

      const mockOn = jest.fn((event, handler) => {
        if (event === 'sessionTerminated') {
          handler(sessionInfo);
        }
      });
      mockConnection.on = mockOn;

      const trackSessionSpy = jest.spyOn(manager as any, 'trackSession');

      (manager as any).setupSessionEventHandlers(mockConnection, 'test-server', 'user-123');

      expect(trackSessionSpy).toHaveBeenCalledWith('user-123', 'test-server', null);
    });

    it('should handle sessionCleared event', () => {
      const mockOn = jest.fn((event, handler) => {
        if (event === 'sessionCleared') {
          handler();
        }
      });
      mockConnection.on = mockOn;

      const trackSessionSpy = jest.spyOn(manager as any, 'trackSession');

      (manager as any).setupSessionEventHandlers(mockConnection, 'test-server', 'user-123');

      expect(trackSessionSpy).toHaveBeenCalledWith('user-123', 'test-server', null);
    });

    it('should handle sessionError event', () => {
      const sessionError: t.SessionError = {
        type: 'session_terminated',
        message: 'Session terminated',
        sessionId: 'test-session-123',
        timestamp: new Date(),
      };

      const mockOn = jest.fn((event, handler) => {
        if (event === 'sessionError') {
          handler(sessionError);
        }
      });
      mockConnection.on = mockOn;

      const loggerWarnSpy = jest.spyOn(logger, 'warn').mockImplementation();

      (manager as any).setupSessionEventHandlers(mockConnection, 'test-server', 'user-123');

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Session error: session_terminated - Session terminated')
      );
    });
  });

  describe('Session Monitoring', () => {
    it('should return all active sessions', () => {
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

      (manager as any).trackSession('user-1', 'server-1', sessionInfo1);
      (manager as any).trackSession('user-2', 'server-1', sessionInfo2);

      const allSessions = manager.getAllActiveSessions();
      expect(allSessions.size).toBe(2);
      expect(allSessions.get('user-1')?.get('server-1')).toEqual(sessionInfo1);
      expect(allSessions.get('user-2')?.get('server-1')).toEqual(sessionInfo2);
    });

    it('should return empty map when no sessions exist', () => {
      const allSessions = manager.getAllActiveSessions();
      expect(allSessions.size).toBe(0);
    });
  });
});
