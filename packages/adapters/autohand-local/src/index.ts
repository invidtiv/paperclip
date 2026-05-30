import {
  buildSandboxNpmInstallCommand,
  type AdapterModelProfileDefinition,
} from "@paperclipai/adapter-utils";

export const type = "autohand_local";
export const label = "Autohand CLI (local)";

export const SANDBOX_INSTALL_COMMAND = buildSandboxNpmInstallCommand("autohand-cli");

export const DEFAULT_AUTOHAND_LOCAL_MODEL = "deepseek/deepseek-v4-flash:free";

export const models = [
  { id: DEFAULT_AUTOHAND_LOCAL_MODEL, label: "DeepSeek V4 Flash (Free)" },
  { id: "claude-3-5-sonnet", label: "Claude 3.5 Sonnet" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "llama-3.1-70b", label: "Llama 3.1 70b" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Use GPT-4o-mini as the budget lane model while preserving the primary model.",
    adapterConfig: {
      model: "gpt-4o-mini",
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# autohand_local agent configuration

Adapter: autohand_local

Use when:
- You want Paperclip to run the Autohand CLI (\`autohand\`) locally on the host machine.
- You need Paperclip skills injected locally without polluting the global environment.
- You are comfortable with fresh-session heartbeats in RPC mode.

Don't use when:
- You need webhook-style external invocation (use http or openclaw_gateway).
- You only need a one-shot script execution without an autonomous agent loop (use process).
- Autohand CLI is not installed on the machine running Paperclip.

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible).
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt.
- promptTemplate (string, optional): run prompt template.
- model (string, optional): Autohand model ID. Defaults to auto.
- thinking (boolean, optional): enable extended thinking for deep reasoning (\`--thinking\`).
- restricted (boolean, optional): run in read-only mode, denying dangerous tools (\`--restricted\`).
- dryRun (boolean, optional): preview changes without writing them to disk (\`--dry-run\`).
- yes (boolean, optional): bypass confirmation prompts (\`--yes\`, default: true).
- command (string, optional): defaults to "autohand".
- extraArgs (string[], optional): additional CLI args.
- additionalDirectories / allowedDirectories / addDirs (string[] or comma/newline string, optional): extra local directories passed to Autohand with \`--add-dir\`; use this for source trees or local context outside the execution workspace.
- env (object, optional): KEY=VALUE environment variables.

Operational fields:
- timeoutSec (number, optional): run timeout in seconds.
- graceSec (number, optional): SIGTERM grace period in seconds.

Notes:
- Runs use the Agent Communication Protocol (ACP) over stdin/stdout with \`autohand --acp\` using ndJSON.
- ACP mode natively supports stateful session management, allowing Paperclip to resume existing sessions (\`sess_...\`) cleanly across heartbeats with full conversation context and token efficiency.
- Supports configurable permission modes (\`unrestricted\`, \`restricted\`, \`dry-run\`, \`full-access\`).
- Paperclip automatically injects local skills so they are naturally discoverable by Autohand.
- Authentication utilizes the \`authenticate\` handshake step using environment API keys.
`;

