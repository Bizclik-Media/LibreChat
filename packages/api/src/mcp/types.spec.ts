import type * as t from './types';

describe('MCP Session Types', () => {
  describe('MCPSessionInfo', () => {
    it('should accept valid session info', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      expect(sessionInfo.sessionId).toBe('test-session-123');
      expect(sessionInfo.createdAt).toBeInstanceOf(Date);
      expect(sessionInfo.terminated).toBe(false);
    });

    it('should accept terminated session info', () => {
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: true,
      };

      expect(sessionInfo.terminated).toBe(true);
    });

    it('should accept session info with optional terminatedAt', () => {
      const terminatedAt = new Date();
      const sessionInfo: t.MCPSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: true,
        terminatedAt,
      };

      expect(sessionInfo.terminatedAt).toBe(terminatedAt);
    });
  });

  describe('SessionErrorType', () => {
    it('should include all expected error types', () => {
      const errorTypes: t.SessionErrorType[] = [
        'session_terminated',
        'session_expired',
        'session_invalid',
        'session_conflict',
        'session_timeout',
      ];

      // This test ensures all error types are properly typed
      errorTypes.forEach(type => {
        expect(typeof type).toBe('string');
      });
    });
  });

  describe('SessionError', () => {
    it('should accept valid session error', () => {
      const sessionError: t.SessionError = {
        type: 'session_terminated',
        message: 'Session has been terminated',
        sessionId: 'test-session-123',
        timestamp: new Date(),
      };

      expect(sessionError.type).toBe('session_terminated');
      expect(sessionError.message).toBe('Session has been terminated');
      expect(sessionError.sessionId).toBe('test-session-123');
      expect(sessionError.timestamp).toBeInstanceOf(Date);
    });

    it('should accept session error without sessionId', () => {
      const sessionError: t.SessionError = {
        type: 'session_expired',
        message: 'Session has expired',
        timestamp: new Date(),
      };

      expect(sessionError.sessionId).toBeUndefined();
    });

    it('should accept all error types', () => {
      const errorTypes: t.SessionErrorType[] = [
        'session_terminated',
        'session_expired',
        'session_invalid',
        'session_conflict',
        'session_timeout',
      ];

      errorTypes.forEach(type => {
        const sessionError: t.SessionError = {
          type,
          message: `Test error for ${type}`,
          timestamp: new Date(),
        };

        expect(sessionError.type).toBe(type);
      });
    });

    it('should accept session error with additional context', () => {
      const sessionError: t.SessionError = {
        type: 'session_conflict',
        message: 'Session conflict detected',
        sessionId: 'test-session-123',
        timestamp: new Date(),
        context: {
          conflictingSessionId: 'other-session-456',
          reason: 'duplicate_connection',
        },
      };

      expect(sessionError.context).toBeDefined();
      expect(sessionError.context?.conflictingSessionId).toBe('other-session-456');
    });
  });

  describe('Connection State Types', () => {
    it('should accept all connection states', () => {
      const states: t.ConnectionState[] = [
        'disconnected',
        'connecting',
        'connected',
        'error',
        'reconnecting',
      ];

      states.forEach(state => {
        expect(typeof state).toBe('string');
      });
    });
  });

  describe('Transport Options with Session Support', () => {
    it('should accept StreamableHTTPOptions', () => {
      const options: t.StreamableHTTPOptions = {
        type: 'streamable-http',
        url: 'https://example.com/mcp',
        headers: {
          'Authorization': 'Bearer token',
          'Custom-Header': 'value',
        },
      };

      expect(options.type).toBe('streamable-http');
      expect(options.url).toBe('https://example.com/mcp');
      expect(options.headers).toBeDefined();
    });

    it('should accept StdioOptions', () => {
      const options: t.StdioOptions = {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: {
          NODE_ENV: 'production',
        },
      };

      expect(options.type).toBe('stdio');
      expect(options.command).toBe('node');
      expect(options.args).toEqual(['server.js']);
    });

    it('should accept SSEOptions', () => {
      const options: t.SSEOptions = {
        type: 'sse',
        url: 'https://example.com/events',
        headers: {
          'Accept': 'text/event-stream',
        },
      };

      expect(options.type).toBe('sse');
      expect(options.url).toBe('https://example.com/events');
    });
  });

  describe('Type Guards', () => {
    it('should properly type-guard session info', () => {
      const validSessionInfo = {
        sessionId: 'test-session-123',
        createdAt: new Date(),
        terminated: false,
      };

      const invalidSessionInfo = {
        sessionId: 123, // Invalid type
        createdAt: 'not-a-date',
        terminated: 'not-a-boolean',
      };

      // TypeScript should catch these at compile time
      const typedValid: t.MCPSessionInfo = validSessionInfo;
      expect(typedValid.sessionId).toBe('test-session-123');

      // This would cause a TypeScript error if uncommented:
      // const typedInvalid: t.MCPSessionInfo = invalidSessionInfo;
    });

    it('should properly type-guard session errors', () => {
      const validError = {
        type: 'session_terminated' as t.SessionErrorType,
        message: 'Session terminated',
        timestamp: new Date(),
      };

      const typedError: t.SessionError = validError;
      expect(typedError.type).toBe('session_terminated');
    });
  });

  describe('Optional Properties', () => {
    it('should handle optional sessionId in SessionError', () => {
      const errorWithoutSessionId: t.SessionError = {
        type: 'session_timeout',
        message: 'Session timed out',
        timestamp: new Date(),
      };

      const errorWithSessionId: t.SessionError = {
        type: 'session_timeout',
        message: 'Session timed out',
        sessionId: 'test-session-123',
        timestamp: new Date(),
      };

      expect(errorWithoutSessionId.sessionId).toBeUndefined();
      expect(errorWithSessionId.sessionId).toBe('test-session-123');
    });

    it('should handle optional terminatedAt in MCPSessionInfo', () => {
      const activeSession: t.MCPSessionInfo = {
        sessionId: 'active-session',
        createdAt: new Date(),
        terminated: false,
      };

      const terminatedSession: t.MCPSessionInfo = {
        sessionId: 'terminated-session',
        createdAt: new Date(),
        terminated: true,
        terminatedAt: new Date(),
      };

      expect(activeSession.terminatedAt).toBeUndefined();
      expect(terminatedSession.terminatedAt).toBeInstanceOf(Date);
    });
  });
});
