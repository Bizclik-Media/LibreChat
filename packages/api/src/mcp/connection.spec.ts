import { EventEmitter } from 'events';
import { MCPConnection } from './connection';
import type * as t from './types';
import { logger } from '@librechat/data-schemas';

// Mock the MCP SDK
jest.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: jest.fn().mockImplementation(() => ({
    connect: jest.fn(),
    close: jest.fn(),
    request: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: jest.fn().mockImplementation(() => ({
    onclose: null,
    onerror: null,
    onmessage: null,
    send: jest.fn(),
    close: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: jest.fn().mockImplementation(() => ({
    onclose: null,
    onerror: null,
    onmessage: null,
    send: jest.fn(),
    close: jest.fn(),
  })),
}));

jest.mock('@modelcontextprotocol/sdk/client/http.js', () => ({
  StreamableHTTPClientTransport: jest.fn().mockImplementation((url, options) => ({
    onclose: null,
    onerror: null,
    onmessage: null,
    send: jest.fn(),
    close: jest.fn(),
    sessionId: options?.sessionId || null,
  })),
}));

// Mock fetch for session termination
global.fetch = jest.fn();

describe('MCPConnection Session Management', () => {
  let connection: MCPConnection;
  let mockOptions: t.StreamableHTTPOptions;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockOptions = {
      type: 'streamable-http',
      url: 'https://example.com/mcp',
      headers: {},
    };

    connection = new MCPConnection('test-server', mockOptions);
  });

  afterEach(() => {
    connection.removeAllListeners();
  });

  describe('Session Lifecycle', () => {
    it('should initialize without session info', () => {
      expect(connection.getSessionInfo()).toBeNull();
    });

    it('should set session info correctly', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);
      expect(connection.getSessionInfo()).toEqual(sessionInfo);
    });

    it('should clear session info', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);
      connection.clearSession();
      expect(connection.getSessionInfo()).toBeNull();
    });

    it('should mark session as terminated', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);
      connection.markSessionTerminated();
      
      const updatedSession = connection.getSessionInfo();
      expect(updatedSession?.terminated).toBe(true);
    });

    it('should emit sessionCreated event when session is set', (done) => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.on('sessionCreated', (emittedSession) => {
        expect(emittedSession).toEqual(sessionInfo);
        done();
      });

      connection.setSession(sessionInfo);
    });

    it('should emit sessionCleared event when session is cleared', (done) => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      connection.on('sessionCleared', () => {
        done();
      });

      connection.clearSession();
    });
  });

  describe('Session Error Detection', () => {
    it('should detect session terminated error (404)', () => {
      const error = new Error('404 Not Found');
      const sessionError = (connection as any).detectSessionError(error);

      expect(sessionError).toEqual({
        type: 'session_terminated',
        message: 'Session has been terminated by the server',
        sessionId: undefined,
        timestamp: expect.any(Date),
      });
    });

    it('should detect session invalid error (400)', () => {
      const error = new Error('400 Bad Request - invalid session');
      const sessionError = (connection as any).detectSessionError(error);

      expect(sessionError).toEqual({
        type: 'session_invalid',
        message: 'Session ID is invalid or malformed',
        sessionId: undefined,
        timestamp: expect.any(Date),
      });
    });

    it('should detect session expired error', () => {
      const error = new Error('Session expired');
      const sessionError = (connection as any).detectSessionError(error);

      expect(sessionError).toEqual({
        type: 'session_expired',
        message: 'Session has expired',
        sessionId: undefined,
        timestamp: expect.any(Date),
      });
    });

    it('should return null for non-session errors', () => {
      const error = new Error('Generic network error');
      const sessionError = (connection as any).detectSessionError(error);

      expect(sessionError).toBeNull();
    });

    it('should include session ID in error when available', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      const error = new Error('404 Not Found');
      const sessionError = (connection as any).detectSessionError(error);

      expect(sessionError?.sessionId).toBe('test-session-123');
    });
  });

  describe('Session Termination', () => {
    beforeEach(() => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });
    });

    it('should send DELETE request to terminate session', async () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      await (connection as any).terminateSession();

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

    it('should handle 405 Method Not Allowed gracefully', async () => {
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 405,
      });

      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);

      // Should not throw
      await expect((connection as any).terminateSession()).resolves.toBeUndefined();
    });

    it('should include OAuth token in termination request', async () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      connection.setSession(sessionInfo);
      (connection as any).oauthTokens = { access_token: 'test-token' };

      await (connection as any).terminateSession();

      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/session',
        {
          method: 'DELETE',
          headers: {
            'Mcp-Session-Id': 'test-session-123',
            'Authorization': 'Bearer test-token',
          },
        }
      );
    });
  });
});
