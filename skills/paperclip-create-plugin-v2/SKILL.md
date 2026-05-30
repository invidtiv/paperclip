---
name: paperclip-create-plugin-v2
description: >
  Create, scaffold, develop, install, inspect, and document Paperclip plugins
  and external adapter plugins. Use when building plugin packages with
  `paperclipai plugin init`, working through local-path or npm plugin install
  loops, creating adapter plugins with `@paperclipai/adapter-utils`, adding
  plugin-managed skills/agents/issue workflows, or updating plugin authoring
  docs. Do not use for ordinary Paperclip app features unless they touch the
  plugin, adapter, or agent-extension systems.
---

# Create and develop a Paperclip plugin

Use this skill when the task is to create, scaffold, install, or iterate on a
Paperclip extension package.

## 1. Load only the docs you need

Prefer current local docs under the Paperclip checkout:

- Plugin SDK surface: `packages/plugins/sdk/README.md`
- CLI setup, context, and control-plane commands: `docs/cli/overview.md`,
  `docs/cli/setup-commands.md`, `docs/cli/control-plane-commands.md`
- Plugin lifecycle CLI: `cli/src/commands/client/plugin.ts`
- Agent behavior contracts: `docs/guides/agent-developer/*.md`
- Adapter plugins: `docs/adapters/overview.md`, `docs/adapters/external-adapters.md`,
  `docs/adapters/creating-an-adapter.md`, `docs/adapters/adapter-ui-parser.md`
  plus `docs/adapters/process.md` or `docs/adapters/http.md` for simple
  runtime/webhook choices

Read the specific section for the job instead of loading all docs. If docs and
code disagree, check the current CLI/server code before editing.

## 2. Pick the right artifact and edit boundary

- **Normal Paperclip plugin:** use `paperclipai plugin init`; edit the generated
  package (`src/manifest.ts`, `src/worker.ts`, optional `src/ui/*`).
- **External adapter plugin:** build a separate npm/local package that exports a
  `createServerAdapter()` factory and optional `ui-parser`; do not edit
  `packages/adapters/*` unless the user explicitly wants a built-in adapter.
- **Bundled example plugin or core runtime change:** only modify Paperclip core
  when explicitly asked. Expect updates to example lists, server routes, docs,
  registries, and workspace checks.

Default to building plugin packages outside Paperclip core. Local-path installs
are the development path; npm packages are the deployment path.

## 3. Target the Paperclip instance deliberately

Use the installed `paperclipai` CLI, or `pnpm paperclipai` from the Paperclip
checkout. Most commands accept:

```bash
--api-base <url>
--api-key <token>
--company-id <id>
--context <path>
--profile <name>
--data-dir <path>
--json
```

For repeat work, set a context profile:

```bash
paperclipai context set --api-base http://localhost:3100 --company-id <id>
paperclipai context show
paperclipai context use default
```

Avoid storing secrets in context when possible:

```bash
paperclipai context set --api-key-env-var-name PAPERCLIP_API_KEY
export PAPERCLIP_API_KEY=...
```

For a clean local instance:

```bash
pnpm paperclipai run --data-dir ./tmp/paperclip-dev
pnpm paperclipai doctor --data-dir ./tmp/paperclip-dev --repair
```

## 4. Normal plugin scaffold workflow

Use the CLI wrapper, not the scaffold package entrypoint, unless the CLI command
is unavailable.

```bash
paperclipai plugin init @acme/my-plugin --output ~/dev/paperclip-plugins
```

Templates: `default`, `connector`, `workspace`, `environment`.  
Categories: `connector`, `workspace`, `automation`, `ui`, `environment`.

Useful optional flags:

- `--output <dir>`: parent directory; creates `<dir>/<unscoped-name>/`.
- `--template <default|connector|workspace|environment>`.
- `--category <connector|workspace|automation|ui|environment>`.
- `--display-name <name>`, `--description <text>`, `--author <name>`.
- `--sdk-path <path>`: local `@paperclipai/plugin-sdk` source path.

Generated files (all templates):

- `src/manifest.ts` — typed manifest with capabilities, entrypoints, UI slots.
- `src/worker.ts` — `definePlugin(...)` with `setup`, `onHealth`, and template-specific hooks.
- `src/ui/index.tsx` — optional UI widget using `@paperclipai/plugin-sdk/ui` hooks.
- `tests/plugin.spec.ts` — starter tests using `@paperclipai/plugin-sdk/testing`.
- `esbuild.config.mjs` + `rollup.config.mjs` — SDK bundler presets.
- `vitest.config.ts` — test runner config.
- `tsconfig.json` — `NodeNext` module resolution, React JSX.
- `package.json` — `paperclipPlugin` block pointing at built `dist/` files.

Template-specific scaffolds:

- **`default`** / **`connector`** — `events.subscribe`, `plugin.state.*`, `ui.dashboardWidget`, plus demo `data`/`actions`/`events` handlers.
- **`workspace`** — same as default with `workspace` category pre-selected.
- **`environment`** — full environment-driver lifecycle: `onEnvironmentValidateConfig`, `onEnvironmentProbe`, `onEnvironmentAcquireLease`, `onEnvironmentResumeLease`, `onEnvironmentReleaseLease`, `onEnvironmentDestroyLease`, `onEnvironmentRealizeWorkspace`, `onEnvironmentExecute`, plus `environment.drivers.register` capability.

Run the printed next commands in order:

```bash
cd /absolute/path/to/my-plugin
pnpm install
pnpm dev       # watch worker + manifest + ui bundles
paperclipai plugin install /absolute/path/to/my-plugin
```

Optional UI dev server (when the template wires `devUiUrl` end to end):

```bash
pnpm dev:ui    # local UI preview server with hot-reload events
```

Fallback only when `paperclipai plugin init` is unavailable:

```bash
pnpm --filter @paperclipai/create-paperclip-plugin build
node packages/plugins/create-paperclip-plugin/dist/index.js @acme/my-plugin \
  --output /absolute/path \
  --sdk-path /absolute/path/to/paperclip/packages/plugins/sdk
```

When scaffolding **outside** the Paperclip repo, the tool snapshots
`@paperclipai/plugin-sdk` and `@paperclipai/shared` into `.paperclip-sdk/`
tarballs and points the generated `package.json` at them. Switch to published
npm versions before shipping.

## 5. Plugin install and reload loop

Local install:

```bash
paperclipai plugin install /absolute/path/to/my-plugin
paperclipai plugin list
paperclipai plugin inspect <plugin-key>
```

Lifecycle commands:

```bash
paperclipai plugin examples
paperclipai plugin enable <plugin-key-or-id>
paperclipai plugin disable <plugin-key-or-id>
paperclipai plugin uninstall <plugin-key-or-id> [--force]
```

Rules:

- `plugin install` auto-detects absolute paths, `./`, `../`, `~`, and existing
  relative folders as local installs. Use `--local` if detection is ambiguous.
- Local paths are resolved to absolute paths before being sent to the server.
- `--version` applies only to npm package installs; using it with a local path is
  an error.
- Local plugin installs run trusted local code. Keep `pnpm dev` running; the
  host watches rebuilt `dist/` output and reloads the worker.
- UI hot reload via `pnpm dev:ui` / `paperclip-plugin-dev-server` is optional
  and only valid when the scaffold/template wires `devUiUrl` end to end.
- If `list` or `inspect` shows status other than `ready`, include `lastError`
  in the report and fix from there.

## 6. Normal plugin implementation checklist

After scaffolding, inspect:

- `package.json`: `paperclipPlugin` points at built `dist/manifest.js`,
  `dist/worker.js`, and optional `dist/ui/`.
- `src/manifest.ts`: entrypoints, category, capabilities, UI slots, jobs,
  webhooks, API routes, local folders, database namespace, and any `instanceConfigSchema`.
- `src/worker.ts`: `definePlugin(...)`; call `runWorker(plugin,
  import.meta.url)` in the worker entry.
- `src/ui/index.tsx`: only if the plugin declares UI.
- `tests/plugin.spec.ts`: update from placeholder to focused behavior tests.

Runtime facts to preserve:

- Plugin workers and plugin UI are trusted code in the current runtime.
- Plugin UI runs same-origin inside Paperclip; manifest capabilities are not a
  frontend sandbox.
- Worker-side host APIs are capability-gated. Declare only the capabilities the
  plugin uses.
- `ctx.assets` is not supported in this build.
- Use the shared `@paperclipai/plugin-sdk/ui` hooks/components when the plugin
  should feel native: `usePluginData`, `usePluginAction`, `usePluginStream`,
  `useHostContext`, `useHostNavigation`, `usePluginToast`, `MarkdownBlock`,
  `MarkdownEditor`, `FileTree`, `IssuesList`, `AssigneePicker`, `ProjectPicker`.
- Use `useHostNavigation().linkProps()` for Paperclip-internal links. External
  links should use normal anchors with `target="_blank"` and `rel="noopener noreferrer"`.
- Use `routePath` only on `page` slots.

Choose the narrowest UI surface:

- `page` or `routeSidebar` for full plugin workspaces.
- `settingsPage` / `companySettingsPage` for custom configuration flows.
- `dashboardWidget` for summary/status surfaces.
- `detailTab` / `taskDetailView` for project, issue, agent, goal, or run context.
- `projectSidebarItem`, `toolbarButton`, `globalToolbarButton`,
  `commentAnnotation`, `commentContextMenuItem`, `contextMenuItem` for contextual entry points.
- `launchers` (registered from the worker) for modal/overlay triggers.

Use host services instead of ad hoc bypasses:

- Filesystem access: declare `localFolders` and use `ctx.localFolders.*`.
- Orchestration: use `ctx.issues.*` for create/update/subtree/relation/wakeup
  work, and use plugin-origin fields in the plugin namespace.
- Real-time UI: emit worker SSE with `ctx.streams.*`; subscribe with
  `usePluginStream`.
- Agent chat: use `ctx.agents.sessions.*`; add the corresponding
  `agent.sessions.*` capabilities.
- Plugin-managed skills: `SKILL.md` frontmatter must include `name` and a
  routing-oriented `description`; keep the skill focused and move bulky support
  material into `references/`.
- Database: declare a plugin namespace and migrations; runtime writes must stay
  inside the plugin namespace.
- HTTP outbound: use `ctx.http.fetch` with the `http.outbound` capability.
- Secrets: use `ctx.secrets.resolve(ref)` with the `secrets.read-ref` capability.
- Metrics / telemetry: use `ctx.metrics.write` and `ctx.telemetry.track`.
- Activity logging: use `ctx.activity.log` for mutating actions.

### Instance configuration

If the plugin needs user-tunable settings, declare `instanceConfigSchema` in the
manifest (JSON Schema object) and implement hooks:

- `onValidateConfig(config)` — return `{ ok: boolean, errors?: string[], warnings?: string[] }`.
- `onConfigChanged(newConfig)` — react to settings updates at runtime.

In the UI, read config via the host API (`/api/plugins/${PLUGIN_ID}/config`)
or from worker `data` handlers that return the merged config.

### Database namespace plugins

For plugins that need their own tables:

```ts
// manifest.ts
database: {
  namespaceSlug: "my_plugin",
  migrationsDir: "migrations",
  coreReadTables: ["issues"], // optional cross-namespace reads
}
```

Required capabilities:

- `database.namespace.migrate`
- `database.namespace.read`
- `database.namespace.write`

Runtime usage:

```ts
ctx.db.query<RowType>(`SELECT * FROM ${ctx.db.namespace}.my_table WHERE ...`, [params]);
ctx.db.execute(`INSERT INTO ${ctx.db.namespace}.my_table ...`, [params]);
```

- Migrations run automatically on install.
- Tables live under the plugin namespace; you may `JOIN public.issues` when
  `coreReadTables` declares them.
- Never write to `public.*` tables directly.

### Plugin API routes

Declare scoped routes in the manifest:

```ts
apiRoutes: [
  {
    routeKey: "myAction",
    method: "POST",
    path: "/issues/:issueId/my-action",
    auth: "board-or-agent",
    capability: "api.routes.register",
    checkoutPolicy: "required-for-agent-in-progress", // optional
    companyResolution: { from: "issue", param: "issueId" },
  },
]
```

Implement `onApiRequest(input: PluginApiRequestInput)` in the worker:

```ts
async onApiRequest(input) {
  if (input.routeKey === "myAction") {
    return { status: 201, body: { ok: true } };
  }
  return { status: 404, body: { error: "Unknown route" } };
}
```

### Tools, jobs, webhooks, and launchers

- **Tools** — register in manifest `tools[]` and worker `ctx.tools.register(name, meta, handler)`.
  The handler receives `(params, runCtx)` and returns `ToolResult` (`{ content, data }` or `{ error }`).
- **Jobs** — register in manifest `jobs[]` with cron `schedule`, then handle in
  worker `ctx.jobs.register(jobKey, handler)`. The handler receives `PluginJobContext`.
- **Webhooks** — register in manifest `webhooks[]`, then implement `onWebhook(input)`.
- **Launchers** — register dynamically from the worker with `ctx.launchers.register({...})`.
  They define modal/open actions bound to UI `placementZone` + `entityTypes`.

### Worker lifecycle hooks

Beyond `setup` and `onHealth`, you can implement:

- `onConfigChanged(newConfig)` — react to instance settings updates.
- `onValidateConfig(config)` — validate instance settings.
- `onWebhook(input)` — handle incoming webhook deliveries.
- `onApiRequest(input)` — handle plugin-scoped API routes.
- `onShutdown()` — cleanup before worker exit.

## 7. Agent workflow contracts for plugin-managed work

When a plugin creates agents, skills, issues, or agent-facing workflows, keep the
agent-developer protocol intact:

- Agents work in heartbeats, not continuous loops. Adapters capture output,
  usage/cost, and session state.
- Injected runtime identity includes `PAPERCLIP_AGENT_ID`,
  `PAPERCLIP_COMPANY_ID`, `PAPERCLIP_API_URL`, `PAPERCLIP_API_KEY`, and
  `PAPERCLIP_RUN_ID`; task/comment/approval variables appear when relevant.
- Always checkout before an agent works an issue. Never retry a `409 Conflict`;
  pick different work.
- Include `X-Paperclip-Run-Id` on direct issue state mutations from a run.
- Leave durable comments for progress, blockers, handoffs, and completion.
- Use child issues with `parentId` and `goalId` for delegated work.
- Use `request_confirmation` issue interactions for issue-scoped yes/no or plan
  approvals; formal approvals are for governed board records.
- Let adapters handle cost reporting. Agent code should not duplicate adapter
  cost events unless explicitly implementing an adapter or custom runtime.

## 8. External adapter plugin workflow

For custom agent runtimes, prefer an external adapter plugin over a built-in
adapter. A minimal adapter package contains:

```text
my-adapter/
  package.json
  tsconfig.json
  src/
    index.ts
    server/
      index.ts
      execute.ts
      test.ts
    ui-parser.ts       # optional, but recommended for structured stdout
```

Required package shape:

- `exports["."]` points at a module exporting `createServerAdapter`.
- `exports["./server"]` points at the server adapter module.
- `exports["./ui-parser"]` points at the optional browser-safe parser.
- `paperclip.adapterUiParser` is `"1.0.0"` when shipping a parser.
- Depend on `@paperclipai/adapter-utils`.

Server implementation checklist:

- `src/index.ts` exports a globally unique snake_case `type`, `label`, optional
  `models`, `agentConfigurationDoc`, and `createServerAdapter`.
- `execute(ctx)` reads config with safe helpers, injects Paperclip env with
  `buildPaperclipEnv(agent)`, renders prompt templates with `renderTemplate`,
  spawns with `runChildProcess()` or calls an HTTP runtime, streams logs with
  `onLog`, and returns structured usage, cost, session, and error fields.
- If session resume fails because the runtime forgot the session, retry fresh
  when appropriate and return `clearSession: true`.
- `testEnvironment(ctx)` returns structured `pass`, `warn`, or `fail`
  diagnostics with `info`, `warn`, and `error` checks.
- Implement `sessionCodec` when the runtime supports conversation continuity.
- Set capability flags on `ServerAdapterModule` when supported:
  `supportsLocalAgentJwt`, `supportsInstructionsBundle`, `instructionsPathKey`,
  and `requiresMaterializedRuntimeSkills`.
- Implement `listSkills` / `syncSkills` when the runtime can consume Paperclip
  skills. Prefer temporary symlink dirs plus a runtime flag; global skill dirs
  are acceptable when that is the runtime convention.
- Implement `detectModel` when the runtime has a discoverable default model.
- Treat agent output as untrusted, inject secrets via environment variables,
  and enforce timeout plus grace period.

UI parser rules:

- Export `createStdoutParser()` or `parseStdoutLine(line, ts)`.
- The built file must have zero runtime imports, no DOM/Node APIs, no top-level
  side effects, deterministic output, and should stay under 50 KB.
- Never throw from parsing. Return a `stdout` fallback entry for unknown lines.
- Use `toolUseId` to link `tool_call` and `tool_result` transcript entries.

Adapter plugins are installed through the adapter manager/API rather than the
normal `paperclipai plugin install` lifecycle:

```bash
curl -X POST http://localhost:3102/api/adapters \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"localPath": "/absolute/path/to/my-adapter"}'
```

Or via `~/.paperclip/adapter-plugins.json` for development:

```json
[
  {
    "packageName": "my-paperclip-adapter",
    "localPath": "/home/user/my-adapter",
    "type": "my_adapter",
    "installedAt": "2026-03-30T12:00:00.000Z"
  }
]
```

Local adapter source changes usually require a Paperclip server restart unless
the adapter loader in the current build explicitly supports live reload.

## 9. Verification before declaring success

For normal plugins, run from the plugin folder:

```bash
pnpm typecheck
pnpm test
pnpm build
paperclipai plugin list
paperclipai plugin inspect <plugin-key>
```

For adapter plugins:

```bash
pnpm build
pnpm test
```

Then verify the adapter is visible through the adapter API/UI, run the
environment test, and execute at least one minimal heartbeat or hello probe when
the runtime is available. If the adapter ships a UI parser, test it against
sample stdout.

If you changed Paperclip core, SDK, CLI, or host runtime code in addition to the
plugin package, run the relevant Paperclip workspace checks for those packages.

## 10. Success report

Report these facts back:

- Plugin or adapter package path.
- Exact scaffold, install, and verification commands run.
- Install or adapter-registration status, including plugin key or adapter type,
  version, status, and `lastError` when present.
- Test/build results.
- Reload limitations: worker reload, UI dev server, manifest reinstall, server
  restart, or adapter loader restart requirements.
- Any missing verification item, marked explicitly rather than silently skipped.

## 11. Reference: first-party example plugins

Use these as living documentation when you need concrete patterns:

- **`packages/plugins/examples/plugin-kitchen-sink-example`** — demonstrates
  nearly the full plugin surface: all UI slot types, data/actions, events, jobs,
  webhooks, tools, streams, metrics, telemetry, activity logging, agent
  invocation/sessions, local workspace access, process spawning, config schema,
  launchers, and toast usage. Not a production template — it is intentionally
  broad for testing and onboarding.
- **`packages/plugins/examples/plugin-orchestration-smoke-example`** — validates
  orchestration-grade APIs: database namespace + migrations, plugin API routes,
  `ctx.db.query/execute`, `JOIN public.issues`, issue creation with
  `originKind`/`originId`, blocker relations, documents, wakeups, orchestration
  summaries, and `onApiRequest`.

## 12. Documentation expectations

When updating plugin or adapter docs:

- Distinguish current implementation from future spec ideas.
- Prefer local-path development and npm-package deployment guidance.
- Be explicit about the trusted-code model.
- Do not promise unsupported APIs such as `ctx.assets`.
- Do not imply external adapter plugins need Paperclip source registry edits.
