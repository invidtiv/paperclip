import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectModel } from "./detect-model.js";

const originalHome = process.env.HOME;
const tempRoots: string[] = [];

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "paperclip-gemini-detect-model-"));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;

  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("detectModel", () => {
  it("reads Gemini CLI settings model.name from ~/.gemini/settings.json", async () => {
    const home = await makeTempRoot();
    const geminiHome = path.join(home, ".gemini");
    process.env.HOME = home;
    await mkdir(geminiHome, { recursive: true });
    await writeFile(
      path.join(geminiHome, "settings.json"),
      JSON.stringify({ model: { name: "gemini-3.1-pro-preview" } }),
      "utf8",
    );

    await expect(detectModel()).resolves.toEqual({
      model: "gemini-3.1-pro-preview",
      provider: "google",
      source: path.join(geminiHome, "settings.json"),
    });
  });

  it("also accepts legacy string model settings", async () => {
    const home = await makeTempRoot();
    const geminiHome = path.join(home, ".gemini");
    process.env.HOME = home;
    await mkdir(geminiHome, { recursive: true });
    await writeFile(path.join(geminiHome, "settings.json"), JSON.stringify({ model: "gemini-2.5-pro" }), "utf8");

    await expect(detectModel()).resolves.toMatchObject({
      model: "gemini-2.5-pro",
      provider: "google",
    });
  });
});
