import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@paperclipai/adapter-utils";
import {
  asNumber,
  asString,
  ensurePathInEnv,
  parseObject,
} from "@paperclipai/adapter-utils/server-utils";
import {
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  resolveAdapterExecutionTargetCwd,
  runAdapterExecutionTargetProcess,
} from "@paperclipai/adapter-utils/execution-target";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function normalizeEnv(input: unknown): Record<string, string> {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return {};
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

function hasNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function summarizeProbeDetail(stdout: string, stderr: string): string | null {
  const raw = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  const max = 240;
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean;
}

export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentCheck[] = [];
  const config = parseObject(ctx.config);
  const command = asString(config.command, "kimi");
  const target = ctx.executionTarget ?? null;
  const targetIsRemote = target?.kind === "remote";
  const cwd = resolveAdapterExecutionTargetCwd(target, asString(config.cwd, ""), process.cwd());
  const targetLabel = targetIsRemote
    ? ctx.environmentName ?? describeAdapterExecutionTarget(target)
    : null;
  const runId = `kimi-envtest-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (targetLabel) {
    checks.push({
      code: "kimi_environment_target",
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
      code: "kimi_cwd_valid",
      level: "info",
      message: `Working directory is valid: ${cwd}`,
    });
  } catch (err) {
    checks.push({
      code: "kimi_cwd_invalid",
      level: "error",
      message: err instanceof Error ? err.message : "Invalid working directory",
      detail: cwd,
    });
  }

  const env = normalizeEnv(config.env);
  const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });

  try {
    await ensureAdapterExecutionTargetCommandResolvable(command, target, cwd, runtimeEnv);
    checks.push({
      code: "kimi_command_resolvable",
      level: "info",
      message: `Command is executable: ${command}`,
    });
  } catch (err) {
    checks.push({
      code: "kimi_command_unresolvable",
      level: "error",
      message: err instanceof Error ? err.message : "Command is not executable",
      detail: command,
    });
  }

  const hasConfigApiKey = hasNonEmpty(env.KIMI_API_KEY);
  const hasHostApiKey = !targetIsRemote && hasNonEmpty(process.env.KIMI_API_KEY);
  if (hasConfigApiKey || hasHostApiKey) {
    checks.push({
      code: "kimi_api_key_present",
      level: "info",
      message: "Kimi API credentials are available to the CLI.",
      detail: hasConfigApiKey ? "Detected in adapter config env." : "Detected in server environment.",
    });
  } else {
    checks.push({
      code: "kimi_auth_not_probed",
      level: "info",
      message: "No KIMI_API_KEY detected. Kimi may still authenticate through `kimi login` or ~/.kimi/config.toml.",
      hint: "Run `kimi login` on the target host, or configure Kimi provider settings before running agents.",
    });
  }

  const canRunProbe =
    checks.every((check) => check.code !== "kimi_cwd_invalid" && check.code !== "kimi_command_unresolvable");
  if (canRunProbe) {
    const infoProbe = await runAdapterExecutionTargetProcess(
      runId,
      target,
      command,
      ["info"],
      {
        cwd,
        env,
        timeoutSec: Math.max(1, asNumber(config.infoProbeTimeoutSec, 15)),
        graceSec: 5,
        onLog: async () => {},
      },
    );

    if (infoProbe.timedOut) {
      checks.push({
        code: "kimi_info_probe_timed_out",
        level: "warn",
        message: "`kimi info` timed out.",
        hint: "Run `kimi info` manually from the target environment to inspect the installation.",
      });
    } else if ((infoProbe.exitCode ?? 1) !== 0) {
      checks.push({
        code: "kimi_info_probe_failed",
        level: "error",
        message: "`kimi info` failed.",
        detail: summarizeProbeDetail(infoProbe.stdout, infoProbe.stderr),
      });
    } else {
      checks.push({
        code: "kimi_info_probe_passed",
        level: "info",
        message: "`kimi info` completed.",
        detail: summarizeProbeDetail(infoProbe.stdout, infoProbe.stderr),
      });
    }
  }

  return {
    adapterType: "kimi_local",
    status: summarizeStatus(checks),
    checks,
    testedAt: new Date().toISOString(),
  };
}
