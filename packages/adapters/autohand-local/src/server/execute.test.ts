import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execute } from "./execute.js";

async function writeFakeAutohandCommand(commandPath: string): Promise<void> {
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const readline = require("node:readline");

const capturePath = process.env.PAPERCLIP_TEST_CAPTURE_PATH;
const rl = readline.createInterface({ input: process.stdin });
const capturedLines = [];

rl.on("line", (line) => {
  capturedLines.push(line);
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    return;
  }

  const { id, method, params } = parsed;

  if (method === "initialize") {
    console.log(JSON.stringify({
      id,
      method: "initialize",
      result: {
        serverInfo: { name: "autohand", version: "0.8.0" },
        capabilities: { sessions: true }
      }
    }));
  } else if (method === "authenticate") {
    console.log(JSON.stringify({
      id,
      method: "authenticate",
      result: { authenticated: true, user: "developer@example.com" }
    }));
  } else if (method === "newSession") {
    console.log(JSON.stringify({
      id,
      method: "newSession",
      result: { sessionId: "autohand-session-1" }
    }));
  } else if (method === "prompt") {
    if (capturePath) {
      fs.writeFileSync(capturePath, JSON.stringify({
        argv: process.argv.slice(2),
        promptLine: line,
        capturedLines,
      }), "utf8");
    }
    console.log(JSON.stringify({ event: "messageStart", data: { role: "assistant" } }));
    console.log(JSON.stringify({ event: "messageDelta", data: { content: "done" } }));
    console.log(JSON.stringify({ event: "promptComplete", data: { success: true, tokensUsed: 1 } }));
    setTimeout(() => {
      process.exit(0);
    }, 100);
  }
});
`;
  await fs.writeFile(commandPath, script, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("autohand execute", () => {
  it("pre-grants managed instructions and configured local directories with --add-dir", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autohand-execute-"));
    const workspace = path.join(root, "workspace");
    const instructionsDir = path.join(root, "instructions");
    const extraDir = path.join(root, "extra");
    const missingDir = path.join(root, "missing");
    const commandPath = path.join(root, "autohand");
    const capturePath = path.join(root, "capture.json");
    await fs.mkdir(workspace, { recursive: true });
    await fs.mkdir(instructionsDir, { recursive: true });
    await fs.mkdir(extraDir, { recursive: true });
    const instructionsPath = path.join(instructionsDir, "AGENTS.md");
    await fs.writeFile(instructionsPath, "Use local instructions.\n", "utf8");
    await writeFakeAutohandCommand(commandPath);

    try {
      const result = await execute({
        runId: "run-autohand-add-dir",
        agent: {
          id: "agent-1",
          companyId: "company-1",
          name: "Autohand Agent",
          adapterType: "autohand_local",
          adapterConfig: {},
        },
        runtime: {
          sessionId: null,
          sessionParams: null,
          sessionDisplayId: null,
          taskKey: null,
        },
        config: {
          command: commandPath,
          cwd: workspace,
          instructionsFilePath: instructionsPath,
          additionalDirectories: [extraDir, missingDir],
          allowedDirectories: `${extraDir}\n${missingDir}`,
          env: {
            PAPERCLIP_TEST_CAPTURE_PATH: capturePath,
          },
          timeoutSec: 10,
        },
        context: {},
        onLog: async () => {},
      });

      expect(result.timedOut).toBe(false);
      expect(result.errorMessage).toBeNull();
      const capture = JSON.parse(await fs.readFile(capturePath, "utf8")) as {
        argv: string[];
        promptLine: string;
      };
      expect(capture.argv).toEqual(expect.arrayContaining(["--acp", "--yes"]));
      expect(capture.argv).toEqual(expect.arrayContaining(["--add-dir", instructionsDir]));
      expect(capture.argv).toEqual(expect.arrayContaining(["--add-dir", extraDir]));
      expect(capture.argv).not.toContain(missingDir);
      expect(capture.argv.filter((arg) => arg === extraDir)).toHaveLength(1);
      expect(capture.promptLine).toContain("prompt");
      expect(capture.promptLine).toContain("Use local instructions.");
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
