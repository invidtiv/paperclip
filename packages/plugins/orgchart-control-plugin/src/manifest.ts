import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.orgchart-control-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Org Chart Control",
  description: "Team-colored org control surface with grouped layout and direct agent provider/model changes",
  author: "Paperclip",
  categories: ["ui"],
  capabilities: [
    "companies.read",
    "agents.read",
    "plugin.state.read",
    "plugin.state.write",
    "ui.page.register",
    "ui.sidebar.register"
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      {
        type: "page",
        id: "orgchart-interactive-page",
        displayName: "Org Chart Control",
        exportName: "InteractiveOrgChartPage",
        routePath: "interactive-org-chart"
      },
      {
        type: "sidebar",
        id: "orgchart-sidebar-link",
        displayName: "Org Chart Control",
        exportName: "SidebarLink"
      }
    ]
  }
};

export default manifest;
