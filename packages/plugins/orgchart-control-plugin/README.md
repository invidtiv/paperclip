# Org Chart Control

Plugin-owned org control surface for team-colored layouts, multi-agent selection,
group movement, and direct provider/model changes for agents.

## Behavior

- Card click selects agents; it does not open agent settings.
- Gear opens the core agent settings page.
- Teams and positions are stored in plugin state under a versioned company scope.
- Provider/model saves use the core agent PATCH route so validation, activity
  logging, and config revisions stay centralized.
- Provider changes replace adapter-specific config and apply the new adapter's
  default command when Paperclip knows it.

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

`pnpm dev` rebuilds the worker, manifest, and UI bundles into `dist/`.
When this package is installed from a local path, Paperclip watches that rebuilt
output and reloads the plugin worker. Local installs run trusted code from this
folder on your machine.



## Install Into Paperclip

```bash
paperclipai plugin install /home/bsdev/github/paperclip/packages/plugins/orgchart-control-plugin
```

## Build Options

- `pnpm build` uses esbuild presets from `@paperclipai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
