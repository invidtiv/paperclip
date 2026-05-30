import type { AgentRecord } from "./org-layout.js";

const ADAPTER_AGNOSTIC_KEYS = [
  "env",
  "promptTemplate",
  "instructionsFilePath",
  "cwd",
  "timeoutSec",
  "graceSec",
  "bootstrapPromptTemplate",
] as const;

const DEFAULT_MODELS: Record<string, string> = {
  codex_local: "auto",
  gemini_local: "auto",
  kimi_local: "default",
  autohand_local: "auto",
  cursor: "auto",
  opencode_local: "openai/gpt-5.2-codex",
  grok_local: "grok-build",
};

const DEFAULT_COMMANDS: Record<string, { key: "command" | "hermesCommand"; value: string }> = {
  claude_local: { key: "command", value: "claude" },
  codex_local: { key: "command", value: "codex" },
  gemini_local: { key: "command", value: "gemini" },
  kimi_local: { key: "command", value: "kimi" },
  autohand_local: { key: "command", value: "autohand" },
  opencode_local: { key: "command", value: "opencode" },
  pi_local: { key: "command", value: "pi" },
  cursor: { key: "command", value: "agent" },
  grok_local: { key: "command", value: "grok" },
  hermes_local: { key: "hermesCommand", value: "hermes" },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripUndefinedEntries(value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function removeCheapProfile(runtimeConfig: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (!isRecord(runtimeConfig)) return null;
  const next = { ...runtimeConfig };
  const profiles = isRecord(next.modelProfiles) ? { ...next.modelProfiles } : null;
  if (!profiles || !isRecord(profiles.cheap)) return null;
  delete profiles.cheap;
  if (Object.keys(profiles).length === 0) delete next.modelProfiles;
  else next.modelProfiles = profiles;
  return next;
}

function preservedAdapterConfig(existing: Record<string, unknown>) {
  const preserved: Record<string, unknown> = {};
  for (const key of ADAPTER_AGNOSTIC_KEYS) {
    if (existing[key] !== undefined) preserved[key] = existing[key];
  }
  return preserved;
}

export function getDefaultModelForAdapter(adapterType: string): string {
  return DEFAULT_MODELS[adapterType] ?? "";
}

export function getDefaultCommandForAdapter(adapterType: string): { key: "command" | "hermesCommand"; value: string } | null {
  return DEFAULT_COMMANDS[adapterType] ?? null;
}

export function readAgentModel(agent: AgentRecord): string {
  const value = agent.adapterConfig?.model;
  return typeof value === "string" ? value : "";
}

export function buildProviderModelPatch(
  agent: AgentRecord,
  input: { adapterType: string; model: string },
): Record<string, unknown> {
  const existingConfig = isRecord(agent.adapterConfig) ? agent.adapterConfig : {};
  const changingAdapterType = input.adapterType !== agent.adapterType;
  const requestedModel = input.model.trim();
  const model = requestedModel || (changingAdapterType ? getDefaultModelForAdapter(input.adapterType) : "");

  if (!changingAdapterType) {
    const nextConfig = { ...existingConfig };
    if (model) nextConfig.model = model;
    else delete nextConfig.model;
    return {
      adapterConfig: stripUndefinedEntries(nextConfig),
      replaceAdapterConfig: true,
    };
  }

  const nextConfig = preservedAdapterConfig(existingConfig);
  const command = getDefaultCommandForAdapter(input.adapterType);
  if (command) nextConfig[command.key] = command.value;
  if (model) nextConfig.model = model;

  const patch: Record<string, unknown> = {
    adapterType: input.adapterType,
    adapterConfig: stripUndefinedEntries(nextConfig),
    replaceAdapterConfig: true,
  };
  const nextRuntimeConfig = removeCheapProfile(agent.runtimeConfig);
  if (nextRuntimeConfig) patch.runtimeConfig = nextRuntimeConfig;
  return patch;
}
