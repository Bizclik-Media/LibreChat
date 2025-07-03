# MCP Session Management - Quick Reference

## Quick Start

### Check if Session Management is Working

1. **Enable Debug Logging**:
   ```bash
   MCP_SESSION_DEBUG=true
   ```

2. **Look for Session Messages in Logs**:
   ```
   [MCP][server-name] Session created: 12345678...
   [MCP][server-name] Session terminated: 12345678...
   ```

3. **Test with a Stateful Server**:
   ```yaml
   mcpServers:
     test-server:
       type: streamable-http
       url: https://your-stateful-server.com/mcp
   ```

## Configuration Cheat Sheet

### Basic Stateful Server
```yaml
mcpServers:
  my-server:
    type: streamable-http
    url: https://server.com/mcp
    headers:
      Authorization: Bearer ${API_KEY}
```

### Advanced Session Configuration
```yaml
mcpServers:
  my-server:
    type: streamable-http
    url: https://server.com/mcp
    sessionConfig:
      timeout: 3600000      # 1 hour
      retryAttempts: 3      # 3 retry attempts
      retryDelay: 1000      # 1 second delay
```

### Environment Variables
```bash
# Session timeout (milliseconds)
MCP_SESSION_TIMEOUT=3600000

# Retry configuration
MCP_SESSION_RETRY_ATTEMPTS=3
MCP_SESSION_RETRY_DELAY=1000

# Debug logging
MCP_SESSION_DEBUG=true
```

## Error Reference

| Error Code | Meaning | Auto Recovery |
|------------|---------|---------------|
| `session_terminated` | Server ended session | ✅ Yes |
| `session_expired` | Session timed out | ✅ Yes |
| `session_invalid` | Bad session ID | ✅ Yes |
| `session_conflict` | Multiple sessions | ✅ Yes |
| `session_timeout` | Operation timeout | ✅ Yes |

## Troubleshooting Commands

### Test Server Connectivity
```bash
curl -H "Accept: application/json" https://your-server.com/mcp
```

### Test Session Creation
```bash
curl -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  https://your-server.com/mcp
```

### Check for Session Header
```bash
curl -I -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  https://your-server.com/mcp | grep -i mcp-session-id
```

### Test Session Termination
```bash
curl -X DELETE -H "Mcp-Session-Id: your-session-id" \
  https://your-server.com/session
```

## Common Issues & Solutions

### ❌ "Session not created"
**Cause**: Server doesn't support sessions (stateless)
**Solution**: This is normal for stateless servers

### ❌ "Session terminated frequently"
**Causes**: 
- Server timeout too short
- Network issues
- Server restarts

**Solutions**:
- Increase session timeout
- Check network stability
- Contact server admin

### ❌ "Session recovery fails"
**Causes**:
- Server down
- Auth issues
- Config problems

**Solutions**:
- Check server status
- Verify credentials
- Review configuration

### ❌ "Multiple session errors"
**Cause**: Session conflicts
**Solution**: LibreChat handles automatically

## Log Messages Explained

### Normal Operation
```
[MCP][server] Session created: 12345678...
[MCP][server] Session terminated: 12345678...
```

### Error Recovery
```
[MCP][server] Session error: session_terminated - Session has been terminated
[MCP][server] Starting session recovery for error: session_terminated
[MCP][server] Session recovery successful
```

### Debug Information
```
[MCP][server] Using existing session ID: 12345678...
[MCP][server] Session extracted: 12345678...
[MCP][server] Session termination request sent
```

## Server Types

### ✅ Stateful Servers (Session Required)
- Database connections
- Authenticated APIs
- Chat services with context
- User preference storage

**Characteristics**:
- Returns `Mcp-Session-Id` header
- Maintains state between requests
- Requires session validation

### ✅ Stateless Servers (No Session)
- Calculation tools
- Public APIs
- Utility functions
- Simple transformations

**Characteristics**:
- No `Mcp-Session-Id` header
- Each request independent
- No state maintenance

## Monitoring

### Session Statistics
```typescript
// Get session stats
const stats = mcpManager.getSessionStats();
console.log(stats);
// Output: { totalUsers: 5, totalSessions: 8, activeSessions: 6 }
```

### Active Sessions
```typescript
// Get all active sessions
const sessions = mcpManager.getAllActiveSessions();
```

### User Session Info
```typescript
// Get specific user's session
const sessionInfo = mcpManager.getSessionInfo(userId, serverName);
```

## Best Practices

### ✅ Do
- Enable debug logging for troubleshooting
- Monitor session statistics regularly
- Configure appropriate timeouts
- Test session recovery scenarios
- Document server session requirements

### ❌ Don't
- Disable session management for stateful servers
- Set extremely short timeouts
- Ignore session error logs
- Assume all servers need sessions
- Modify session IDs manually

## Quick Diagnostics

### 1. Check if Sessions are Working
```bash
# Look for session creation in logs
grep "Session created" /path/to/librechat.log

# Count active sessions
grep "Session created" /path/to/librechat.log | wc -l
```

### 2. Monitor Session Errors
```bash
# Check for session errors
grep "Session error" /path/to/librechat.log

# Check recovery attempts
grep "Session recovery" /path/to/librechat.log
```

### 3. Verify Server Response
```bash
# Check if server returns session header
curl -I -X POST https://your-server.com/mcp | grep -i session
```

## Configuration Examples

### Long-Running Database Connection
```yaml
mcpServers:
  database:
    type: streamable-http
    url: https://db-server.com/mcp
    sessionConfig:
      timeout: 7200000  # 2 hours
      retryAttempts: 5
```

### Short-Lived API Connection
```yaml
mcpServers:
  api-service:
    type: streamable-http
    url: https://api-server.com/mcp
    sessionConfig:
      timeout: 900000   # 15 minutes
      retryAttempts: 2
```

### High-Availability Service
```yaml
mcpServers:
  critical-service:
    type: streamable-http
    url: https://critical-server.com/mcp
    sessionConfig:
      timeout: 1800000  # 30 minutes
      retryAttempts: 10
      retryDelay: 2000  # 2 seconds
```

## Support

### Getting Help
1. Check logs with debug enabled
2. Verify server documentation
3. Test with curl commands
4. Join LibreChat Discord for support
5. Open GitHub issue with logs

### Reporting Issues
Include in your report:
- LibreChat version
- MCP server details
- Configuration (sanitized)
- Error logs
- Steps to reproduce
