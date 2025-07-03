# MCP Session Management

LibreChat implements comprehensive session management for Model Context Protocol (MCP) connections, providing robust handling of stateful MCP servers and automatic session recovery.

## Overview

MCP session management enables LibreChat to maintain persistent connections with stateful MCP servers using the `Mcp-Session-Id` header as specified in the MCP protocol. This feature provides:

- **Automatic Session Creation**: Sessions are automatically established during MCP server initialization
- **Session Persistence**: Session IDs are maintained across requests to the same MCP server
- **Error Recovery**: Automatic recovery from session termination and expiration
- **Session Monitoring**: Comprehensive logging and monitoring of session lifecycle
- **Graceful Termination**: Proper session cleanup on disconnect

## How It Works

### Session Lifecycle

1. **Initialization**: When connecting to an MCP server, LibreChat checks for session support
2. **Session Creation**: If the server returns an `Mcp-Session-Id` header, a session is established
3. **Session Persistence**: The session ID is included in all subsequent requests to that server
4. **Session Monitoring**: LibreChat continuously monitors session health and validity
5. **Session Recovery**: If a session is terminated or expires, LibreChat automatically attempts recovery
6. **Session Termination**: On disconnect, LibreChat sends a proper termination request to the server

### Session Error Handling

LibreChat automatically detects and handles various session-related errors:

- **404 Not Found**: Session has been terminated by the server
- **400 Bad Request**: Invalid or malformed session ID
- **Session Timeout**: Session has expired due to inactivity
- **Session Conflict**: Multiple sessions detected for the same connection

## Configuration

### Basic Configuration

Session management is automatically enabled for all `streamable-http` MCP connections. No additional configuration is required for basic functionality.

```yaml
# librechat.yaml
mcpServers:
  my-stateful-server:
    type: streamable-http
    url: https://my-server.com/mcp
    headers:
      Authorization: Bearer ${MY_API_KEY}
```

### Advanced Configuration

For advanced session management, you can configure session-related parameters:

```yaml
# librechat.yaml
mcpServers:
  my-stateful-server:
    type: streamable-http
    url: https://my-server.com/mcp
    headers:
      Authorization: Bearer ${MY_API_KEY}
    # Session configuration (optional)
    sessionConfig:
      timeout: 3600000  # Session timeout in milliseconds (1 hour)
      retryAttempts: 3  # Number of retry attempts for session recovery
      retryDelay: 1000  # Delay between retry attempts in milliseconds
```

### Environment Variables

You can configure session management behavior using environment variables:

```bash
# Session timeout (default: 1 hour)
MCP_SESSION_TIMEOUT=3600000

# Maximum retry attempts for session recovery (default: 3)
MCP_SESSION_RETRY_ATTEMPTS=3

# Delay between retry attempts in milliseconds (default: 1000)
MCP_SESSION_RETRY_DELAY=1000

# Enable detailed session logging (default: false)
MCP_SESSION_DEBUG=true
```

## Server Types

### Stateful Servers

Stateful MCP servers maintain session state and require session management:

- **Session Required**: These servers return an `Mcp-Session-Id` header during initialization
- **State Persistence**: Server maintains conversation context, user preferences, or other state
- **Session Validation**: Server validates session ID on each request
- **Examples**: Database connections, authenticated APIs, stateful chat services

### Stateless Servers

Stateless MCP servers do not require session management:

- **No Session ID**: These servers do not return an `Mcp-Session-Id` header
- **Request Independence**: Each request is independent and self-contained
- **No State**: Server does not maintain any state between requests
- **Examples**: Simple calculation tools, public APIs, utility functions

## Monitoring and Logging

### Session Logs

LibreChat provides comprehensive logging for session management:

```
[MCP][my-server] Session created: 12345678...
[MCP][my-server] Session terminated: 12345678...
[MCP][my-server] Session recovery started for error: session_terminated
[MCP][my-server] Session recovery successful
```

### Session Statistics

You can monitor session statistics through the LibreChat admin interface or logs:

- **Total Users**: Number of users with active sessions
- **Total Sessions**: Total number of sessions across all servers
- **Active Sessions**: Number of currently active (non-terminated) sessions
- **Session Errors**: Count of session-related errors and recovery attempts

### Debug Logging

Enable detailed session logging for troubleshooting:

```bash
# Enable debug logging
MCP_SESSION_DEBUG=true

# Or set log level to debug
LOG_LEVEL=debug
```

## Troubleshooting

### Common Issues

#### Session Not Created

**Problem**: MCP server connection works but no session is created.

**Possible Causes**:
- Server does not support sessions (stateless server)
- Server configuration issue
- Network connectivity problems

**Solutions**:
1. Check if the server supports sessions by looking for `Mcp-Session-Id` in response headers
2. Verify server configuration and documentation
3. Enable debug logging to see detailed connection information

#### Session Termination Errors

**Problem**: Frequent session termination errors.

**Possible Causes**:
- Server-side session timeout
- Network connectivity issues
- Server restart or maintenance

**Solutions**:
1. Check server logs for session timeout configuration
2. Verify network stability
3. Configure appropriate retry settings
4. Contact server administrator if issues persist

#### Session Recovery Failures

**Problem**: Session recovery attempts fail repeatedly.

**Possible Causes**:
- Server is down or unreachable
- Authentication issues
- Server-side configuration problems

**Solutions**:
1. Verify server availability and health
2. Check authentication credentials and tokens
3. Review server-side session configuration
4. Increase retry attempts and delay if appropriate

### Error Codes

| Error Type | Description | Recovery Action |
|------------|-------------|-----------------|
| `session_terminated` | Session ended by server | Automatic reconnection with new session |
| `session_expired` | Session timed out | Automatic reconnection with new session |
| `session_invalid` | Invalid session ID format | Clear session and reconnect |
| `session_conflict` | Multiple sessions detected | Terminate conflicting session and reconnect |
| `session_timeout` | Session operation timed out | Retry with exponential backoff |

### Diagnostic Commands

Use these commands to diagnose session issues:

```bash
# Check MCP server connectivity
curl -H "Accept: application/json" https://your-mcp-server.com/mcp

# Test session creation
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  https://your-mcp-server.com/mcp

# Check session termination endpoint
curl -X DELETE -H "Mcp-Session-Id: your-session-id" \
  https://your-mcp-server.com/session
```

## Best Practices

### For Server Developers

1. **Implement Proper Session Management**: Return `Mcp-Session-Id` headers for stateful servers
2. **Handle Session Termination**: Support DELETE requests to `/session` endpoint
3. **Provide Clear Error Messages**: Return appropriate HTTP status codes for session errors
4. **Document Session Behavior**: Clearly document whether your server is stateful or stateless

### For LibreChat Administrators

1. **Monitor Session Health**: Regularly check session statistics and error rates
2. **Configure Appropriate Timeouts**: Set session timeouts based on server requirements
3. **Enable Logging**: Use debug logging for troubleshooting session issues
4. **Test Session Recovery**: Verify that session recovery works correctly with your MCP servers

### For Users

1. **Understand Server Types**: Know whether your MCP servers are stateful or stateless
2. **Report Session Issues**: Report persistent session problems to administrators
3. **Be Patient During Recovery**: Allow time for automatic session recovery to complete

## Examples

### Stateful Chat Server

```yaml
mcpServers:
  chat-assistant:
    type: streamable-http
    url: https://chat-server.example.com/mcp
    headers:
      Authorization: Bearer ${CHAT_API_KEY}
    sessionConfig:
      timeout: 7200000  # 2 hours for long conversations
      retryAttempts: 5
```

### Database Connection Server

```yaml
mcpServers:
  database-connector:
    type: streamable-http
    url: https://db-server.example.com/mcp
    headers:
      Database-Token: ${DB_TOKEN}
    sessionConfig:
      timeout: 1800000  # 30 minutes for database operations
      retryAttempts: 3
```

### Stateless Utility Server

```yaml
mcpServers:
  calculator:
    type: streamable-http
    url: https://calc-server.example.com/mcp
    # No session configuration needed for stateless servers
```

## Session Management API

### Internal API Methods

LibreChat provides internal API methods for session management:

```typescript
// Get session information for a user and server
const sessionInfo = mcpManager.getSessionInfo(userId, serverName);

// Get all active sessions
const allSessions = mcpManager.getAllActiveSessions();

// Get session statistics
const stats = mcpManager.getSessionStats();
```

### Session Events

LibreChat emits events for session lifecycle management:

```typescript
// Listen for session events
connection.on('sessionCreated', (sessionInfo) => {
  console.log('Session created:', sessionInfo.sessionId);
});

connection.on('sessionTerminated', (sessionInfo) => {
  console.log('Session terminated:', sessionInfo.sessionId);
});

connection.on('sessionError', (error) => {
  console.log('Session error:', error.type, error.message);
});
```

## Migration Guide

### Upgrading from Non-Session MCP

If you're upgrading from a LibreChat version without session management:

1. **No Configuration Changes Required**: Session management is automatically enabled
2. **Backward Compatibility**: Stateless servers continue to work without changes
3. **New Features Available**: Stateful servers now benefit from session management
4. **Monitor Logs**: Check logs for any session-related messages during upgrade

### Server Migration

To migrate your MCP server to support sessions:

1. **Add Session Support**: Implement `Mcp-Session-Id` header handling
2. **Session Storage**: Add session state storage to your server
3. **Termination Endpoint**: Implement DELETE `/session` endpoint
4. **Test Thoroughly**: Verify session creation, persistence, and termination

## Related Documentation

- [MCP Configuration Guide](./mcp-configuration.md)
- [MCP Server Development](./mcp-server-development.md)
- [Troubleshooting MCP Connections](./mcp-troubleshooting.md)
- [MCP Security Best Practices](./mcp-security.md)
