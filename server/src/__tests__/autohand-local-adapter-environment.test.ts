import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testEnvironment } from "@paperclipai/adapter-autohand-local/server";

describe("autohand_local environment diagnostics", () => {
  beforeEach(() => {
    vi.stubEnv("AUTOHAND_API_KEY", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("detects when API keys are missing", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "autohand_local",
      config: {
        command: "true", // Use true as a dummy command to bypass executable check
        env: {},
      },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      code: "autohand_api_key_missing",
      level: "warn",
    }));
  });

  it("detects API key from config env", async () => {
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "autohand_local",
      config: {
        command: "true",
        env: {
          AUTOHAND_API_KEY: "dummy-key",
        },
      },
    });

    expect(result.checks).toContainEqual(expect.objectContaining({
      code: "autohand_api_key_present",
      level: "info",
    }));
  });

  it("runs hello probe successfully", async () => {
    vi.unstubAllEnvs();
    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "autohand_local",
      config: {
        command: "/home/bsdev/.local/bin/autohand",
        env: {},
        helloProbeTimeoutSec: 90,
      },
    });

    console.log("HELLO PROBE RESULT:", JSON.stringify(result, null, 2));

    expect(result.status).not.toBe("fail");
    expect(result.checks).toContainEqual(expect.objectContaining({
      code: "autohand_hello_probe_passed",
      level: "info",
    }));
  }, 100000);
});
