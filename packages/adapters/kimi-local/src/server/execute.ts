import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AdapterExecutionContext, AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  adapterExecutionTargetUsesPaperclipBridge,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  overrideAdapterExecutionTargetRemoteCwd,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTarget,
  resolveAdapterExecutionTargetCommandForLogs,
  resolveAdapterExecutionTargetTimeoutSec,
  runAdapterExecutionTargetProcess,
  startAdapterExecutionTargetPaperclipBridge,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asNumber,
  asString,
  asStringArray,
  buildInvocationEnvForLogs,
  buildPaperclipEnv,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  ensureAbsoluteDirectory,
  ensurePathInEnv,
  joinPromptSections,
  parseObject,
  readPaperclipIssueWorkModeFromContext,
  readPaperclipRuntimeSkillEntries,
  refreshPaperclipWorkspaceEnvForExecution,
  renderPaperclipWakePrompt,
  renderTemplate,
  resolvePaperclipDesiredSkillNames,
  stringifyPaperclipWakePayload,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_KIMI_LOCAL_MODEL } from "../index.js";
import { detectKimiAuthRequired, parseKimiJsonl } from "./parse.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function renderPaperclipEnvNote(env: Record<string, string>): string {
  const paperclipKeys = Object.keys(env)
    .filter((key) => key.startsWith("PAPERCLIP_"))
    .sort();
  if (paperclipKeys.length === 0) return "";
  return [
    "Paperclip runtime note:",
    `The following PAPERCLIP_* environment variables are available in this run: ${paperclipKeys.join(", ")}`,
    "Do not assume these variables are missing without checking your shell environment.",
  ].join("\n");
}

function renderApiAccessNote(env: Record<string, string>): string {
  if (!hasNonEmptyEnvValue(env, "PAPERCLIP_API_URL") || !hasNonEmptyEnvValue(env, "PAPERCLIP_API_KEY")) return "";
  return [
    "Paperclip API access note:",
    "Use the Kimi Shell tool with curl to make Paperclip API requests when needed.",
    "Include Authorization: Bearer $PAPERCLIP_API_KEY on every request.",
    "Include X-Paperclip-Run-Id: $PAPERCLIP_RUN_ID on mutating requests.",
  ].join("\n");
}

function resolveKimiBillingType(env: Record<string, string>): "api" | "subscription" | "unknown" {
  if (hasNonEmptyEnvValue(env, "KIMI_API_KEY")) return "api";
  if (hasNonEmptyEnvValue(env, "OPENAI_API_KEY")) return "api";
  return "unknown";
}

function normalizeRuntimeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

function readOptionalBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled", "enable", "thinking", "high"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled", "disable", "none"].includes(normalized)) return false;
  return null;
}

function resolveThinking(config: Record<string, unknown>): boolean | null {
  const direct = readOptionalBoolean(config.thinking);
  if (direct !== null) return direct;
  return readOptionalBoolean(config.effort ?? config.thinkingEffort);
}

type KimiSkillsDir = {
  root: string;
  skillsDir: string;
  count: number;
};

async function buildKimiSkillsDir(config: Record<string, unknown>): Promise<KimiSkillsDir | null> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredNames = new Set(resolvePaperclipDesiredSkillNames(config, availableEntries));
  const selected = availableEntries.filter((entry) => desiredNames.has(entry.key));
  if (selected.length === 0) return null;

  const root = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-kimi-skills-"));
  const skillsDir = path.join(root, "skills");
  await fs.mkdir(skillsDir, { recursive: true });
  for (const entry of selected) {
    await fs.symlink(entry.source, path.join(skillsDir, entry.runtimeName));
  }
  return { root, skillsDir, count: selected.length };
}

async function readInstructionsPrefix(
  instructionsFilePath: string,
  onLog: AdapterExecutionContext["onLog"],
): Promise<{ prefix: string; notes: string[] }> {
  if (!instructionsFilePath) return { prefix: "", notes: [] };
  const instructionsDir = `${path.dirname(instructionsFilePath)}/`;
  try {
    const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
    return {
      prefix:
        `${instructionsContents}\n\n` +
        `The above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.`,
      notes: [
        `Loaded agent instructions from ${instructionsFilePath}`,
        `Prepended instructions + path directive to prompt (relative references from ${instructionsDir}).`,
      ],
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await onLog(
      "stdout",
      `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
    );
    return {
      prefix: "",
      notes: [
        `Configured instructionsFilePath ${instructionsFilePath}, but file could not be read; continuing without injected instructions.`,
      ],
    };
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);

  const promptTemplate = asString(
    config.promptTemplate,
    DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
  const command = asString(config.command, "kimi");
  const model = asString(config.model, DEFAULT_KIMI_LOCAL_MODEL).trim() || DEFAULT_KIMI_LOCAL_MODEL;
  const thinking = resolveThinking(config);

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
      (value): value is Record<string, unknown> => typeof value === "object" && value !== null,
    )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const envConfig = parseObject(config.env);
  const hasExplicitApiKey =
    typeof envConfig.PAPERCLIP_API_KEY === "string" && envConfig.PAPERCLIP_API_KEY.trim().length > 0;
  const env: Record<string, string> = { ...buildPaperclipEnv(agent) };
  env.PAPERCLIP_RUN_ID = runId;
  const wakeTaskId =
    (typeof context.taskId === "string" && context.taskId.trim().length > 0 && context.taskId.trim()) ||
    (typeof context.issueId === "string" && context.issueId.trim().length > 0 && context.issueId.trim()) ||
    null;
  const wakeReason =
    typeof context.wakeReason === "string" && context.wakeReason.trim().length > 0
      ? context.wakeReason.trim()
      : null;
  const wakeCommentId =
    (typeof context.wakeCommentId === "string" && context.wakeCommentId.trim().length > 0 && context.wakeCommentId.trim()) ||
    (typeof context.commentId === "string" && context.commentId.trim().length > 0 && context.commentId.trim()) ||
    null;
  const approvalId =
    typeof context.approvalId === "string" && context.approvalId.trim().length > 0
      ? context.approvalId.trim()
      : null;
  const approvalStatus =
    typeof context.approvalStatus === "string" && context.approvalStatus.trim().length > 0
      ? context.approvalStatus.trim()
      : null;
  const linkedIssueIds = Array.isArray(context.issueIds)
    ? context.issueIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    : [];
  const wakePayloadJson = stringifyPaperclipWakePayload(context.paperclipWake);
  const issueWorkMode = readPaperclipIssueWorkModeFromContext(context);
  if (wakeTaskId) env.PAPERCLIP_TASK_ID = wakeTaskId;
  if (issueWorkMode) env.PAPERCLIP_ISSUE_WORK_MODE = issueWorkMode;
  if (wakeReason) env.PAPERCLIP_WAKE_REASON = wakeReason;
  if (wakeCommentId) env.PAPERCLIP_WAKE_COMMENT_ID = wakeCommentId;
  if (approvalId) env.PAPERCLIP_APPROVAL_ID = approvalId;
  if (approvalStatus) env.PAPERCLIP_APPROVAL_STATUS = approvalStatus;
  if (linkedIssueIds.length > 0) env.PAPERCLIP_LINKED_ISSUE_IDS = linkedIssueIds.join(",");
  if (wakePayloadJson) env.PAPERCLIP_WAKE_PAYLOAD_JSON = wakePayloadJson;
  refreshPaperclipWorkspaceEnvForExecution({
    env,
    envConfig,
    workspaceCwd: effectiveWorkspaceCwd,
    workspaceSource,
    workspaceId,
    workspaceRepoUrl,
    workspaceRepoRef,
    workspaceHints,
    agentHome,
    executionTargetIsRemote,
    executionCwd: effectiveExecutionCwd,
  });
  if (!hasExplicitApiKey && authToken) {
    env.PAPERCLIP_API_KEY = authToken;
  }

  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
    executionTarget,
    asNumber(config.timeoutSec, 0),
  );
  const graceSec = asNumber(config.graceSec, 20);
  const effectiveEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const billingType = resolveKimiBillingType(effectiveEnv);
  const runtimeEnv = normalizeRuntimeEnv(ensurePathInEnv(effectiveEnv));
  await ensureAdapterExecutionTargetRuntimeCommandInstalled({
    runId,
    target: executionTarget,
    installCommand: ctx.runtimeCommandSpec?.installCommand,
    detectCommand: ctx.runtimeCommandSpec?.detectCommand,
    cwd,
    env: runtimeEnv,
    timeoutSec,
    graceSec,
    onLog,
  });
  await ensureAdapterExecutionTargetCommandResolvable(command, executionTarget, cwd, runtimeEnv, {
    installCommand: ctx.runtimeCommandSpec?.installCommand ?? null,
    timeoutSec,
  });
  const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
  let loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME", "KIMI_SHARE_DIR"],
    resolvedCommand,
  });

  const stagedSkills = await buildKimiSkillsDir(config);
  let restoreRemoteWorkspace: (() => Promise<void>) | null = null;
  let remoteRuntimeRootDir: string | null = null;
  let effectiveSkillsDir = stagedSkills?.skillsDir ?? null;
  let paperclipBridge: Awaited<ReturnType<typeof startAdapterExecutionTargetPaperclipBridge>> = null;

  try {
    if (executionTargetIsRemote) {
      await onLog(
        "stdout",
        `[paperclip] Syncing workspace and Kimi runtime assets to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
      );
      const preparedExecutionTargetRuntime = await prepareAdapterExecutionTargetRuntime({
        runId,
        target: executionTarget,
        adapterKey: "kimi",
        timeoutSec,
        workspaceLocalDir: cwd,
        installCommand: ctx.runtimeCommandSpec?.installCommand ?? null,
        detectCommand: ctx.runtimeCommandSpec?.detectCommand ?? command,
        assets: stagedSkills
          ? [{
              key: "skills",
              localDir: stagedSkills.skillsDir,
              followSymlinks: true,
            }]
          : [],
      });
      restoreRemoteWorkspace = () => preparedExecutionTargetRuntime.restoreWorkspace();
      effectiveExecutionCwd = preparedExecutionTargetRuntime.workspaceRemoteDir ?? effectiveExecutionCwd;
      remoteRuntimeRootDir = preparedExecutionTargetRuntime.runtimeRootDir;
      effectiveSkillsDir = preparedExecutionTargetRuntime.assetDirs.skills ?? null;
      refreshPaperclipWorkspaceEnvForExecution({
        env,
        envConfig,
        workspaceCwd: effectiveWorkspaceCwd,
        workspaceSource,
        workspaceId,
        workspaceRepoUrl,
        workspaceRepoRef,
        workspaceHints,
        agentHome,
        executionTargetIsRemote,
        executionCwd: effectiveExecutionCwd,
      });
    }

    const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(executionTarget, effectiveExecutionCwd);
    if (executionTargetIsRemote && adapterExecutionTargetUsesPaperclipBridge(executionTarget)) {
      paperclipBridge = await startAdapterExecutionTargetPaperclipBridge({
        runId,
        target: runtimeExecutionTarget,
        runtimeRootDir: remoteRuntimeRootDir,
        adapterKey: "kimi",
        timeoutSec,
        hostApiToken: env.PAPERCLIP_API_KEY,
        onLog,
      });
      if (paperclipBridge) {
        Object.assign(env, paperclipBridge.env);
        loggedEnv = buildInvocationEnvForLogs(env, {
          runtimeEnv: ensurePathInEnv({ ...process.env, ...env }),
          includeRuntimeKeys: ["HOME", "KIMI_SHARE_DIR"],
          resolvedCommand,
        });
      }
    }

    const runtimeSessionParams = parseObject(runtime.sessionParams);
    const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
    const runtimeSessionCwd = asString(runtimeSessionParams.cwd, "");
    const runtimeRemoteExecution = parseObject(runtimeSessionParams.remoteExecution);
    const canResumeSession =
      runtimeSessionId.length > 0 &&
      (runtimeSessionCwd.length === 0 || path.resolve(runtimeSessionCwd) === path.resolve(effectiveExecutionCwd)) &&
      adapterExecutionTargetSessionMatches(runtimeRemoteExecution, runtimeExecutionTarget);
    const sessionId = canResumeSession ? runtimeSessionId : randomUUID();
    if (executionTargetIsRemote && runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Kimi session "${runtimeSessionId}" does not match the current remote execution identity and will not be resumed in "${effectiveExecutionCwd}". Starting a fresh remote session.\n`,
      );
    } else if (runtimeSessionId && !canResumeSession) {
      await onLog(
        "stdout",
        `[paperclip] Kimi session "${runtimeSessionId}" was saved for cwd "${runtimeSessionCwd}" and will not be resumed in "${effectiveExecutionCwd}".\n`,
      );
    }

    const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
    const instructions = await readInstructionsPrefix(instructionsFilePath, onLog);
    const templateData = {
      agentId: agent.id,
      companyId: agent.companyId,
      runId,
      company: { id: agent.companyId },
      agent,
      run: { id: runId, source: "on_demand" },
      context,
    };
    const wakePrompt = renderPaperclipWakePrompt(context.paperclipWake, { resumedSession: canResumeSession });
    const shouldUseResumeDeltaPrompt = canResumeSession && wakePrompt.length > 0;
    const renderedPrompt = shouldUseResumeDeltaPrompt ? "" : renderTemplate(promptTemplate, templateData);
    const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
    const paperclipEnvNote = renderPaperclipEnvNote(env);
    const apiAccessNote = renderApiAccessNote(env);
    const prompt = joinPromptSections([
      instructions.prefix,
      wakePrompt,
      sessionHandoffNote,
      paperclipEnvNote,
      apiAccessNote,
      renderedPrompt,
    ]);
    const promptMetrics = {
      promptChars: prompt.length,
      instructionsChars: instructions.prefix.length,
      wakePromptChars: wakePrompt.length,
      sessionHandoffChars: sessionHandoffNote.length,
      runtimeNoteChars: paperclipEnvNote.length + apiAccessNote.length,
      heartbeatPromptChars: renderedPrompt.length,
    };
    const extraArgs = (() => {
      const fromExtraArgs = asStringArray(config.extraArgs);
      if (fromExtraArgs.length > 0) return fromExtraArgs;
      return asStringArray(config.args);
    })();
    const configString = asString(config.config, "");
    const configFile = asString(config.configFile, "");
    const agentName = asString(config.agent, "");
    const agentFile = asString(config.agentFile, "");
    const maxStepsPerTurn = asNumber(config.maxStepsPerTurn, 0);
    const maxRetriesPerStep = asNumber(config.maxRetriesPerStep, 0);
    const maxRalphIterations = asNumber(config.maxRalphIterations, Number.NaN);

    const commandNotes = [
      "Prompt is passed to Kimi via --prompt in print mode.",
      "Print mode is non-interactive and Kimi treats it as yolo/auto-approve mode.",
      `Using Kimi session ${sessionId}${canResumeSession ? " (resumed)" : " (new)"}.`,
      ...(effectiveSkillsDir && stagedSkills
        ? [`Passing ${stagedSkills.count} Paperclip skill(s) through --skills-dir.`]
        : []),
      ...instructions.notes,
    ];

    const buildArgs = () => {
      const args = [
        "--work-dir",
        effectiveExecutionCwd,
        "--print",
        "--output-format",
        "stream-json",
        "--session",
        sessionId,
      ];
      if (effectiveSkillsDir) args.push("--skills-dir", effectiveSkillsDir);
      if (model && model !== DEFAULT_KIMI_LOCAL_MODEL) args.push("--model", model);
      if (thinking === true) args.push("--thinking");
      if (thinking === false) args.push("--no-thinking");
      if (configString) args.push("--config", configString);
      if (configFile) args.push("--config-file", configFile);
      if (agentName) args.push("--agent", agentName);
      if (agentFile) args.push("--agent-file", agentFile);
      if (maxStepsPerTurn > 0) args.push("--max-steps-per-turn", String(maxStepsPerTurn));
      if (maxRetriesPerStep > 0) args.push("--max-retries-per-step", String(maxRetriesPerStep));
      if (Number.isFinite(maxRalphIterations)) args.push("--max-ralph-iterations", String(maxRalphIterations));
      if (extraArgs.length > 0) args.push(...extraArgs);
      args.push("--prompt", prompt);
      return args;
    };

    const args = buildArgs();
    if (onMeta) {
      await onMeta({
        adapterType: "kimi_local",
        command: resolvedCommand,
        cwd: effectiveExecutionCwd,
        commandNotes,
        commandArgs: args.map((value, index) => (
          index === args.length - 1 ? `<prompt ${prompt.length} chars>` : value
        )),
        env: loggedEnv,
        prompt,
        promptMetrics,
        context,
      });
    }

    const proc = await runAdapterExecutionTargetProcess(runId, runtimeExecutionTarget, command, args, {
      cwd,
      env,
      timeoutSec,
      graceSec,
      onSpawn,
      onLog,
    });
    const parsed = parseKimiJsonl(proc.stdout);
    const parsedError = typeof parsed.errorMessage === "string" ? parsed.errorMessage.trim() : "";
    const stderrLine = firstNonEmptyLine(proc.stderr);
    const failed = (proc.exitCode ?? 0) !== 0 || parsedError.length > 0;
    const fallbackErrorMessage =
      parsedError ||
      stderrLine ||
      `Kimi exited with code ${proc.exitCode ?? -1}`;
    const authRequired = detectKimiAuthRequired(proc.stdout, proc.stderr, parsedError);
    const resolvedSessionParams = {
      sessionId,
      cwd: effectiveExecutionCwd,
      ...(workspaceId ? { workspaceId } : {}),
      ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
      ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
      ...(executionTargetIsRemote
        ? {
            remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
          }
        : {}),
    } as Record<string, unknown>;

    if (proc.timedOut) {
      return {
        exitCode: proc.exitCode,
        signal: proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        errorCode: authRequired ? "kimi_auth_required" : null,
        sessionId,
        sessionParams: resolvedSessionParams,
        sessionDisplayId: sessionId,
        provider: "kimi",
        biller: "kimi",
        model,
        billingType,
      };
    }

    return {
      exitCode: proc.exitCode,
      signal: proc.signal,
      timedOut: false,
      errorMessage: failed ? fallbackErrorMessage : null,
      errorCode: failed && authRequired ? "kimi_auth_required" : null,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
      },
      sessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: sessionId,
      provider: "kimi",
      biller: "kimi",
      model,
      billingType,
      costUsd: null,
      resultJson: {
        assistantMessageCount: parsed.assistantMessageCount,
        toolCallCount: parsed.toolCallCount,
        toolResultCount: parsed.toolResultCount,
        ...(failed ? { stderr: proc.stderr, nonJsonLines: parsed.nonJsonLines } : {}),
      },
      summary: parsed.summary,
    };
  } finally {
    await Promise.allSettled([
      paperclipBridge?.stop(),
      restoreRemoteWorkspace?.(),
      stagedSkills ? fs.rm(stagedSkills.root, { recursive: true, force: true }) : Promise.resolve(),
    ]);
  }
}
