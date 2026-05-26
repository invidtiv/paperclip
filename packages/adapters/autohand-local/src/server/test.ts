import path from "node:path";
import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  ensurePathInEnv,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  maybeRunSandboxInstallCommand,
  ensureAdapterExecutionTargetDirectory,
  runAdapterExecutionTargetProcess,
  describeAdapterExecutionTarget,
  resolveAdapterExecutionTargetCwd,
} from "@paperclipai/adapter-utils/execution-target";
import { DEFAULT_AUTOHAND_LOCAL_MODEL, SANDBOX_INSTALL_COMMAND } from "../index.js";
import { parseAutohandJsonl } from "./parse.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function commandLooksLike(command: string, expected: string): boolean {
  const base = path.basename(command).toLowerCase();
  return base === expected || base === `${expected}.cmd` || base === `${expected}.exe`;
}

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
}

function summarizeProbeDetail(stdout: string, stderr: string, parsedError: string | null): string | null {
  const raw = parsedError?.trim() || firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "autohand");
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const targetLabel = targetIsRemote
    ? ctx.environmentName ?? describeAdapterExecutionTarget(target)
    : null;
  const runId = `autohand-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: "autohand_environment_target",
      level: "info",
      message: `Probing inside environment: ${targetLabel}`,
    });
  }

  try {
    await ensureAdapterExecutionTargetDirectory(runId, target, cwd, {
      cwd,
      env: {},
      createIfMissing: true,
    });
    checks.push({
      code: "autohand_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "autohand_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const envConfig = parseObject(config.env);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(envConfig)) {
    if (typeof value === "string") env[key] = value;
  }
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
  const installCheck = await maybeRunSandboxInstallCommand({
    runId,
    target,
    adapterKey: "autohand",
    installCommand: SANDBOX_INSTALL_COMMAND,
    detectCommand: command,
    env,
  });
  if (installCheck) checks.push(installCheck);

  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv);
    checks.push({
      code: "autohand_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "autohand_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const configApiKey = env.AUTOHAND_API_KEY || env.OPENROUTER_API_KEY || env.OPENAI_API_KEY;
  const hostApiKey = targetIsRemote ? undefined : (process.env.AUTOHAND_API_KEY || process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY);

  if (isNonEmpty(configApiKey) || isNonEmpty(hostApiKey)) {
    const source = isNonEmpty(configApiKey) ? "adapter config env" : "server environment";
    checks.push({
      code: "autohand_api_key_present",
      level: "info",
      message: "Autohand/OpenRouter API credentials are set for authentication.",
      detail: `Detected in ${source}.`,
    });
  } else {
    checks.push({
      code: "autohand_api_key_missing",
      level: "warn",
      message: "No explicit API key detected in config env.",
      hint: "Set AUTOHAND_API_KEY or OPENROUTER_API_KEY in agent adapter environment config if the hello probe fails.",
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "autohand_cwd_invalid" && check.code !== "autohand_command_unresolvable");

  if (canRunProbe) {
    if (!commandLooksLike(command, "autohand")) {
      checks.push({
        code: "autohand_hello_probe_skipped_custom_command",
        level: "info",
        message: "Skipped hello probe because command is not `autohand`.",
        detail: command,
      });
    } else {
      const model = asString(config.model, DEFAULT_AUTOHAND_LOCAL_MODEL).trim();
      const helloProbeTimeoutSec = Math.max(1, asNumber(config.helloProbeTimeoutSec, 60));
      const extraArgs = (() => {
        const fromExtraArgs = asStringArray(config.extraArgs);
        if (fromExtraArgs.length > 0) return fromExtraArgs;
        return asStringArray(config.args);
      })();

      const args = ["--output-format", "stream-json", "--prompt", "Respond with hello.", "--yes"];
      if (model && model !== DEFAULT_AUTOHAND_LOCAL_MODEL) args.push("--model", model);
      if (extraArgs.length > 0) args.push(...extraArgs);

      const probe = await runAdapterExecutionTargetProcess(
        runId,
        target,
        command,
        args,
        {
          cwd,
          env,
          timeoutSec: helloProbeTimeoutSec,
          graceSec: 5,
          onLog: async () => { },
        },
      );

      const parsed = parseAutohandJsonl(probe.stdout);
      const detail = summarizeProbeDetail(probe.stdout, probe.stderr, parsed.errorMessage);

      if (probe.timedOut) {
        checks.push({
          code: "autohand_hello_probe_timed_out",
          level: "warn",
          message: "Autohand hello probe timed out.",
          hint: "Verify if `autohand` can run and respond manually from this directory.",
        });
      } else if ((probe.exitCode ?? 1) === 0) {
        const summary = parsed.summary.trim();
        const hasHello = /\bhello\b/i.test(summary);
        checks.push({
          code: hasHello ? "autohand_hello_probe_passed" : "autohand_hello_probe_unexpected_output",
          level: hasHello ? "info" : "warn",
          message: hasHello
            ? "Autohand hello probe succeeded."
            : "Autohand probe ran but did not return `hello` as expected.",
          ...(summary ? { detail: summary.slice(0, 240) } : {}),
        });
      } else {
        checks.push({
          code: "autohand_hello_probe_failed",
          level: "error",
          message: "Autohand hello probe failed.",
          ...(detail ? { detail } : {}),
          hint: "Run `autohand --output-format json -p \"Respond with hello.\"` manually in this directory to debug.",
        });
      }
    }
  }

  return {
    adapterType: ctx.adapterType,
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
