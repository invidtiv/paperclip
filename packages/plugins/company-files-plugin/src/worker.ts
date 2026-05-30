import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import fs from "node:fs/promises";
import path from "node:path";

const COMPANY_FILES_FOLDER_KEY = "company-files";

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogg": "video/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".pdf": "application/pdf",
};

const BINARY_EXTENSIONS = new Set(Object.keys(MIME_TYPES));

function isPathInside(rootPath: string, targetPath: string) {
  const relativePath = path.relative(rootPath, targetPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.logger.info("Company Files plugin setup");

    const configureCompanyFilesFolder = async (companyId: string) => {
      const projectRows = await ctx.db.query<{ id: string }>(
        `SELECT id FROM public.projects WHERE company_id = $1 ORDER BY updated_at DESC LIMIT 1`,
        [companyId]
      );
      const projectId = projectRows[0]?.id;
      let cwd: string | undefined;
      if (projectId) {
        const workspace = await ctx.projects.getPrimaryWorkspace(projectId, companyId);
        cwd = workspace?.path;
      }

      if (!cwd) return null;

      await ctx.localFolders.configure({
        companyId,
        folderKey: COMPANY_FILES_FOLDER_KEY,
        path: cwd,
        access: "readWrite",
      });

      return cwd;
    };

    // Retrieve all files (documents) in the company with agent/user details
    ctx.data.register("list-company-files", async (params) => {
      const companyId = String(params.companyId ?? "");
      if (!companyId) return { files: [], agents: [] };

      try {
        // Query agents to construct a mapping of agentId -> agentName
        const agentsRows = await ctx.db.query<{ id: string; name: string }>(
          `SELECT id, name FROM public.agents WHERE company_id = $1`,
          [companyId]
        );

        // Query issue documents and parent issue info
        const query = `
          SELECT 
            id.id,
            id.issue_id,
            id.key,
            i.identifier as issue_identifier,
            i.title as issue_title
          FROM public.issue_documents id
          JOIN public.issues i ON i.id = id.issue_id
          WHERE id.company_id = $1
          ORDER BY id.updated_at DESC
        `;
        const rows = await ctx.db.query<{
          id: string;
          issue_id: string;
          key: string;
          issue_identifier: string;
          issue_title: string;
        }>(query, [companyId]);

        // Filter out continuation-summary files immediately
        const filteredRows = rows.filter(row => row.key !== "continuation-summary");

        // Load document details in parallel
        const filePromises = filteredRows.map(async (row) => {
          try {
            const doc = await ctx.issues.documents.get(
              row.issue_id,
              row.key,
              companyId,
            );

            if (!doc) return null;

            return {
              issueDocumentId: row.id,
              issueId: row.issue_id,
              key: row.key,
              path: row.key,
              title: doc.title,
              format: doc.format,
              createdAt: typeof doc.createdAt === "string" ? doc.createdAt : (doc.createdAt as Date).toISOString(),
              updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : (doc.updatedAt as Date).toISOString(),
              createdByAgentId: doc.createdByAgentId,
              createdByUserId: doc.createdByUserId,
              issueIdentifier: row.issue_identifier,
              issueTitle: row.issue_title,
            };
          } catch (e) {
            ctx.logger.warn("Failed to get document detail", { key: row.key, issueId: row.issue_id, error: String(e) });
            return null;
          }
        });

        // Filter to only return files created by agents
        const files = (await Promise.all(filePromises))
          .filter((f): f is NonNullable<typeof f> => f !== null && f.createdByAgentId !== null);

        return {
          files,
          agents: agentsRows,
        };
      } catch (err) {
        ctx.logger.error("Failed to list company files", { error: String(err) });
        return { files: [], agents: [] };
      }
    });

    // Get detail and content of a database-backed file
    ctx.data.register("get-company-file-details", async (params) => {
      const companyId = String(params.companyId ?? "");
      const issueId = String(params.issueId ?? "");
      const key = String(params.key ?? "");

      if (!companyId || !issueId || !key) {
        return { error: "Missing required parameters" };
      }

      try {
        const doc = await ctx.issues.documents.get(issueId, key, companyId);
        if (!doc) return { error: "File not found" };

        return {
          file: {
            id: doc.id,
            key: doc.key,
            path: doc.key,
            title: doc.title,
            format: doc.format,
            body: doc.body,
            createdAt: typeof doc.createdAt === "string" ? doc.createdAt : (doc.createdAt as Date).toISOString(),
            updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : (doc.updatedAt as Date).toISOString(),
            createdByAgentId: doc.createdByAgentId,
            createdByUserId: doc.createdByUserId,
          }
        };
      } catch (err) {
        ctx.logger.error("Failed to get file details", { issueId, key, error: String(err) });
        return { error: String(err) };
      }
    });

    // Save updated content for a database-backed file
    ctx.actions.register("save-company-file-details", async (params) => {
      const companyId = String(params.companyId ?? "");
      const issueId = String(params.issueId ?? "");
      const key = String(params.key ?? "");
      const body = typeof params.body === "string" ? params.body : null;

      if (!companyId || !issueId || !key) {
        throw new Error("Missing required parameters");
      }
      if (body === null) {
        throw new Error("Missing file content");
      }

      const existing = await ctx.issues.documents.get(issueId, key, companyId);
      if (!existing) {
        throw new Error("File not found");
      }

      try {
        const saved = await ctx.issues.documents.upsert({
          companyId,
          issueId,
          key,
          title: existing.title ?? undefined,
          format: existing.format,
          body,
          changeSummary: "Updated from Company Files plugin",
        });

        return {
          ok: true,
          file: {
            id: saved.id,
            key: saved.key,
            path: saved.key,
            title: saved.title,
            format: saved.format,
            body: saved.body,
            createdAt: typeof saved.createdAt === "string" ? saved.createdAt : (saved.createdAt as Date).toISOString(),
            updatedAt: typeof saved.updatedAt === "string" ? saved.updatedAt : (saved.updatedAt as Date).toISOString(),
            createdByAgentId: saved.createdByAgentId,
            createdByUserId: saved.createdByUserId,
          }
        };
      } catch (err) {
        ctx.logger.error("Failed to save database-backed company file", { issueId, key, error: String(err) });
        throw new Error("Failed to save produced file");
      }
    });

    // List physical files in the company workspace directory
    ctx.data.register("list-company-directory-files", async (params) => {
      const companyId = String(params.companyId ?? "");
      if (!companyId) return { entries: [] };

      try {
        const cwd = await configureCompanyFilesFolder(companyId);
        if (!cwd) {
          ctx.logger.warn("No workspace directory found for company", { companyId });
          return { entries: [] };
        }

        // List files recursively (up to 2000 entries)
        const listing = await ctx.localFolders.list(companyId, COMPANY_FILES_FOLDER_KEY, {
          recursive: true,
          maxEntries: 2000,
        });

        // Filter out continuation-summary files and git/metadata files
        const filteredEntries = (listing.entries ?? []).filter(entry => {
          const nameLower = entry.name.toLowerCase();
          return (
            !nameLower.includes("continuation-summary") &&
            !entry.path.startsWith(".git/") &&
            !entry.path.includes("/.git/")
          );
        });

        return {
          entries: filteredEntries,
          cwd
        };
      } catch (err) {
        ctx.logger.error("Failed to list company directory files", { error: String(err) });
        return { entries: [], error: String(err) };
      }
    });

    // Read physical file content in the company directory
    ctx.data.register("get-company-directory-file-content", async (params) => {
      const companyId = String(params.companyId ?? "");
      const relativePath = String(params.relativePath ?? "");
      if (!companyId || !relativePath) {
        return { error: "Missing parameters" };
      }

      try {
        const cwd = await configureCompanyFilesFolder(companyId);
        if (!cwd) {
          return { error: "No workspace directory found for company" };
        }

        const realCwd = await fs.realpath(cwd);
        const targetPath = path.resolve(realCwd, relativePath);
        const realTargetPath = await fs.realpath(targetPath);

        if (!isPathInside(realCwd, realTargetPath)) {
          return { error: "Access denied" };
        }

        const ext = path.extname(realTargetPath).toLowerCase();
        const isBinary = BINARY_EXTENSIONS.has(ext);

        if (isBinary) {
          const buffer = await fs.readFile(realTargetPath);
          const base64 = buffer.toString("base64");
          const mimeType = MIME_TYPES[ext] || "application/octet-stream";
          return {
            content: base64,
            isBinary: true,
            mimeType,
          };
        } else {
          const content = await ctx.localFolders.readText(companyId, COMPANY_FILES_FOLDER_KEY, relativePath);
          return {
            content,
            isBinary: false,
          };
        }
      } catch (err) {
        ctx.logger.error("Failed to read company directory file", { relativePath, error: String(err) });
        return { error: String(err) };
      }
    });

    // Save physical text file content in the company directory
    ctx.actions.register("save-company-directory-file-content", async (params) => {
      const companyId = String(params.companyId ?? "");
      const relativePath = String(params.relativePath ?? "");
      const content = typeof params.content === "string" ? params.content : null;

      if (!companyId || !relativePath) {
        throw new Error("Missing required parameters");
      }
      if (content === null) {
        throw new Error("Missing file content");
      }

      const ext = path.extname(relativePath).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) {
        throw new Error("Only text files can be edited");
      }

      try {
        const cwd = await configureCompanyFilesFolder(companyId);
        if (!cwd) {
          throw new Error("No workspace directory found for company");
        }

        await ctx.localFolders.writeTextAtomic(
          companyId,
          COMPANY_FILES_FOLDER_KEY,
          relativePath,
          content,
        );

        return {
          ok: true,
          path: relativePath,
          bytes: Buffer.byteLength(content, "utf8"),
        };
      } catch (err) {
        ctx.logger.error("Failed to save company directory file", { relativePath, error: String(err) });
        throw new Error("Failed to save company directory file");
      }
    });
  },

  async onHealth() {
    return { status: "ok", message: "Company Files Viewer plugin worker is running" };
  }
});

export default plugin;
runWorker(plugin, import.meta.url);
