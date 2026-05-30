import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AdapterModel } from "@paperclipai/adapter-utils";
import { models as fallbackModels } from "../index.js";

const MODELS_CACHE_TTL_MS = 60_000;
const MODELS_FETCH_TIMEOUT_MS = 5_000;

type AutohandProvider = "openrouter" | "openai" | "ollama" | "custom";

type AutohandModelConfig = {
  provider: AutohandProvider;
  baseUrl: string;
  apiKey: string | null;
  configuredModel: string | null;
};

let cached: { key: string; expiresAt: number; models: AdapterModel[] } | null = null;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function fingerprint(value: string | null): string {
  if (!value) return "none";
  return `${value.length}:${value.slice(-6)}`;
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const result: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({ id, label: model.label.trim() || id });
  }
  return result;
}

function sortModels(models: AdapterModel[]): AdapterModel[] {
  const defaultModels = new Set(["auto"]);
  return [...models].sort((a, b) => {
    if (defaultModels.has(a.id) && !defaultModels.has(b.id)) return -1;
    if (!defaultModels.has(a.id) && defaultModels.has(b.id)) return 1;
    return a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" });
  });
}

function mergeWithFallback(discovered: AdapterModel[], configuredModel: string | null): AdapterModel[] {
  return sortModels(dedupeModels([
    ...fallbackModels,
    ...(configuredModel ? [{ id: configuredModel, label: configuredModel }] : []),
    ...discovered,
  ]));
}

function autohandConfigPath(): string {
  return (
    asNonEmptyString(process.env.PAPERCLIP_AUTOHAND_CONFIG_PATH) ??
    asNonEmptyString(process.env.AUTOHAND_CONFIG_PATH) ??
    path.join(os.homedir(), ".autohand", "config.json")
  );
}

async function readAutohandConfig(): Promise<Record<string, unknown>> {
  try {
    return asRecord(JSON.parse(await fs.readFile(autohandConfigPath(), "utf8")));
  } catch {
    return {};
  }
}

function providerFromConfig(config: Record<string, unknown>): AutohandProvider {
  const provider = asNonEmptyString(config.provider)?.toLowerCase();
  if (provider === "openrouter" || provider === "openai" || provider === "ollama") return provider;
  return "custom";
}

function resolveOpenAiBaseUrl(providerConfig: Record<string, unknown>, fallback: string): string {
  const raw =
    asNonEmptyString(providerConfig.baseUrl) ??
    asNonEmptyString(providerConfig.baseURL) ??
    asNonEmptyString(providerConfig.apiBaseUrl) ??
    asNonEmptyString(providerConfig.apiBaseURL) ??
    fallback;
  return raw.replace(/\/+$/, "");
}

function resolveOllamaBaseUrl(providerConfig: Record<string, unknown>): string {
  const raw =
    asNonEmptyString(providerConfig.baseUrl) ??
    asNonEmptyString(providerConfig.baseURL) ??
    asNonEmptyString(process.env.OLLAMA_HOST) ??
    "http://localhost:11434";
  return raw.replace(/\/+$/, "");
}

function resolveModelConfig(config: Record<string, unknown>): AutohandModelConfig {
  const provider = providerFromConfig(config);
  const providerConfig = asRecord(config[provider]);
  const configuredModel = asNonEmptyString(providerConfig.model) ?? asNonEmptyString(config.model);

  if (provider === "openrouter") {
    return {
      provider,
      baseUrl: resolveOpenAiBaseUrl(providerConfig, "https://openrouter.ai/api/v1"),
      apiKey:
        asNonEmptyString(process.env.OPENROUTER_API_KEY) ??
        asNonEmptyString(providerConfig.apiKey) ??
        asNonEmptyString(process.env.AUTOHAND_API_KEY),
      configuredModel,
    };
  }

  if (provider === "openai") {
    return {
      provider,
      baseUrl: resolveOpenAiBaseUrl(
        providerConfig,
        asNonEmptyString(process.env.OPENAI_BASE_URL) ??
          asNonEmptyString(process.env.OPENAI_API_BASE_URL) ??
          asNonEmptyString(process.env.OPENAI_API_BASE) ??
          "https://api.openai.com/v1",
      ),
      apiKey: asNonEmptyString(process.env.OPENAI_API_KEY) ?? asNonEmptyString(providerConfig.apiKey),
      configuredModel,
    };
  }

  if (provider === "ollama") {
    return {
      provider,
      baseUrl: resolveOllamaBaseUrl(providerConfig),
      apiKey: null,
      configuredModel,
    };
  }

  return {
    provider,
    baseUrl: "",
    apiKey: null,
    configuredModel,
  };
}

function cacheKey(config: AutohandModelConfig): string {
  return [
    config.provider,
    config.baseUrl,
    fingerprint(config.apiKey),
    config.configuredModel ?? "",
  ].join("\n");
}

function appendPath(baseUrl: string, suffix: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${suffix.replace(/^\/+/, "")}`;
}

export function parseOpenAiCompatibleModelsPayload(payload: unknown): AdapterModel[] {
  const data = Array.isArray(asRecord(payload).data) ? asRecord(payload).data as unknown[] : [];
  const models: AdapterModel[] = [];
  for (const item of data) {
    const record = asRecord(item);
    const id = asNonEmptyString(record.id);
    if (!id) continue;
    const label = asNonEmptyString(record.name) ?? id;
    models.push({ id, label });
  }
  return dedupeModels(models);
}

export function parseOllamaModelsPayload(payload: unknown): AdapterModel[] {
  const data = Array.isArray(asRecord(payload).models) ? asRecord(payload).models as unknown[] : [];
  const models: AdapterModel[] = [];
  for (const item of data) {
    const record = asRecord(item);
    const id = asNonEmptyString(record.name) ?? asNonEmptyString(record.model);
    if (!id) continue;
    models.push({ id, label: id });
  }
  return dedupeModels(models);
}

async function fetchJson(url: string, apiKey: string | null): Promise<unknown | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODELS_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function discoverModels(config: AutohandModelConfig): Promise<AdapterModel[]> {
  if (config.provider === "openrouter" || config.provider === "openai") {
    const payload = await fetchJson(appendPath(config.baseUrl, "models"), config.apiKey);
    return parseOpenAiCompatibleModelsPayload(payload);
  }

  if (config.provider === "ollama") {
    const payload = await fetchJson(appendPath(config.baseUrl, "api/tags"), null);
    return parseOllamaModelsPayload(payload);
  }

  return [];
}

async function loadAutohandModels(options?: { forceRefresh?: boolean }): Promise<AdapterModel[]> {
  const config = resolveModelConfig(await readAutohandConfig());
  const fallback = mergeWithFallback([], config.configuredModel);
  const key = cacheKey(config);
  const now = Date.now();

  if (!options?.forceRefresh && cached && cached.key === key && cached.expiresAt > now) {
    return cached.models;
  }

  const discovered = await discoverModels(config);
  if (discovered.length > 0) {
    const models = mergeWithFallback(discovered, config.configuredModel);
    cached = { key, expiresAt: now + MODELS_CACHE_TTL_MS, models };
    return models;
  }

  if (cached && cached.key === key && cached.models.length > 0) {
    return cached.models;
  }

  return fallback;
}

export async function listAutohandModels(): Promise<AdapterModel[]> {
  return loadAutohandModels();
}

export async function refreshAutohandModels(): Promise<AdapterModel[]> {
  return loadAutohandModels({ forceRefresh: true });
}

export function resetAutohandModelsCacheForTests() {
  cached = null;
}
