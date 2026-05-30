import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "paperclipai.company-files-plugin",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Company Files Viewer",
  description: "View and filter all documents in the company and documents created specifically by agents.",
  author: "Antigravity",
  categories: ["ui", "workspace"],
  capabilities: [
    "companies.read",
    "agents.read",
    "issues.read",
    "issue.documents.read",
    "issue.documents.write",
    "ui.page.register",
    "ui.sidebar.register",
    "database.namespace.migrate",
    "database.namespace.read",
    "local.folders",
    "projects.read",
    "project.workspaces.read"
  ],
  database: {
    migrationsDir: "migrations",
    coreReadTables: ["issues", "issue_documents", "agents", "projects"]
  },
  localFolders: [
    {
      folderKey: "company-files",
      displayName: "Company Files",
      description: "Local workspace directory of the company",
      access: "readWrite"
    }
  ],
  entrypoints: {
    worker: "./dist/worker.js",
    ui: "./dist/ui"
  },
  ui: {
    slots: [
      {
        type: "page",
        id: "company-files-page",
        displayName: "Company Files",
        exportName: "CompanyFilesPage",
        routePath: "company-files"
      },
      {
        type: "sidebar",
        id: "company-files-sidebar-link",
        displayName: "Company Files",
        exportName: "SidebarLink"
      }
    ]
  }
};

export default manifest;
