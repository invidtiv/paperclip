## Overview

ACP mode implements the Agent Communication Protocol using the `@agentclientprotocol/sdk` (v0.12.0). It provides a higher-level interface compared to RPC mode, with built-in session management, authentication, and model switching.

### ACP vs RPC

| Feature | ACP Mode | RPC Mode |
| --- | --- | --- |
| Protocol | ndJSON (newline-delimited JSON) | JSON-RPC 2.0 |
| Session management | Built-in (create, resume, fork, list) | Single session per process |
| Authentication | Built-in handshake | Inherits from CLI config |
| Model switching | Runtime switching supported | Fixed at startup |
| Permission modes | Configurable per session | Global only |
| Hook notifications | Streamed as events | Not available |
| Best for | Editor integrations, long-running agents | Scripts, CI/CD, simple automation |

**When to use ACP:** Use ACP when you need persistent sessions, model switching, or building editor extensions (like Zed or VS Code). Use [RPC mode](https://autohand.ai/docs/integrations/rpc-mode.html) for simpler automation scripts and CI/CD pipelines.

## Getting Started

### Start ACP Mode

Launch Autohand in ACP mode:

```
# Start ACP server
autohand --acp

# The server listens on stdin/stdout using ndJSON
```

### Connection Flow

ACP requires a handshake before sending prompts:

```
Client                    Server
  |                         |
  |--- initialize --------->|
  |<-- capabilities --------|
  |                         |
  |--- authenticate ------->|
  |<-- authenticated -------|
  |                         |
  |--- newSession --------->|
  |<-- sessionCreated ------|
  |                         |
  |--- prompt ------------->|
  |<-- streaming events ----|
  |<-- promptComplete ------|
```

## Core Methods

### initialize

Start the connection and discover server capabilities:

1234567891011121314151617181920212223242526

```
// Request
{
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "my-editor",
      "version": "1.0.0"
    }
  }
}

// Response
{
  "method": "initialize",
  "result": {
    "serverInfo": {
      "name": "autohand",
      "version": "0.8.0"
    },
    "capabilities": {
      "sessions": true,
      "modelSwitching": true,
      "hooks": true
    }
  }
}
```

### authenticate

Authenticate the connection. Uses the CLI's existing auth configuration:

12345678910111213141516

```
// Request
{
  "method": "authenticate",
  "params": {
    "token": "ah_..."
  }
}

// Response
{
  "method": "authenticate",
  "result": {
    "authenticated": true,
    "user": "developer@example.com"
  }
}
```

### newSession

Create a new agent session:

12345678910111213141516171819

```
// Request
{
  "method": "newSession",
  "params": {
    "workingDirectory": "/path/to/project",
    "model": "nvidia/nemotron-3-super-120b-a12b:free",
    "mode": "unrestricted"
  }
}

// Response
{
  "method": "newSession",
  "result": {
    "sessionId": "sess_abc123",
    "model": "nvidia/nemotron-3-super-120b-a12b:free",
    "mode": "unrestricted"
  }
}
```

### prompt

Send a prompt to the active session. Responses stream as events:

1234567891011121314151617

```
// Request
{
  "method": "prompt",
  "params": {
    "sessionId": "sess_abc123",
    "message": "Add error handling to the API routes",
    "mentions": ["src/routes/api.ts"]
  }
}

// Streaming events follow...
{"event": "messageStart", "data": {"role": "assistant"}}
{"event": "messageDelta", "data": {"content": "I'll add error "}}
{"event": "messageDelta", "data": {"content": "handling to your API routes."}}
{"event": "toolStart", "data": {"tool": "edit_file", "path": "src/routes/api.ts"}}
{"event": "toolEnd", "data": {"tool": "edit_file", "success": true}}
{"event": "promptComplete", "data": {"success": true}}
```

### cancel

Cancel the current prompt execution:

123456

```
{
  "method": "cancel",
  "params": {
    "sessionId": "sess_abc123"
  }
}
```

## Session Management

ACP provides full session lifecycle management, letting you resume, fork, and switch between sessions.

### listSessions

List all available sessions:

12345678910111213141516171819202122232425

```
// Request
{"method": "listSessions"}

// Response
{
  "method": "listSessions",
  "result": {
    "sessions": [\
      {\
        "id": "sess_abc123",\
        "model": "nvidia/nemotron-3-super-120b-a12b:free",\
        "mode": "unrestricted",\
        "messageCount": 12,\
        "createdAt": "2026-03-04T10:00:00Z"\
      },\
      {\
        "id": "sess_def456",\
        "model": "nvidia/nemotron-3-super-120b-a12b:free",\
        "mode": "restricted",\
        "messageCount": 5,\
        "createdAt": "2026-03-04T09:30:00Z"\
      }\
    ]
  }
}
```

### resumeSession

Resume an existing session with its full conversation history:

1234567891011121314151617

```
// Request
{
  "method": "resumeSession",
  "params": {
    "sessionId": "sess_abc123"
  }
}

// Response
{
  "method": "resumeSession",
  "result": {
    "sessionId": "sess_abc123",
    "restored": true,
    "messageCount": 12
  }
}
```

### forkSession

Create a new session branching from an existing one. The new session starts with a copy of the conversation up to a specific point:

123456789101112131415161718

```
// Request
{
  "method": "forkSession",
  "params": {
    "sourceSessionId": "sess_abc123",
    "atMessage": 8
  }
}

// Response
{
  "method": "forkSession",
  "result": {
    "sessionId": "sess_ghi789",
    "forkedFrom": "sess_abc123",
    "messageCount": 8
  }
}
```

### loadSession

Load a session from a saved transcript file:

12345678910111213141516

```
// Request
{
  "method": "loadSession",
  "params": {
    "path": "/path/to/session.jsonl"
  }
}

// Response
{
  "method": "loadSession",
  "result": {
    "sessionId": "sess_loaded_001",
    "messageCount": 25
  }
}
```

## Session Modes

ACP supports configurable permission modes per session, controlling what the agent can do without asking.

### setSessionMode

Change the permission mode for the current session:

1234567

```
{
  "method": "setSessionMode",
  "params": {
    "sessionId": "sess_abc123",
    "mode": "restricted"
  }
}
```

| Mode | Behavior |
| --- | --- |
| `unrestricted` | Agent can read, write, and execute commands freely. Similar to YOLO mode in the CLI. |
| `restricted` | Agent asks for approval before writes and command execution. Default behavior. |
| `dry-run` | Agent can only read files and suggest changes. No writes or commands are executed. |
| `full-access` | Unrestricted with additional permissions for network and system operations. |

## Model Switching

ACP supports changing the model mid-session without restarting.

### unstable\_setSessionModel

Switch the model for the current session:

1234567891011121314151617

```
// Request
{
  "method": "unstable_setSessionModel",
  "params": {
    "sessionId": "sess_abc123",
    "model": "anthropic/claude-opus-4"
  }
}

// Response
{
  "method": "unstable_setSessionModel",
  "result": {
    "previousModel": "nvidia/nemotron-3-super-120b-a12b:free",
    "currentModel": "anthropic/claude-opus-4"
  }
}
```

**Unstable API:** The `unstable_` prefix means this method's interface may change in future releases. Pin your client to a specific CLI version if you depend on this.

## Hook Notifications

ACP streams hook events to the client, letting editor integrations respond to lifecycle events like file saves, command execution, and permission checks.

123456789101112131415161718192021

```
// Hook fired before a tool executes
{
  "event": "hookNotification",
  "data": {
    "hook": "PreToolExecution",
    "tool": "bash",
    "command": "npm test",
    "sessionId": "sess_abc123"
  }
}

// Hook fired after file changes
{
  "event": "hookNotification",
  "data": {
    "hook": "PostToolExecution",
    "tool": "edit_file",
    "path": "src/auth.ts",
    "sessionId": "sess_abc123"
  }
}
```

Hook notifications are read-only events. To configure which hooks fire, set them up in the CLI configuration file (`.autohand/hooks.json`).

## Integration Example

### Zed Editor

The Zed editor uses ACP to embed Autohand as an inline agent. Here is how a typical integration works:

1234567891011121314151617181920212223242526272829303132333435363738394041424344454647484950515253545556575859

```
import { spawn } from "child_process";
import { createInterface } from "readline";

// Start ACP server
const agent = spawn("autohand", ["--acp"]);
const rl = createInterface({ input: agent.stdout });

function send(msg: object) {
    agent.stdin.write(JSON.stringify(msg) + "\n");
}

// Handle streaming responses
rl.on("line", (line) => {
    const msg = JSON.parse(line);

    switch (msg.event) {
        case "messageDelta":
            // Render text in editor panel
            editor.appendText(msg.data.content);
            break;
        case "toolStart":
            // Show tool indicator
            statusBar.show(`Running: ${msg.data.tool}`);
            break;
        case "toolEnd":
            statusBar.clear();
            break;
        case "hookNotification":
            // React to hooks (refresh file tree, etc.)
            if (msg.data.tool === "edit_file") {
                fileTree.refresh(msg.data.path);
            }
            break;
        case "promptComplete":
            statusBar.show("Done");
            break;
    }
});

// Initialize connection
send({
    method: "initialize",
    params: { clientInfo: { name: "zed", version: "0.170.0" } }
});

// After init response, authenticate and create session
send({
    method: "authenticate",
    params: { token: process.env.AUTOHAND_TOKEN }
});

send({
    method: "newSession",
    params: {
        workingDirectory: projectPath,
        model: "nvidia/nemotron-3-super-120b-a12b:free",
        mode: "restricted"
    }
});
```

### VS Code Extension

For VS Code, the pattern is similar but uses the extension API for UI elements:

123456789101112131415161718192021222324252627282930313233343536373839404142434445464748495051525354

```
import * as vscode from "vscode";
import { spawn } from "child_process";
import { createInterface } from "readline";

export function activate(context: vscode.ExtensionContext) {
    const agent = spawn("autohand", ["--acp"]);
    const rl = createInterface({ input: agent.stdout });

    function send(msg: object) {
        agent.stdin.write(JSON.stringify(msg) + "\n");
    }

    // Initialize ACP connection
    send({
        method: "initialize",
        params: { clientInfo: { name: "vscode-autohand", version: "1.0.0" } }
    });

    // Register command
    const cmd = vscode.commands.registerCommand(
        "autohand.prompt",
        async () => {
            const input = await vscode.window.showInputBox({
                prompt: "Ask Autohand..."
            });
            if (input) {
                send({
                    method: "prompt",
                    params: {
                        sessionId: currentSessionId,
                        message: input,
                        mentions: [\
                            vscode.window.activeTextEditor?.document.uri.fsPath\
                        ].filter(Boolean)
                    }
                });
            }
        }
    );

    context.subscriptions.push(cmd);

    // Handle events
    rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (msg.event === "messageDelta") {
            outputChannel.append(msg.data.content);
        }
    });

    context.subscriptions.push({
        dispose: () => agent.kill()
    });
}
```

## Error Handling

ACP returns structured errors with codes and messages:

123456789101112131415

```
{
  "method": "prompt",
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session sess_invalid does not exist"
  }
}

{
  "method": "authenticate",
  "error": {
    "code": "AUTH_FAILED",
    "message": "Invalid or expired token"
  }
}
```

| Error Code | Description |
| --- | --- |
| `AUTH_FAILED` | Authentication failed or token expired |
| `SESSION_NOT_FOUND` | Referenced session does not exist |
| `SESSION_BUSY` | Session is already processing a prompt |
| `INVALID_MODEL` | Requested model is not available |
| `INVALID_MODE` | Requested session mode is not valid |
| `NOT_INITIALIZED` | Called a method before initialization |

Copy page