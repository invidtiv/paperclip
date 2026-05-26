import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function resolveHomeDir(): string {
  const home = process.env.HOME?.trim();
  return home || os.homedir();
}

function resolveCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME?.trim();
  return path.join(codexHome || path.join(resolveHomeDir(), ".codex"), "config.toml");
}

function stripInlineComment(line: string): string {
  let quoted: "'" | "\"" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === quoted && line[i - 1] !== "\\") quoted = null;
      continue;
    }
    if (char === "'" || char === "\"") {
      quoted = char;
      continue;
    }
    if (char === "#") return line.slice(0, i);
  }
  return line;
}

export function parseCodexConfiguredModel(contents: string): string | null {
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;
    if (line.startsWith("[")) return null;

    const match = line.match(/^model\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s]+))\s*$/);
    const model = match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
    if (model.trim()) return model.trim();
  }
  return null;
}

export async function detectModel(): Promise<{ model: string; provider: string; source: string } | null> {
  const source = resolveCodexConfigPath();
  try {
    const model = parseCodexConfiguredModel(await fs.readFile(source, "utf8"));
    return model ? { model, provider: "openai", source } : null;
  } catch {
    return null;
  }
}
