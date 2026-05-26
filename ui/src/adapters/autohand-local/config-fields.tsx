import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  ToggleField,
  DraftInput,
  help,
} from "../../components/agent-config-primitives";
import { ChoosePathButton } from "../../components/PathInstructionsModal";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";
const instructionsFileHint =
  "Absolute path to a markdown file (e.g. AGENTS.md) that defines this agent's behavior. Prepended to the Autohand prompt at runtime.";

export function AutohandLocalConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
  hideInstructionsFile,
}: AdapterConfigFieldsProps) {
  const currentThinking = isCreate
    ? !!values!.thinking
    : eff("adapterConfig", "thinking", !!config.thinking);

  const currentRestricted = isCreate
    ? !!values!.restricted
    : eff("adapterConfig", "restricted", !!config.restricted);

  const currentDryRun = isCreate
    ? !!values!.dryRun
    : eff("adapterConfig", "dryRun", !!config.dryRun);

  const currentYes = isCreate
    ? values!.yes !== false
    : eff("adapterConfig", "yes", config.yes !== false);

  const currentExtraArgs = isCreate
    ? String(values!.extraArgs ?? "")
    : eff("adapterConfig", "extraArgs", String(config.extraArgs ?? ""));

  return (
    <>
      {!hideInstructionsFile && (
        <Field label="Agent instructions file" hint={instructionsFileHint}>
          <div className="flex items-center gap-2">
            <DraftInput
              value={
                isCreate
                  ? values!.instructionsFilePath ?? ""
                  : eff(
                      "adapterConfig",
                      "instructionsFilePath",
                      String(config.instructionsFilePath ?? ""),
                    )
              }
              onCommit={(v) =>
                isCreate
                  ? set!({ instructionsFilePath: v })
                  : mark("adapterConfig", "instructionsFilePath", v || undefined)
              }
              immediate
              className={inputClass}
              placeholder="/absolute/path/to/AGENTS.md"
            />
            <ChoosePathButton />
          </div>
        </Field>
      )}

      <ToggleField
        label="Auto-approve all actions (--yes)"
        hint="Automatically approve all tool executions and changes proposed by Autohand."
        checked={currentYes}
        onChange={(v) =>
          isCreate ? set!({ yes: v }) : mark("adapterConfig", "yes", v)
        }
      />

      <ToggleField
        label="Thinking mode (--thinking)"
        hint="Enable deep reasoning / thinking output from the underlying LLM model."
        checked={currentThinking}
        onChange={(v) =>
          isCreate ? set!({ thinking: v }) : mark("adapterConfig", "thinking", v)
        }
      />

      <ToggleField
        label="Restricted mode (--restricted)"
        hint="Run Autohand in read-only / restricted mode to prevent file edits or commands."
        checked={currentRestricted}
        onChange={(v) =>
          isCreate ? set!({ restricted: v }) : mark("adapterConfig", "restricted", v)
        }
      />

      <ToggleField
        label="Dry run (--dry-run)"
        hint="Run in dry run mode to see what Autohand would do without applying any changes."
        checked={currentDryRun}
        onChange={(v) =>
          isCreate ? set!({ dryRun: v }) : mark("adapterConfig", "dryRun", v)
        }
      />

      <Field
        label="Extra CLI arguments"
        hint="Optional additional command line parameters, comma-separated."
      >
        <DraftInput
          value={currentExtraArgs}
          onCommit={(v) =>
            isCreate ? set!({ extraArgs: v }) : mark("adapterConfig", "extraArgs", v || undefined)
          }
          immediate
          className={inputClass}
          placeholder="--verbose, --depth=3"
        />
      </Field>
    </>
  );
}
