import { describe, expect, it } from "vitest";
import { DEFAULT_KIMI_LOCAL_MODEL } from "../index.js";
import { buildKimiLocalConfig } from "./build-config.js";

describe("buildKimiLocalConfig", () => {
  it("maps create-form values into adapter config", () => {
    expect(buildKimiLocalConfig({
      cwd: "/tmp/project",
      instructionsFilePath: "/tmp/project/AGENTS.md",
      model: "kimi-k2.5",
      envVars: "KIMI_API_KEY=secret\nIGNORED-BAD=value\n",
      envBindings: {
        KIMI_BASE_URL: { type: "plain", value: "https://api.example.test" },
      },
      command: "kimi-cli",
      extraArgs: "--agent, okabe",
    } as never)).toEqual({
      cwd: "/tmp/project",
      instructionsFilePath: "/tmp/project/AGENTS.md",
      model: "kimi-k2.5",
      timeoutSec: 0,
      graceSec: 20,
      env: {
        KIMI_BASE_URL: { type: "plain", value: "https://api.example.test" },
        KIMI_API_KEY: { type: "plain", value: "secret" },
      },
      command: "kimi-cli",
      extraArgs: ["--agent", "okabe"],
    });
  });

  it("defaults model to Kimi CLI configuration", () => {
    expect(buildKimiLocalConfig({ model: "" } as never).model).toBe(DEFAULT_KIMI_LOCAL_MODEL);
  });
});
