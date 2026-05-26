import type { UIAdapterModule } from "../types";
import { parseAutohandStdoutLine, buildAutohandLocalConfig } from "@paperclipai/adapter-autohand-local/ui";
import { AutohandLocalConfigFields } from "./config-fields";

export const autohandLocalUIAdapter: UIAdapterModule = {
  type: "autohand_local",
  label: "Autohand CLI (local)",
  parseStdoutLine: parseAutohandStdoutLine,
  ConfigFields: AutohandLocalConfigFields,
  buildAdapterConfig: buildAutohandLocalConfig,
};
