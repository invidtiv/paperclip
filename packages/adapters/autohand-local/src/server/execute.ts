import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { buildSshSpawnTarget } from "@paperclipai/adapter-utils/ssh";
import { inferOpenAiCompatibleBiller, type AdapterExecutionContext, type AdapterExecutionResult } from "@paperclipai/adapter-utils";
import {
  adapterExecutionTargetIsRemote,
  adapterExecutionTargetRemoteCwd,
  overrideAdapterExecutionTargetRemoteCwd,
  adapterExecutionTargetSessionIdentity,
  adapterExecutionTargetSessionMatches,
  adapterExecutionTargetUsesManagedHome,
  adapterExecutionTargetUsesPaperclipBridge,
  describeAdapterExecutionTarget,
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetRuntimeCommandInstalled,
  prepareAdapterExecutionTargetRuntime,
  readAdapterExecutionTarget,
  readAdapterExecutionTargetHomeDir,
  resolveAdapterExecutionTargetTimeoutSec,
  resolveAdapterExecutionTargetCommandForLogs,
  runAdapterExecutionTargetProcess,
  runAdapterExecutionTargetShellCommand,
  startAdapterExecutionTargetPaperclipBridge,
} from "@paperclipai/adapter-utils/execution-target";
import {
  asBoolean,
  asNumber,
  asString,
  asStringArray,
  buildPaperclipEnv,
  buildInvocationEnvForLogs,
  ensureAbsoluteDirectory,
  ensurePaperclipSkillSymlink,
  joinPromptSections,
  ensurePathInEnv,
  refreshPaperclipWorkspaceEnvForExecution,
  readPaperclipRuntimeSkillEntries,
  readPaperclipIssueWorkModeFromContext,
  resolvePaperclipDesiredSkillNames,
  removeMaintainerOnlySkillSymlinks,
  parseObject,
  renderTemplate,
  renderPaperclipWakePrompt,
  stringifyPaperclipWakePayload,
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
} from "@paperclipai/adapter-utils/server-utils";
import { DEFAULT_AUTOHAND_LOCAL_MODEL, SANDBOX_INSTALL_COMMAND } from "../index.js";
import {
  describeAutohandFailure,
  isAutohandUnknownSessionError,
  parseAutohandJsonl,
} from "./parse.js";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

function firstNonEmptyLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0] ?? "";
}

function readStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }
  if (typeof value !== "string") return [];
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

async function pathIsDirectory(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function resolveLocalAutohandAddDirs(input: {
  cwd: string;
  config: Record<string, unknown>;
  instructionsFilePath: string;
  workspaceHints: Record<string, unknown>[];
}): Promise<string[]> {
  const candidates = [
    ...(input.instructionsFilePath ? [path.dirname(input.instructionsFilePath)] : []),
    ...input.workspaceHints.flatMap((hint) => [
      asString(hint.cwd, ""),
      asString(hint.worktreePath, ""),
      asString(hint.baseCwd, ""),
    ]),
    ...readStringList(input.config.additionalDirectories),
    ...readStringList(input.config.allowedDirectories),
    ...readStringList(input.config.addDirs),
    ...readStringList(input.config.addDir),
  ];

  const cwd = path.resolve(input.cwd);
  const seen = new Set<string>();
  const resolved: string[] = [];
  for (const candidate of candidates) {
    const absolute = path.resolve(input.cwd, candidate);
    if (absolute === cwd || seen.has(absolute)) continue;
    seen.add(absolute);
    if (await pathIsDirectory(absolute)) {
      resolved.push(absolute);
    }
  }
  return resolved;
}

function hasNonEmptyEnvValue(env: Record<string, string>, key: string): boolean {
  const raw = env[key];
  return typeof raw === "string" && raw.trim().length > 0;
}

function resolveAutohandBillingType(env: Record<string, string>): "metered_api" | "subscription_included" {
  return hasNonEmptyEnvValue(env, "AUTOHAND_API_KEY") ||
      hasNonEmptyEnvValue(env, "OPENROUTER_API_KEY") ||
      hasNonEmptyEnvValue(env, "OPENAI_API_KEY")
    ? "metered_api"
    : "subscription_included";
}

function resolveAutohandBiller(
  env: Record<string, string>,
  billingType: "metered_api" | "subscription_included",
): string {
  if (billingType === "subscription_included") return "autohand";
  return inferOpenAiCompatibleBiller(env, "autohand") ?? "autohand";
}

function autohandSkillsHome(): string {
  return path.join(os.homedir(), ".autohand", "skills");
}

async function ensureAutohandSkillsInjected(
  onLog: AdapterExecutionContext["onLog"],
  skillsEntries: Array<{ key: string; runtimeName: string; source: string }>,
  desiredSkillNames?: string[],
): Promise<void> {
  const desiredSet = new Set(desiredSkillNames ?? skillsEntries.map((entry) => entry.key));
  const selectedEntries = skillsEntries.filter((entry) => desiredSet.has(entry.key));
  if (selectedEntries.length === 0) return;

  const skillsHome = autohandSkillsHome();
  try {
    await fs.mkdir(skillsHome, { recursive: true });
  } catch (err) {
    await onLog(
      "stderr",
      `[paperclip] Failed to prepare Autohand skills directory ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    return;
  }
  const removedSkills = await removeMaintainerOnlySkillSymlinks(
    skillsHome,
    selectedEntries.map((entry) => entry.runtimeName),
  );
  for (const skillName of removedSkills) {
    await onLog(
      "stderr",
      `[paperclip] Removed maintainer-only Autohand skill "${skillName}" from ${skillsHome}\n`,
    );
  }

  for (const entry of selectedEntries) {
    const target = path.join(skillsHome, entry.runtimeName);

    try {
      const result = await ensurePaperclipSkillSymlink(entry.source, target);
      if (result === "skipped") continue;
      await onLog(
        "stderr",
        `[paperclip] ${result === "repaired" ? "Repaired" : "Linked"} Autohand skill: ${entry.key}\n`,
      );
    } catch (err) {
      await onLog(
        "stderr",
        `[paperclip] Failed to link Autohand skill "${entry.key}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

async function buildAutohandSkillsDir(
  config: Record<string, unknown>,
): Promise<string> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-autohand-skills-"));
  const target = path.join(tmp, "skills");
  await fs.mkdir(target, { recursive: true });
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredNames = new Set(resolvePaperclipDesiredSkillNames(config, availableEntries));
  for (const entry of availableEntries) {
    if (!desiredNames.has(entry.key)) continue;
    await fs.symlink(entry.source, path.join(target, entry.runtimeName));
  }
  return target;
}

class AcpClient {
  private child: any;
  private rl: readline.Interface;
  private pendingRequests = new Map<string, { resolve: (res: any) => void; reject: (err: Error) => void }>();
  private onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>;
  private eventHandlers = new Map<string, (data: any) => void>();
  public stdoutLines: string[] = [];
  public stderrLines: string[] = [];

  constructor(child: any, onLog: (stream: "stdout" | "stderr", chunk: string) => Promise<void>) {
    this.child = child;
    this.onLog = onLog;
    this.rl = readline.createInterface({ input: child.stdout });

    this.rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;

      this.stdoutLines.push(line);
      void this.onLog("stdout", line + "\n");

      let parsed: any;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return;
      }

      const method = parsed.method;
      if (method !== undefined) {
        const pending = this.pendingRequests.get(method);
        if (pending) {
          if (parsed.error) {
            pending.reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
            this.pendingRequests.delete(method);
          } else if (method !== "prompt") {
            pending.resolve(parsed.result);
            this.pendingRequests.delete(method);
          }
        }
      } else if (parsed.event !== undefined) {
        const handler = this.eventHandlers.get(parsed.event);
        if (handler) {
          handler(parsed.data);
        }
      }
    });

    child.stderr?.on("data", (chunk: any) => {
      const text = chunk.toString();
      this.stderrLines.push(text);
      void this.onLog("stderr", text);
    });

    child.on("exit", (code: number | null, signal: string | null) => {
      for (const [method, pending] of this.pendingRequests.entries()) {
        pending.reject(new Error(`Process exited with code ${code} and signal ${signal}`));
        this.pendingRequests.delete(method);
      }
    });

    child.on("error", (err: Error) => {
      for (const [method, pending] of this.pendingRequests.entries()) {
        pending.reject(err);
        this.pendingRequests.delete(method);
      }
    });
  }

  send(method: string, params: any = {}): Promise<any> {
    const payload = JSON.stringify({ method, params }) + "\n";
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(method, { resolve, reject });
      this.child.stdin.write(payload);
    });
  }

  resolvePrompt() {
    const pending = this.pendingRequests.get("prompt");
    if (pending) {
      pending.resolve(null);
      this.pendingRequests.delete("prompt");
    }
  }

  rejectPrompt(err: Error) {
    const pending = this.pendingRequests.get("prompt");
    if (pending) {
      pending.reject(err);
      this.pendingRequests.delete("prompt");
    }
  }

  onEvent(event: string, handler: (data: any) => void) {
    this.eventHandlers.set(event, handler);
  }
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, runtime, config, context, onLog, onMeta, onSpawn, authToken } = ctx;
  let promptFilePath: string | null = null;
  const executionTarget = readAdapterExecutionTarget({
    executionTarget: ctx.executionTarget,
    legacyRemoteExecution: ctx.executionTransport?.remoteExecution,
  });
  const executionTargetIsRemote = adapterExecutionTargetIsRemote(executionTarget);

  const promptTemplate = asString(
    config.promptTemplate,
    DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  );
  const command = asString(config.command, "autohand");
  const model = asString(config.model, DEFAULT_AUTOHAND_LOCAL_MODEL).trim();
  const yes = config.yes !== false;
  const thinking = !!config.thinking;
  const restricted = !!config.restricted;
  const dryRun = !!config.dryRun;

  const workspaceContext = parseObject(context.paperclipWorkspace);
  const workspaceCwd = asString(workspaceContext.cwd, "");
  const workspaceSource = asString(workspaceContext.source, "");
  const workspaceId = asString(workspaceContext.workspaceId, "");
  const workspaceRepoUrl = asString(workspaceContext.repoUrl, "");
  const workspaceRepoRef = asString(workspaceContext.repoRef, "");
  const agentHome = asString(workspaceContext.agentHome, "");
  const workspaceHints = Array.isArray(context.paperclipWorkspaces)
    ? context.paperclipWorkspaces.filter(
      (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null,
    )
    : [];
  const configuredCwd = asString(config.cwd, "");
  const useConfiguredInsteadOfAgentHome = workspaceSource === "agent_home" && configuredCwd.length > 0;
  const effectiveWorkspaceCwd = useConfiguredInsteadOfAgentHome ? "" : workspaceCwd;
  const cwd = effectiveWorkspaceCwd || configuredCwd || process.cwd();
  let effectiveExecutionCwd = adapterExecutionTargetRemoteCwd(executionTarget, cwd);
  await ensureAbsoluteDirectory(cwd, { createIfMissing: true });

  const autohandSkillEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredAutohandSkillNames = resolvePaperclipDesiredSkillNames(config, autohandSkillEntries);
  if (!executionTargetIsRemote) {
    await ensureAutohandSkillsInjected(onLog, autohandSkillEntries, desiredAutohandSkillNames);
  }

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
    ? context.issueIds.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0)
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
  const effectiveEnv = Object.fromEntries(
    Object.entries({ ...process.env, ...env }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
  const billingType = resolveAutohandBillingType(effectiveEnv);
  const biller = resolveAutohandBiller(effectiveEnv, billingType);
  const runtimeEnv = Object.fromEntries(
    Object.entries(ensurePathInEnv(effectiveEnv)).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  const timeoutSec = resolveAdapterExecutionTargetTimeoutSec(
    executionTarget,
    asNumber(config.timeoutSec, 0),
  );
  const graceSec = asNumber(config.graceSec, 20);

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
    installCommand: SANDBOX_INSTALL_COMMAND,
    timeoutSec,
  });

  const resolvedCommand = await resolveAdapterExecutionTargetCommandForLogs(command, executionTarget, cwd, runtimeEnv);
  let loggedEnv = buildInvocationEnvForLogs(env, {
    runtimeEnv,
    includeRuntimeKeys: ["HOME"],
    resolvedCommand,
  });

  const extraArgs = (() => {
    const fromExtraArgs = asStringArray(config.extraArgs);
    if (fromExtraArgs.length > 0) return fromExtraArgs;
    return asStringArray(config.args);
  })();

  const instructionsFilePath = asString(config.instructionsFilePath, "").trim();
  const instructionsDir = instructionsFilePath ? `${path.dirname(instructionsFilePath)}/` : "";
  let instructionsPrefix = "";
  if (instructionsFilePath) {
    try {
      const instructionsContents = await fs.readFile(instructionsFilePath, "utf8");
      instructionsPrefix =
        `${instructionsContents}\n\n` +
        `The above agent instructions were loaded from ${instructionsFilePath}. ` +
        `Resolve any relative file references from ${instructionsDir}.\n\n`;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await onLog(
        "stdout",
        `[paperclip] Warning: could not read agent instructions file "${instructionsFilePath}": ${reason}\n`,
      );
    }
  }
  const autohandAddDirs = executionTargetIsRemote
    ? []
    : await resolveLocalAutohandAddDirs({
      cwd,
      config,
      instructionsFilePath,
      workspaceHints,
    });

  const commandNotes: string[] = ["Runs use the Agent Communication Protocol (ACP) over stdin/stdout."];
  if (autohandAddDirs.length > 0) {
    commandNotes.push(`Granted Autohand access to ${autohandAddDirs.length} additional local director${autohandAddDirs.length === 1 ? "y" : "ies"} with --add-dir.`);
  }
  if (yes) {
    commandNotes.push("Added --yes for unattended execution.");
  }
  if (thinking) {
    commandNotes.push("Added --thinking for deep reasoning.");
  }
  if (restricted) {
    commandNotes.push("Added --restricted for read-only safety.");
  }
  if (dryRun) {
    commandNotes.push("Added --dry-run.");
  }

  const templateData = {
    agentId: agent.id,
    companyId: agent.companyId,
    runId,
    company: { id: agent.companyId },
    agent,
    run: { id: runId, source: "on_demand" },
    context,
  };
  const renderedPrompt = renderTemplate(promptTemplate, templateData);
  const sessionHandoffNote = asString(context.paperclipSessionHandoffMarkdown, "").trim();
  const prompt = joinPromptSections([
    instructionsPrefix,
    renderPaperclipWakePrompt(context.paperclipWake, { resumedSession: false }),
    sessionHandoffNote,
    renderedPrompt,
  ]);

  const promptMetrics = {
    promptChars: prompt.length,
    instructionsChars: instructionsPrefix.length,
    bootstrapPromptChars: 0,
    wakePromptChars: 0,
    sessionHandoffChars: sessionHandoffNote.length,
    runtimeNoteChars: 0,
    heartbeatPromptChars: renderedPrompt.length,
  };

  let restoreRemoteWorkspace: (() => Promise<void>) | null = null;
  let remoteSkillsDir: string | null = null;
  let localSkillsDir: string | null = null;
  let remoteRuntimeRootDir: string | null = null;
  let paperclipBridge: Awaited<ReturnType<typeof startAdapterExecutionTargetPaperclipBridge>> = null;

  if (executionTargetIsRemote) {
    try {
      localSkillsDir = await buildAutohandSkillsDir(config);
      await onLog(
        "stdout",
        `[paperclip] Syncing workspace and Autohand runtime assets to ${describeAdapterExecutionTarget(executionTarget)}.\n`,
      );
      const preparedExecutionTargetRuntime = await prepareAdapterExecutionTargetRuntime({
        runId,
        target: executionTarget,
        adapterKey: "autohand",
        timeoutSec,
        workspaceLocalDir: cwd,
        installCommand: SANDBOX_INSTALL_COMMAND,
        detectCommand: command,
        assets: [{
          key: "skills",
          localDir: localSkillsDir,
          followSymlinks: true,
        }],
      });
      restoreRemoteWorkspace = () => preparedExecutionTargetRuntime.restoreWorkspace();
      effectiveExecutionCwd = preparedExecutionTargetRuntime.workspaceRemoteDir ?? effectiveExecutionCwd;

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

      remoteRuntimeRootDir = preparedExecutionTargetRuntime.runtimeRootDir;
      const managedHome = adapterExecutionTargetUsesManagedHome(executionTarget);
      if (managedHome && preparedExecutionTargetRuntime.runtimeRootDir) {
        env.HOME = preparedExecutionTargetRuntime.runtimeRootDir;
      }
      const remoteHomeDir = managedHome && preparedExecutionTargetRuntime.runtimeRootDir
        ? preparedExecutionTargetRuntime.runtimeRootDir
        : await readAdapterExecutionTargetHomeDir(runId, executionTarget, {
            cwd,
            env,
            timeoutSec,
            graceSec,
            onLog,
          });
      if (remoteHomeDir && preparedExecutionTargetRuntime.assetDirs.skills) {
        remoteSkillsDir = path.posix.join(remoteHomeDir, ".autohand", "skills");
        await runAdapterExecutionTargetShellCommand(
          runId,
          executionTarget,
          `mkdir -p ${JSON.stringify(path.posix.dirname(remoteSkillsDir))} && rm -rf ${JSON.stringify(remoteSkillsDir)} && cp -a ${JSON.stringify(preparedExecutionTargetRuntime.assetDirs.skills)} ${JSON.stringify(remoteSkillsDir)}`,
          { cwd, env, timeoutSec, graceSec, onLog },
        );
      }
    } catch (error) {
      await Promise.allSettled([
        restoreRemoteWorkspace?.(),
        localSkillsDir ? fs.rm(path.dirname(localSkillsDir), { recursive: true, force: true }).catch(() => undefined) : Promise.resolve(),
      ]);
      throw error;
    }
  }

  const runtimeExecutionTarget = overrideAdapterExecutionTargetRemoteCwd(executionTarget, effectiveExecutionCwd);
  if (executionTargetIsRemote && adapterExecutionTargetUsesPaperclipBridge(executionTarget)) {
    paperclipBridge = await startAdapterExecutionTargetPaperclipBridge({
      runId,
      target: runtimeExecutionTarget,
      runtimeRootDir: remoteRuntimeRootDir,
      adapterKey: "autohand",
      timeoutSec,
      hostApiToken: env.PAPERCLIP_API_KEY,
      onLog,
    });
    if (paperclipBridge) {
      Object.assign(env, paperclipBridge.env);
      loggedEnv = buildInvocationEnvForLogs(env, {
        runtimeEnv: ensurePathInEnv({ ...process.env, ...env }),
        includeRuntimeKeys: ["HOME"],
        resolvedCommand,
      });
    }
  }

  const runtimeSessionParams = parseObject(runtime.sessionParams);
  const runtimeSessionId = asString(runtimeSessionParams.sessionId, runtime.sessionId ?? "");
  const sessionId = runtimeSessionId || null;

  const buildArgs = () => {
    const args = ["--acp"];
    if (model && model !== DEFAULT_AUTOHAND_LOCAL_MODEL) {
      args.push("--model", model);
    }
    if (yes) {
      args.push("--yes");
    }
    if (thinking) {
      args.push("--thinking");
    }
    if (restricted) {
      args.push("--restricted");
    }
    if (dryRun) {
      args.push("--dry-run");
    }
    for (const dir of autohandAddDirs) {
      args.push("--add-dir", dir);
    }
    if (extraArgs.length > 0) {
      args.push(...extraArgs);
    }
    return args;
  };

  const runAttempt = async (resumeSessionId: string | null) => {
    const args = buildArgs();
    if (onMeta) {
      await onMeta({
        adapterType: "autohand_local",
        command: resolvedCommand,
        cwd: effectiveExecutionCwd,
        commandNotes,
        commandArgs: args,
        env: loggedEnv,
        prompt,
        promptMetrics,
        context,
      });
    }

    let spawnCmd = command;
    let spawnArgs = args;
    let sshCleanup: (() => Promise<void>) | null = null;

    if (executionTargetIsRemote) {
      if (executionTarget?.kind === "remote" && executionTarget.transport === "ssh") {
        const target = await buildSshSpawnTarget({
          spec: executionTarget.spec,
          command,
          args,
          env,
        });
        spawnCmd = target.command;
        spawnArgs = target.args;
        sshCleanup = target.cleanup;
      } else {
        throw new Error("Interactive ACP mode is not supported on the sandbox remote target.");
      }
    }

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: executionTargetIsRemote ? undefined : cwd,
      env: executionTargetIsRemote ? process.env : runtimeEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const client = new AcpClient(child, onLog);

    if (onSpawn && child.pid) {
      await onSpawn({ pid: child.pid, processGroupId: null, startedAt: new Date().toISOString() });
    }

    let timedOut = false;
    const timeoutTimer = timeoutSec > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        child.kill("SIGKILL");
      }, graceSec * 1000);
    }, timeoutSec * 1000) : null;

    let promptCompleted = false;
    let promptError: Error | null = null;

    try {
      // 1. Initialize
      await client.send("initialize", { clientInfo: { name: "paperclip", version: "1.0.0" } });

      // 2. Authenticate
      const token = runtimeEnv.AUTOHAND_TOKEN || runtimeEnv.AUTOHAND_API_KEY || runtimeEnv.OPENROUTER_API_KEY || runtimeEnv.OPENAI_API_KEY || "";
      await client.send("authenticate", { token });

      // 3. Session selection
      let activeSessionId = "";
      let resumed = false;
      if (resumeSessionId) {
        try {
          const res = await client.send("resumeSession", { sessionId: resumeSessionId });
          if (res && (res.restored || res.sessionId === resumeSessionId)) {
            activeSessionId = resumeSessionId;
            resumed = true;
            await onLog("stdout", `[paperclip] Resumed Autohand session "${activeSessionId}"\n`);
          }
        } catch (err) {
          const errText = err instanceof Error ? err.message : String(err);
          await onLog("stdout", `[paperclip] Autohand resume session "${resumeSessionId}" failed: ${errText}. Creating a new session.\n`);
        }
      }

      if (!resumed) {
        const res = await client.send("newSession", {
          workingDirectory: cwd,
          model: model === "auto" ? undefined : model,
          mode: restricted ? "restricted" : "unrestricted",
        });
        activeSessionId = res.sessionId;
        await onLog("stdout", `[paperclip] Created new Autohand session "${activeSessionId}"\n`);
      }

      // 4. Send prompt and wait for events
      client.onEvent("promptComplete", () => {
        client.resolvePrompt();
        promptCompleted = true;
      });

      await client.send("prompt", {
        sessionId: activeSessionId,
        message: prompt,
      });

      // Wait for promptComplete
      const deadline = Date.now() + (timeoutSec > 0 ? timeoutSec * 1000 : 3600 * 1000);
      while (!promptCompleted && !promptError && !timedOut && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      if (!promptCompleted && !promptError && !timedOut) {
        promptError = new Error(`Timed out waiting for prompt completion after ${timeoutSec}s`);
      }
    } catch (err) {
      promptError = err as Error;
    } finally {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      child.kill("SIGTERM");
      if (sshCleanup) {
        await sshCleanup().catch(() => undefined);
      }
    }

    // Wait for exit
    const exitCode: number | null = await new Promise((resolve) => {
      if (child.exitCode !== null) {
        resolve(child.exitCode);
      } else {
        child.on("exit", (code) => resolve(code));
      }
    });

    const finalStdout = client.stdoutLines.join("\n");
    const finalStderr = client.stderrLines.join("\n");

    const parsed = parseAutohandJsonl(finalStdout);
    if (promptError && !parsed.errorMessage) {
      parsed.errorMessage = promptError.message;
    }

    return {
      proc: {
        exitCode,
        signal: child.signalCode,
        timedOut,
        stdout: finalStdout,
        stderr: finalStderr,
      },
      parsed,
    };
  };

  const toResult = (
    attempt: {
      proc: {
        exitCode: number | null;
        signal: string | null;
        timedOut: boolean;
        stdout: string;
        stderr: string;
      };
      parsed: ReturnType<typeof parseAutohandJsonl>;
    },
    clearSessionOnMissingSession = false,
    isRetry = false,
  ): AdapterExecutionResult => {
    if (attempt.proc.timedOut) {
      return {
        exitCode: attempt.proc.exitCode,
        signal: attempt.proc.signal,
        timedOut: true,
        errorMessage: `Timed out after ${timeoutSec}s`,
        clearSession: clearSessionOnMissingSession,
      };
    }

    const parsedError = typeof attempt.parsed.errorMessage === "string" ? attempt.parsed.errorMessage.trim() : "";
    const stderrLine = firstNonEmptyLine(attempt.proc.stderr);
    const structuredFailure = attempt.parsed.resultEvent
      ? describeAutohandFailure(attempt.parsed.resultEvent)
      : null;
    const fallbackErrorMessage =
      parsedError ||
      structuredFailure ||
      stderrLine ||
      `Autohand exited with code ${attempt.proc.exitCode ?? -1}`;
    const failed = (attempt.proc.exitCode ?? 0) !== 0;

    const canFallbackToRuntimeSession = !isRetry;
    const resolvedSessionId = attempt.parsed.sessionId
      ?? (canFallbackToRuntimeSession ? (runtimeSessionId ?? runtime.sessionId ?? null) : null);
    const resolvedSessionParams = resolvedSessionId
      ? ({
        sessionId: resolvedSessionId,
        cwd: effectiveExecutionCwd,
        ...(workspaceId ? { workspaceId } : {}),
        ...(workspaceRepoUrl ? { repoUrl: workspaceRepoUrl } : {}),
        ...(workspaceRepoRef ? { repoRef: workspaceRepoRef } : {}),
        ...(executionTargetIsRemote
          ? {
              remoteExecution: adapterExecutionTargetSessionIdentity(runtimeExecutionTarget),
            }
          : {}),
      } as Record<string, unknown>)
      : null;

    const resultJson: Record<string, unknown> = {
      ...(attempt.parsed.resultEvent ?? {
        stdout: attempt.proc.stdout,
        stderr: attempt.proc.stderr,
      }),
    };

    return {
      exitCode: attempt.proc.exitCode,
      signal: attempt.proc.signal,
      timedOut: false,
      errorMessage: failed ? fallbackErrorMessage : null,
      usage: attempt.parsed.usage,
      sessionId: resolvedSessionId,
      sessionParams: resolvedSessionParams,
      sessionDisplayId: resolvedSessionId,
      provider: "autohand",
      biller,
      model,
      billingType,
      costUsd: attempt.parsed.costUsd,
      resultJson,
      summary: attempt.parsed.summary,
      clearSession: Boolean(clearSessionOnMissingSession && !resolvedSessionId),
    };
  };

  try {
    const initial = await runAttempt(sessionId);
    if (
      sessionId &&
      !initial.proc.timedOut &&
      (initial.proc.exitCode ?? 0) !== 0 &&
      isAutohandUnknownSessionError(initial.proc.stdout, initial.proc.stderr)
    ) {
      await onLog(
        "stdout",
        `[paperclip] Autohand resume session "${sessionId}" is unavailable; retrying with a fresh session.\n`,
      );
      const retry = await runAttempt(null);
      return toResult(retry, true, true);
    }

    return toResult(initial);
  } finally {
    await Promise.all([
      paperclipBridge?.stop(),
      restoreRemoteWorkspace?.(),
      localSkillsDir ? fs.rm(path.dirname(localSkillsDir), { recursive: true, force: true }).catch(() => undefined) : Promise.resolve(),
    ]);
  }
}
