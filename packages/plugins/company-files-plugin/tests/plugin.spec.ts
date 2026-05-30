import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

vi.mock("node:fs/promises", () => {
  return {
    default: {
      realpath: vi.fn().mockImplementation(async (p) => p),
      readFile: vi.fn().mockImplementation(async (p, encoding) => {
        if (encoding === "utf8") return "Mock file content";
        return Buffer.from("Mock file content");
      }),
    }
  };
});

describe("Company Files Plugin tests", () => {
  it("declares page and sidebar slots", () => {
    expect(manifest.ui?.slots?.some((s) => s.type === "page")).toBe(true);
    expect(manifest.ui?.slots?.some((s) => s.type === "sidebar")).toBe(true);
    expect(manifest.capabilities).toContain("issue.documents.write");
    expect(manifest.localFolders?.[0]?.access).toBe("readWrite");
  });

  it("handles listing files and getting file details", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });
    
    // Mock db.query
    harness.ctx.db.query = async <T,>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (sql.includes("public.agents")) {
        return [
          { id: "agent-1", name: "Coder Agent" }
        ] as unknown as T[];
      }
      if (sql.includes("public.issue_documents")) {
        return [
          {
            id: "doc-relation-1",
            issue_id: "issue-1",
            key: "notes.md",
            issue_identifier: "PAP-1",
            issue_title: "Implement login",
          }
        ] as unknown as T[];
      }
      return [] as T[];
    };

    // Mock issues.documents.get
    harness.ctx.issues.documents.get = async (issueId: string, key: string, companyId: string) => {
      if (issueId === "issue-1" && key === "notes.md") {
        return {
          id: "doc-1",
          companyId,
          issueId,
          key,
          title: "Notes",
          format: "markdown",
          body: "Hello from Coder Agent!",
          createdByAgentId: "agent-1",
          createdByUserId: null,
          createdAt: new Date("2026-05-28T12:00:00Z"),
          updatedAt: new Date("2026-05-28T12:00:00Z"),
        } as any;
      }
      return null as any;
    };

    await plugin.definition.setup(harness.ctx);

    // Test list-company-files
    const listResult = await harness.getData<{
      files: Array<any>;
      agents: Array<any>;
    }>("list-company-files", { companyId: "comp-1" });

    expect(listResult.files).toHaveLength(1);
    expect(listResult.files[0].key).toBe("notes.md");
    expect(listResult.files[0].path).toBe("notes.md");
    expect(listResult.files[0].title).toBe("Notes");
    expect(listResult.files[0].createdByAgentId).toBe("agent-1");
    expect(listResult.agents).toHaveLength(1);
    expect(listResult.agents[0].name).toBe("Coder Agent");

    // Test get-company-file-details
    const detailResult = await harness.getData<{
      file?: any;
      error?: string;
    }>("get-company-file-details", {
      companyId: "comp-1",
      issueId: "issue-1",
      key: "notes.md",
    });

    expect(detailResult.file).toBeDefined();
    expect(detailResult.file.path).toBe("notes.md");
    expect(detailResult.file.body).toBe("Hello from Coder Agent!");
    expect(detailResult.file.createdByAgentId).toBe("agent-1");
  });

  it("handles listing physical directory files and reading their content", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });

    // Mock db.query for active project ID
    harness.ctx.db.query = async <T,>(sql: string, params?: unknown[]): Promise<T[]> => {
      if (sql.includes("public.projects")) {
        return [
          { id: "project-1" }
        ] as unknown as T[];
      }
      return [] as T[];
    };

    // Mock projects.getPrimaryWorkspace API call
    harness.ctx.projects.getPrimaryWorkspace = vi.fn().mockResolvedValue({
      path: "/home/bsdev/workspace/mock"
    });

    // Spies/mocks for localFolders APIs
    harness.ctx.localFolders.configure = vi.fn().mockResolvedValue(undefined);
    harness.ctx.localFolders.list = vi.fn().mockResolvedValue({
      entries: [
        { path: "company/knowledge/company.md", name: "company.md", kind: "file", size: 500, modifiedAt: "2026-05-28T12:00:00Z" },
        { path: "continuation-summary.md", name: "continuation-summary.md", kind: "file", size: 200, modifiedAt: "2026-05-28T12:00:00Z" },
        { path: ".git/config", name: "config", kind: "file", size: 150, modifiedAt: "2026-05-28T12:00:00Z" },
        { path: "plans/patch.json", name: "patch.json", kind: "file", size: 120, modifiedAt: "2026-05-28T12:00:00Z" }
      ]
    });
    harness.ctx.localFolders.readText = vi.fn().mockResolvedValue("Mock file content");

    await plugin.definition.setup(harness.ctx);

    // Test list-company-directory-files
    const listDirResult = await harness.getData<{
      entries: Array<any>;
      cwd?: string;
      error?: string;
    }>("list-company-directory-files", { companyId: "comp-1" });

    // Should configure with correct path
    expect(harness.ctx.localFolders.configure).toHaveBeenCalledWith({
      companyId: "comp-1",
      folderKey: "company-files",
      path: "/home/bsdev/workspace/mock",
      access: "readWrite",
    });

    // Should list files recursively
    expect(harness.ctx.localFolders.list).toHaveBeenCalledWith(
      "comp-1",
      "company-files",
      { recursive: true, maxEntries: 2000 }
    );

    // Should filter out continuation-summary and .git files
    expect(listDirResult.entries).toHaveLength(2);
    expect(listDirResult.entries[0].path).toBe("company/knowledge/company.md");
    expect(listDirResult.entries[1].path).toBe("plans/patch.json");
    expect(listDirResult.cwd).toBe("/home/bsdev/workspace/mock");

    // Test get-company-directory-file-content
    const fileContentResult = await harness.getData<{
      content?: string;
      error?: string;
      isBinary?: boolean;
      mimeType?: string;
    }>("get-company-directory-file-content", {
      companyId: "comp-1",
      relativePath: "company/knowledge/company.md"
    });

    expect(fileContentResult.content).toBe("Mock file content");
    expect(fileContentResult.isBinary).toBe(false);

    // Test binary file reading
    const binaryContentResult = await harness.getData<{
      content?: string;
      error?: string;
      isBinary?: boolean;
      mimeType?: string;
    }>("get-company-directory-file-content", {
      companyId: "comp-1",
      relativePath: "company/knowledge/logo.png"
    });

    expect(binaryContentResult.isBinary).toBe(true);
    expect(binaryContentResult.mimeType).toBe("image/png");
    expect(binaryContentResult.content).toBe(Buffer.from("Mock file content").toString("base64"));
  });

  it("saves database-backed produced files through the issue document update path", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });

    const existingDocument = {
      id: "doc-1",
      companyId: "comp-1",
      issueId: "issue-1",
      key: "notes.md",
      title: "Notes",
      format: "markdown",
      body: "Original content",
      createdByAgentId: "agent-1",
      createdByUserId: null,
      createdAt: new Date("2026-05-28T12:00:00Z"),
      updatedAt: new Date("2026-05-28T12:00:00Z"),
    } as any;

    harness.ctx.issues.documents.get = vi.fn().mockResolvedValue(existingDocument);
    harness.ctx.issues.documents.upsert = vi.fn().mockResolvedValue({
      ...existingDocument,
      body: "Updated content",
      updatedAt: new Date("2026-05-28T13:00:00Z"),
    });

    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<{
      ok: boolean;
      file?: { body: string };
    }>("save-company-file-details", {
      companyId: "comp-1",
      issueId: "issue-1",
      key: "notes.md",
      body: "Updated content",
    });

    expect(harness.ctx.issues.documents.get).toHaveBeenCalledWith("issue-1", "notes.md", "comp-1");
    expect(harness.ctx.issues.documents.upsert).toHaveBeenCalledWith({
      companyId: "comp-1",
      issueId: "issue-1",
      key: "notes.md",
      title: "Notes",
      format: "markdown",
      body: "Updated content",
      changeSummary: "Updated from Company Files plugin",
    });
    expect(result.ok).toBe(true);
    expect(result.file?.body).toBe("Updated content");
  });

  it("saves editable company directory text files through the local folder update path", async () => {
    const harness = createTestHarness({ manifest, capabilities: manifest.capabilities });

    harness.ctx.db.query = async <T,>(sql: string): Promise<T[]> => {
      if (sql.includes("public.projects")) {
        return [{ id: "project-1" }] as unknown as T[];
      }
      return [] as T[];
    };
    harness.ctx.projects.getPrimaryWorkspace = vi.fn().mockResolvedValue({
      path: "/home/bsdev/workspace/mock",
    });
    harness.ctx.localFolders.configure = vi.fn().mockResolvedValue({
      folderKey: "company-files",
      configured: true,
      path: "/home/bsdev/workspace/mock",
      realPath: "/home/bsdev/workspace/mock",
      access: "readWrite",
      readable: true,
      writable: true,
      requiredDirectories: [],
      requiredFiles: [],
      missingDirectories: [],
      missingFiles: [],
      healthy: true,
      problems: [],
      checkedAt: "2026-05-28T12:00:00Z",
    });
    harness.ctx.localFolders.writeTextAtomic = vi.fn().mockResolvedValue({
      folderKey: "company-files",
      configured: true,
      path: "/home/bsdev/workspace/mock",
      realPath: "/home/bsdev/workspace/mock",
      access: "readWrite",
      readable: true,
      writable: true,
      requiredDirectories: [],
      requiredFiles: [],
      missingDirectories: [],
      missingFiles: [],
      healthy: true,
      problems: [],
      checkedAt: "2026-05-28T12:00:00Z",
    });

    await plugin.definition.setup(harness.ctx);

    const result = await harness.performAction<{
      ok: boolean;
      path?: string;
      bytes?: number;
    }>("save-company-directory-file-content", {
      companyId: "comp-1",
      relativePath: "company/knowledge/company.md",
      content: "Updated local content",
    });

    expect(harness.ctx.localFolders.configure).toHaveBeenCalledWith({
      companyId: "comp-1",
      folderKey: "company-files",
      path: "/home/bsdev/workspace/mock",
      access: "readWrite",
    });
    expect(harness.ctx.localFolders.writeTextAtomic).toHaveBeenCalledWith(
      "comp-1",
      "company-files",
      "company/knowledge/company.md",
      "Updated local content",
    );
    expect(result).toEqual({
      ok: true,
      path: "company/knowledge/company.md",
      bytes: Buffer.byteLength("Updated local content", "utf8"),
    });
  });
});
