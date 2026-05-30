export const type = "kimi_local";
export const label = "Kimi CLI (local)";

export const DEFAULT_KIMI_LOCAL_MODEL = "default";

export const models = [
  { id: DEFAULT_KIMI_LOCAL_MODEL, label: "Default from Kimi config" },
  { id: "kimi-k2.5", label: "kimi-k2.5" },
  { id: "kimi-for-coding", label: "kimi-for-coding" },
  { id: "kimi-code", label: "kimi-code" },
];

export const agentConfigurationDoc = `# kimi_local agent configuration

Adapter: kimi_local

Use when:
- You want Paperclip to run Kimi Code CLI (\`kimi\`) locally on the host machine.
- You want resumable Kimi sessions across heartbeats with \`--session <sessionId>\`.
- You want Paperclip runtime skills exposed through Kimi's native \`--skills-dir\` option without writing Paperclip files into the project checkout.

Don't use when:
- You need webhook-style external invocation (use http or openclaw_gateway).
- You only need a one-shot script without an AI coding agent loop (use process).
- Kimi CLI is not installed or configured on the machine that runs Paperclip.

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible).
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt.
- promptTemplate (string, optional): run prompt template.
- model (string, optional): Kimi model id. Defaults to "default", which lets Kimi use its configured default model.
- simulateApiCost (boolean, optional): when true, subscription-auth runs estimate API-equivalent cost from token usage for ledger visibility.
- simulatedApiInputPerMillionUsd (number, optional): override estimated input token rate per 1M tokens (default 1.25).
- simulatedApiCachedInputPerMillionUsd (number, optional): override estimated cached-input token rate per 1M tokens (default 0.125).
- simulatedApiOutputPerMillionUsd (number, optional): override estimated output token rate per 1M tokens (default 10).
- command (string, optional): defaults to "kimi".
- extraArgs (string[], optional): additional CLI args passed before \`--prompt\`.
- env (object, optional): KEY=VALUE environment variables.

Optional Kimi fields:
- configFile (string, optional): path passed as \`--config-file\`.
- config (string, optional): TOML/JSON string passed as \`--config\`.
- agent (string, optional): built-in Kimi agent name, usually "default" or "okabe".
- agentFile (string, optional): path passed as \`--agent-file\`.
- thinking (boolean, optional): pass \`--thinking\` or \`--no-thinking\`.
- maxStepsPerTurn (number, optional): pass \`--max-steps-per-turn\`.
- maxRetriesPerStep (number, optional): pass \`--max-retries-per-step\`.
- maxRalphIterations (number, optional): pass \`--max-ralph-iterations\`.

Operational fields:
- timeoutSec (number, optional): run timeout in seconds.
- graceSec (number, optional): SIGTERM grace period in seconds.

Notes:
- Runs use \`kimi --print --output-format stream-json\`.
- Print mode is non-interactive and Kimi treats it as auto-approve/yolo mode.
- Sessions resume with \`--session <sessionId>\` when the saved session cwd matches the current cwd.
- Paperclip passes a temporary \`--skills-dir\` containing selected Paperclip skills for each run.
- Authentication/configuration is owned by Kimi CLI, usually through \`kimi login\`, \`~/.kimi/config.toml\`, or Kimi environment variables such as \`KIMI_API_KEY\`.
`;
