import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectModel, parseCodexConfiguredModel } from "./detect-model.js";

const originalHome = process.env.HOME;
const originalCodexHome = process.env.CODEX_HOME;
const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-codex-detect-model-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;

  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("detectModel", () => {
  it("reads the top-level Codex model from CODEX_HOME/config.toml", async () => {
    const codexHome = await makeTempRoot();
    process.env.CODEX_HOME = codexHome;
    await writeFile(path.join(codexHome, "config.toml"), 'model = "gpt-5.5"\n', "utf8");

    await expect(detectModel()).resolves.toEqual({
      model: "gpt-5.5",
      provider: "openai",
      source: path.join(codexHome, "config.toml"),
    });
  });

  it("falls back to ~/.codex/config.toml when CODEX_HOME is not set", async () => {
    const home = await makeTempRoot();
    const codexHome = path.join(home, ".codex");
    delete process.env.CODEX_HOME;
    process.env.HOME = home;
    await mkdir(codexHome, { recursive: true });
    await writeFile(path.join(codexHome, "config.toml"), "model = 'gpt-5.4' # current default\n", "utf8");

    await expect(detectModel()).resolves.toMatchObject({
      model: "gpt-5.4",
      provider: "openai",
      source: path.join(codexHome, "config.toml"),
    });
  });

  it("does not treat profile-scoped model settings as the active default", () => {
    expect(parseCodexConfiguredModel("[profiles.work]\nmodel = \"gpt-5\"\n")).toBeNull();
  });
});
