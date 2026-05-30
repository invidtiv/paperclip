import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { models as claudeFallbackModels } from "@paperclipai/adapter-claude-local";
import { resetClaudeModelsCacheForTests } from "@paperclipai/adapter-claude-local/server";
import { models as codexFallbackModels } from "@paperclipai/adapter-codex-local";
import { models as cursorFallbackModels } from "@paperclipai/adapter-cursor-local";
import { models as opencodeFallbackModels } from "@paperclipai/adapter-opencode-local";
import { resetOpenCodeModelsCacheForTests } from "@paperclipai/adapter-opencode-local/server";
import { models as autohandFallbackModels } from "@paperclipai/adapter-autohand-local";
import { resetAutohandModelsCacheForTests } from "@paperclipai/adapter-autohand-local/server";
import { listAdapterModels, listServerAdapters, refreshAdapterModels } from "../adapters/index.js";
import { resetCodexModelsCacheForTests } from "../adapters/codex-models.js";
import { resetCursorModelsCacheForTests, setCursorModelsRunnerForTests } from "../adapters/cursor-models.js";

vi.mock("acpx/runtime", () => ({
  createAcpRuntime: vi.fn(),
  createAgentRegistry: vi.fn(),
  createRuntimeStore: vi.fn(),
  isAcpRuntimeError: vi.fn(() => false),
}));

describe("adapter model listing", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_BASE_URL;
    delete process.env.ANTHROPIC_BEDROCK_BASE_URL;
    delete process.env.CLAUDE_CODE_USE_BEDROCK;
    delete process.env.PAPERCLIP_OPENCODE_COMMAND;
    delete process.env.PAPERCLIP_AUTOHAND_CONFIG_PATH;
    delete process.env.AUTOHAND_CONFIG_PATH;
    delete process.env.OPENROUTER_API_KEY;
    resetClaudeModelsCacheForTests();
    resetCodexModelsCacheForTests();
    resetCursorModelsCacheForTests();
    setCursorModelsRunnerForTests(null);
    resetOpenCodeModelsCacheForTests();
    resetAutohandModelsCacheForTests();
    vi.restoreAllMocks();
  });

  it("returns an empty list for unknown adapters", async () => {
    const models = await listAdapterModels("unknown_adapter");
    expect(models).toEqual([]);
  });

  it("uses provider-prefixed ACPX fallback model labels", () => {
    const adapter = listServerAdapters().find((candidate) => candidate.type === "acpx_local");

    expect(adapter?.models?.some((model) => model.label.startsWith("Claude: "))).toBe(true);
    expect(adapter?.models?.some((model) => model.label.startsWith("Codex: "))).toBe(true);
  });

  it("returns codex fallback models when no OpenAI key is available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const models = await listAdapterModels("codex_local");

    expect(models).toEqual(codexFallbackModels);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns claude fallback models including the latest Opus alias when no Anthropic key is available", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const models = await listAdapterModels("claude_local");

    expect(models).toEqual(claudeFallbackModels);
    expect(models.some((model) => model.id === "claude-opus-4-8")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads claude models dynamically and merges fallback options", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" },
          { id: "claude-opus-4-8-20260529", display_name: "Claude Opus 4.8" },
        ],
      }),
    } as Response);

    const first = await listAdapterModels("claude_local");
    const second = await listAdapterModels("claude_local");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "claude-opus-4-8-20260529")).toBe(true);
    expect(first.some((model) => model.id === "claude-opus-4-8")).toBe(true);
  });

  it("refreshes cached claude models on demand", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "claude-opus-4-8-20260529", display_name: "Claude Opus 4.8" }],
        }),
      } as Response);

    const initial = await listAdapterModels("claude_local");
    const refreshed = await refreshAdapterModels("claude_local");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(initial.some((model) => model.id === "claude-sonnet-4-20250514")).toBe(true);
    expect(refreshed.some((model) => model.id === "claude-opus-4-8-20260529")).toBe(true);
  });

  it("falls back to static claude models when Anthropic model discovery fails", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    const models = await listAdapterModels("claude_local");
    expect(models).toEqual(claudeFallbackModels);
  });

  it("loads codex models dynamically and merges fallback options", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "gpt-5-pro" },
          { id: "gpt-5" },
        ],
      }),
    } as Response);

    const first = await listAdapterModels("codex_local");
    const second = await listAdapterModels("codex_local");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "gpt-5-pro")).toBe(true);
    expect(first.some((model) => model.id === "codex-mini-latest")).toBe(true);
  });

  it("refreshes cached codex models on demand", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-5" }],
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: "gpt-5.5" }],
        }),
      } as Response);

    const initial = await listAdapterModels("codex_local");
    const refreshed = await refreshAdapterModels("codex_local");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(initial.some((model) => model.id === "gpt-5")).toBe(true);
    expect(refreshed.some((model) => model.id === "gpt-5.5")).toBe(true);
  });

  it("falls back to static codex models when OpenAI model discovery fails", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    } as Response);

    const models = await listAdapterModels("codex_local");
    expect(models).toEqual(codexFallbackModels);
  });


  it("returns cursor fallback models when CLI discovery is unavailable", async () => {
    setCursorModelsRunnerForTests(() => ({
      status: null,
      stdout: "",
      stderr: "",
      hasError: true,
    }));

    const models = await listAdapterModels("cursor");
    expect(models).toEqual(cursorFallbackModels);
  });

  it("returns opencode fallback models including gpt-5.4", async () => {
    process.env.PAPERCLIP_OPENCODE_COMMAND = "__paperclip_missing_opencode_command__";

    const models = await listAdapterModels("opencode_local");

    expect(models).toEqual(opencodeFallbackModels);
  });

  it("returns autohand fallback models when provider discovery is not configured", async () => {
    process.env.PAPERCLIP_AUTOHAND_CONFIG_PATH = path.join(os.tmpdir(), "paperclip-missing-autohand-config.json");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const models = await listAdapterModels("autohand_local");

    expect(models).toEqual(autohandFallbackModels);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads autohand OpenRouter models from the local Autohand config", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autohand-models-"));
    const configPath = path.join(dir, "config.json");
    await fs.writeFile(
      configPath,
      JSON.stringify({
        provider: "openrouter",
        openrouter: {
          apiKey: "sk-test",
          model: "anthropic/claude-sonnet-4.5",
          baseUrl: "https://openrouter.ai/api/v1",
        },
      }),
    );
    process.env.PAPERCLIP_AUTOHAND_CONFIG_PATH = configPath;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "openai/gpt-5.4", name: "GPT-5.4" },
          { id: "anthropic/claude-sonnet-4.5" },
        ],
      }),
    } as Response);

    const first = await listAdapterModels("autohand_local");
    const second = await listAdapterModels("autohand_local");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/models",
      expect.objectContaining({
        headers: { Authorization: "Bearer sk-test" },
      }),
    );
    expect(second).toEqual(first);
    expect(first.some((model) => model.id === "auto")).toBe(true);
    expect(first.some((model) => model.id === "anthropic/claude-sonnet-4.5")).toBe(true);
    expect(first.some((model) => model.id === "openai/gpt-5.4")).toBe(true);
  });

  it("loads cursor models dynamically and caches them", async () => {
    const runner = vi.fn(() => ({
      status: 0,
      stdout: "Available models: auto, composer-1.5, gpt-5.3-codex-high, sonnet-4.6",
      stderr: "",
      hasError: false,
    }));
    setCursorModelsRunnerForTests(runner);

    const first = await listAdapterModels("cursor");
    const second = await listAdapterModels("cursor");

    expect(runner).toHaveBeenCalledTimes(1);
    expect(first).toEqual(second);
    expect(first.some((model) => model.id === "auto")).toBe(true);
    expect(first.some((model) => model.id === "gpt-5.3-codex-high")).toBe(true);
    expect(first.some((model) => model.id === "composer-1")).toBe(true);
  });

});
