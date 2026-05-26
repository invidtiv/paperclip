import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function resolveHomeDir(): string {
  const home = process.env.HOME?.trim();
  return home || os.homedir();
}

function readConfiguredModel(settings: unknown): string | null {
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) return null;
  const record = settings as Record<string, unknown>;

  if (typeof record.model === "string" && record.model.trim()) return record.model.trim();
  if (typeof record.defaultModel === "string" && record.defaultModel.trim()) {
    return record.defaultModel.trim();
  }
  if (typeof record.model === "object" && record.model !== null && !Array.isArray(record.model)) {
    const name = (record.model as Record<string, unknown>).name;
    if (typeof name === "string" && name.trim()) return name.trim();
  }

  return null;
}

export async function detectModel(): Promise<{ model: string; provider: string; source: string } | null> {
  const source = path.join(resolveHomeDir(), ".gemini", "settings.json");
  try {
    const parsed = JSON.parse(await fs.readFile(source, "utf8")) as unknown;
    const model = readConfiguredModel(parsed);
    return model ? { model, provider: "google", source } : null;
  } catch {
    return null;
  }
}
