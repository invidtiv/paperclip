import { useEffect, useState, useMemo } from "react";
import {
  usePluginData,
  usePluginAction,
  useHostContext,
  useHostNavigation,
  MarkdownBlock,
  MarkdownEditor,
} from "@paperclipai/plugin-sdk/ui";

// SVG Icon for Files
function FilesIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: "block" }}
    >
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

// SVG Icon for Agents
function AgentIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: "block" }}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

// SVG Icon for User
function UserIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: "block" }}
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// SVG Icon for Task/Issue
function IssueIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: "block" }}
    >
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </svg>
  );
}

// SVG Icon for Folder
function FolderIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: "block" }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// SVG Icon for Folder Open
function FolderOpenIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: size, height: size, display: "block" }}
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" opacity="0.3" />
      <path d="M2 10h20M2 14h20" strokeWidth="1" opacity="0.4" />
      <path d="M20 9.5V6a2 2 0 0 0-2-2h-7.5L8.5 2H4a2 2 0 0 0-2 2v15a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9.5z" />
    </svg>
  );
}

// SVG Chevron Icon
function ChevronIcon({ expanded, size = 12 }: { expanded: boolean; size?: number }) {
  return (
    <svg
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        width: size,
        height: size,
        display: "block",
        transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
        transition: "transform 0.15s ease",
      }}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

// Format size helper
function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

// File Node Tree structure
interface FileNode {
  name: string;
  path: string;
  kind: "directory" | "file";
  size: number | null;
  modifiedAt: string | null;
  children: Record<string, FileNode>;
}

type EditorTarget =
  | { kind: "produced"; issueId: string; key: string }
  | { kind: "company"; path: string };

const IMAGE_FORMATS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);

function editableProducedFormat(format: string) {
  return !IMAGE_FORMATS.has(format.toLowerCase());
}

function buildTree(entries: any[]): FileNode {
  const root: FileNode = {
    name: "Root",
    path: "",
    kind: "directory",
    size: null,
    modifiedAt: null,
    children: {}
  };

  entries.forEach((entry) => {
    const parts = entry.path.split("/");
    let current = root;

    parts.forEach((part: string, idx: number) => {
      const isLast = idx === parts.length - 1;
      const partPath = parts.slice(0, idx + 1).join("/");

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: partPath,
          kind: isLast ? entry.kind : "directory",
          size: isLast ? entry.size : null,
          modifiedAt: isLast ? entry.modifiedAt : null,
          children: {}
        };
      }
      current = current.children[part];
    });
  });

  return root;
}

// Recursive File Tree Node component
function FileTreeNode({
  node,
  depth,
  expandedPaths,
  togglePath,
  selectedPath,
  onSelectFile
}: {
  node: FileNode;
  depth: number;
  expandedPaths: Record<string, boolean>;
  togglePath: (path: string) => void;
  selectedPath: string | undefined;
  onSelectFile: (node: FileNode) => void;
}) {
  const isDirectory = node.kind === "directory";
  const isExpanded = expandedPaths[node.path] ?? false;
  const isSelected = selectedPath === node.path;

  // Sort children: directories first, then files, alphabetically
  const sortedChildren = useMemo(() => {
    return Object.values(node.children).sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "directory" ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [node.children]);

  if (node.path === "") {
    return (
      <div className="space-y-0.5">
        {sortedChildren.map((child) => (
          <FileTreeNode
            key={child.path}
            node={child}
            depth={0}
            expandedPaths={expandedPaths}
            togglePath={togglePath}
            selectedPath={selectedPath}
            onSelectFile={onSelectFile}
          />
        ))}
      </div>
    );
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isDirectory) {
      togglePath(node.path);
    } else {
      onSelectFile(node);
    }
  };

  return (
    <div className="flex flex-col select-none">
      <div
        onClick={handleClick}
        style={{ paddingLeft: `${depth * 12 + 6}px` }}
        className={`group flex items-center gap-1.5 py-1.5 px-2 rounded-md cursor-pointer transition-colors text-xs font-medium ${
          isSelected
            ? "bg-accent text-accent-foreground font-semibold"
            : "hover:bg-accent/40 text-foreground/90 hover:text-foreground"
        }`}
      >
        {isDirectory ? (
          <>
            <ChevronIcon expanded={isExpanded} />
            {isExpanded ? (
              <FolderOpenIcon size={14} className="text-primary shrink-0" />
            ) : (
              <FolderIcon size={14} className="text-primary shrink-0" />
            )}
          </>
        ) : (
          <>
            <span className="w-3" />
            <FilesIcon size={14} className="text-muted-foreground shrink-0" />
          </>
        )}
        <span className="truncate flex-1">{node.name}</span>
        {!isDirectory && node.size !== null && (
          <span className="text-[10px] text-muted-foreground opacity-60 group-hover:opacity-100 shrink-0">
            {formatBytes(node.size)}
          </span>
        )}
      </div>

      {isDirectory && isExpanded && sortedChildren.length > 0 && (
        <div className="mt-0.5">
          {sortedChildren.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              togglePath={togglePath}
              selectedPath={selectedPath}
              onSelectFile={onSelectFile}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Sidebar Link Component
export function SidebarLink() {
  const { linkProps } = useHostNavigation();
  const context = useHostContext();
  if (!context.companyPrefix) return null;

  return (
    <a
      {...linkProps("/company-files")}
      className="flex items-center gap-2.5 px-3 py-2 pointer-coarse:py-1.5 text-[13px] font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
    >
      <FilesIcon size={16} />
      <span className="truncate">Company Files</span>
    </a>
  );
}

// Main Page Component
export function CompanyFilesPage() {
  const context = useHostContext();
  const companyId = context.companyId;
  const { navigate } = useHostNavigation();
  const saveProducedFile = usePluginAction("save-company-file-details");
  const saveCompanyFile = usePluginAction("save-company-directory-file-content");

  // Navigation states
  const [activeTab, setActiveTab] = useState<"produced" | "company">("produced");
  const [selectedDbFile, setSelectedDbFile] = useState<{ issueId: string; key: string } | null>(null);
  const [selectedDirFile, setSelectedDirFile] = useState<{ path: string; name: string } | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editorTarget, setEditorTarget] = useState<EditorTarget | null>(null);
  const [draftContent, setDraftContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Directory tree expansion state
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({
    "company": true,
    "company/knowledge": true
  });

  const togglePath = (path: string) => {
    setExpandedPaths(prev => ({ ...prev, [path]: !prev[path] }));
  };

  // 1. Fetch Produced Files (Agent outputs)
  const { data: dbData, loading: dbLoading } = usePluginData<{
    files: Array<{
      issueDocumentId: string;
      issueId: string;
      key: string;
      path: string;
      title: string | null;
      format: string;
      createdAt: string;
      updatedAt: string;
      createdByAgentId: string | null;
      createdByUserId: string | null;
      issueIdentifier: string;
      issueTitle: string;
    }>;
    agents: Array<{ id: string; name: string }>;
  }>("list-company-files", { companyId });

  // 2. Fetch Company Physical Files
  const { data: dirData, loading: dirLoading } = usePluginData<{
    entries: Array<{
      path: string;
      name: string;
      kind: "directory" | "file";
      size: number | null;
      modifiedAt: string;
    }>;
    cwd?: string;
  }>("list-company-directory-files", { companyId });

  // 3. Fetch Selected DB File Detail
  const { data: dbDetailData, loading: dbDetailLoading, refresh: refreshDbDetail } = usePluginData<{
    file?: {
      id: string;
      key: string;
      path: string;
      title: string | null;
      format: string;
      body: string;
      createdAt: string;
      updatedAt: string;
      createdByAgentId: string | null;
      createdByUserId: string | null;
    };
    error?: string;
  }>("get-company-file-details", {
    companyId,
    issueId: selectedDbFile?.issueId ?? "",
    key: selectedDbFile?.key ?? "",
  });

  // 4. Fetch Selected Dir File Content
  const { data: dirFileContentData, loading: dirFileContentLoading, refresh: refreshDirFileContent } = usePluginData<{
    content?: string;
    error?: string;
    isBinary?: boolean;
    mimeType?: string;
  }>("get-company-directory-file-content", {
    companyId,
    relativePath: selectedDirFile?.path ?? "",
  });

  const dbFiles = dbData?.files ?? [];
  const agents = dbData?.agents ?? [];
  const selectedProducedContent = dbDetailData?.file?.body ?? "";
  const selectedCompanyContent = dirFileContentData?.content ?? "";
  const canEditProducedFile = Boolean(
    selectedDbFile &&
    dbDetailData?.file &&
    editableProducedFormat(dbDetailData.file.format),
  );
  const canEditCompanyFile = Boolean(
    selectedDirFile &&
    dirFileContentData &&
    !dirFileContentData.error &&
    !dirFileContentData.isBinary &&
    dirFileContentData.content !== undefined,
  );
  const isEditingProducedFile =
    editorTarget?.kind === "produced" &&
    editorTarget.issueId === selectedDbFile?.issueId &&
    editorTarget.key === selectedDbFile?.key;
  const isEditingCompanyFile =
    editorTarget?.kind === "company" &&
    editorTarget.path === selectedDirFile?.path;

  useEffect(() => {
    setEditorTarget(null);
    setDraftContent("");
    setSaveMessage(null);
    setSaveError(null);
  }, [activeTab, selectedDbFile?.issueId, selectedDbFile?.key, selectedDirFile?.path]);

  const handleDraftChange = (value: string) => {
    setDraftContent(value);
    setSaveMessage(null);
    setSaveError(null);
  };

  const startProducedEdit = () => {
    if (!selectedDbFile || !dbDetailData?.file) return;
    setEditorTarget({ kind: "produced", issueId: selectedDbFile.issueId, key: selectedDbFile.key });
    setDraftContent(selectedProducedContent);
    setSaveMessage(null);
    setSaveError(null);
  };

  const startCompanyEdit = () => {
    if (!selectedDirFile || !canEditCompanyFile) return;
    setEditorTarget({ kind: "company", path: selectedDirFile.path });
    setDraftContent(selectedCompanyContent);
    setSaveMessage(null);
    setSaveError(null);
  };

  const cancelEdit = () => {
    if (isEditingProducedFile) {
      setDraftContent(selectedProducedContent);
    } else if (isEditingCompanyFile) {
      setDraftContent(selectedCompanyContent);
    } else {
      setDraftContent("");
    }
    setEditorTarget(null);
    setSaveMessage(null);
    setSaveError(null);
  };

  const saveEdit = async () => {
    if (!editorTarget || isSaving) return;
    setIsSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      if (editorTarget.kind === "produced") {
        await saveProducedFile({
          companyId,
          issueId: editorTarget.issueId,
          key: editorTarget.key,
          body: draftContent,
        });
        refreshDbDetail();
      } else {
        await saveCompanyFile({
          companyId,
          relativePath: editorTarget.path,
          content: draftContent,
        });
        refreshDirFileContent();
      }
      setEditorTarget(null);
      setDraftContent("");
      setSaveMessage("Saved");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Create a map of agentId -> agentName
  const agentMap = useMemo(() => {
    const map = new Map<string, string>();
    agents.forEach((a: { id: string; name: string }) => map.set(a.id, a.name));
    return map;
  }, [agents]);

  // Filter Produced Files
  const filteredDbFiles = useMemo(() => {
    return dbFiles.filter((file) => {
      // Must be created by agent
      if (!file.createdByAgentId) return false;

      // Agent selector
      if (selectedAgentId !== "all" && file.createdByAgentId !== selectedAgentId) {
        return false;
      }

      // Search match
      if (searchQuery) {
        const searchLower = searchQuery.toLowerCase();
        return (
          file.key.toLowerCase().includes(searchLower) ||
          (file.title && file.title.toLowerCase().includes(searchLower)) ||
          file.issueIdentifier.toLowerCase().includes(searchLower) ||
          file.issueTitle.toLowerCase().includes(searchLower)
        );
      }

      return true;
    });
  }, [dbFiles, selectedAgentId, searchQuery]);

  // Construct Physical File Tree
  const treeRoot = useMemo(() => {
    return buildTree(dirData?.entries ?? []);
  }, [dirData?.entries]);

  return (
    <div className="flex h-[calc(100vh-8rem)] min-h-[500px] gap-4" style={{ fontFamily: "Inter, sans-serif" }}>
      {/* Left Sidebar Pane */}
      <div className="flex w-80 flex-col rounded-lg border border-border bg-card p-4 shadow-sm overflow-hidden">
        {/* Navigation Tabs */}
        <div className="flex border-b border-border mb-4">
          <button
            onClick={() => setActiveTab("produced")}
            className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "produced"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Produced Files
          </button>
          <button
            onClick={() => setActiveTab("company")}
            className={`flex-1 pb-2 text-xs font-semibold border-b-2 transition-all ${
              activeTab === "company"
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            Company Files
          </button>
        </div>

        {/* Tab 1: Produced Files */}
        {activeTab === "produced" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Agent Selector Dropdown */}
            <div className="mb-3">
              <label className="text-[10px] uppercase font-bold text-muted-foreground block mb-1">
                Filter by Agent
              </label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="w-full rounded-md border border-input bg-card px-2 py-1.5 text-xs shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring text-foreground"
                style={{ colorScheme: "dark" }}
              >
                <option value="all">All Agents</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Search */}
            <div className="relative mb-3 shrink-0">
              <input
                type="text"
                placeholder="Search produced files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md border border-input bg-transparent px-3 py-1.5 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {dbLoading ? (
                <div className="text-xs text-muted-foreground text-center py-8">Loading produced files...</div>
              ) : filteredDbFiles.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">No produced files found</div>
              ) : (
                filteredDbFiles.map((file) => {
                  const isSelected = selectedDbFile?.issueId === file.issueId && selectedDbFile?.key === file.key;
                  const creatorName = file.createdByAgentId
                    ? agentMap.get(file.createdByAgentId) || "Agent"
                    : "Agent";

                  return (
                    <div
                      key={`${file.issueId}-${file.key}`}
                      onClick={() => setSelectedDbFile({ issueId: file.issueId, key: file.key })}
                      className={`group relative flex flex-col rounded-md p-3 text-left transition-colors cursor-pointer border ${
                        isSelected
                          ? "bg-accent border-accent text-accent-foreground"
                          : "hover:bg-accent/40 border-transparent hover:border-accent/10"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <span className="font-semibold text-xs truncate flex-1">
                          {file.title || file.key}
                        </span>
                        <span className="text-[9px] uppercase font-bold text-muted-foreground px-1 bg-muted rounded border border-border group-hover:border-foreground/10 shrink-0">
                          {file.format}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/75 font-mono">
                        <FolderIcon size={10} className="shrink-0 text-muted-foreground/50" />
                        <span className="truncate" title={file.path}>{file.path}</span>
                      </div>

                      <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground group-hover:text-foreground/80">
                        <IssueIcon size={10} />
                        <span className="truncate max-w-[150px]" title={file.issueTitle}>
                          {file.issueIdentifier}: {file.issueTitle}
                        </span>
                      </div>

                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/40 text-[9px] text-muted-foreground">
                        <span className="flex items-center gap-1 font-medium">
                          <AgentIcon size={9} />
                          {creatorName}
                        </span>
                        <span>
                          {new Date(file.updatedAt).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Company Files */}
        {activeTab === "company" && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Top Workspace Path Info */}
            {dirData?.cwd && (
              <div className="mb-3 px-2 py-1.5 bg-muted/40 rounded border border-border/60 text-[10px] text-muted-foreground truncate">
                <span className="font-bold text-foreground block">Workspace Directory:</span>
                {dirData.cwd}
              </div>
            )}

            {/* Tree Explorer */}
            <div className="flex-1 overflow-y-auto space-y-0.5 pr-1">
              {dirLoading ? (
                <div className="text-xs text-muted-foreground text-center py-8">Loading directory...</div>
              ) : Object.keys(treeRoot.children).length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-8">No files found in workspace</div>
              ) : (
                <FileTreeNode
                  node={treeRoot}
                  depth={0}
                  expandedPaths={expandedPaths}
                  togglePath={togglePath}
                  selectedPath={selectedDirFile?.path}
                  onSelectFile={(node) => setSelectedDirFile({ path: node.path, name: node.name })}
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right Content Pane */}
      <div className="flex-1 flex flex-col rounded-lg border border-border bg-card overflow-hidden shadow-sm">
        {activeTab === "produced" ? (
          // DB PREVIEW
          selectedDbFile ? (
            dbDetailLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Loading produced file...
              </div>
            ) : dbDetailData?.file ? (
              <>
                {/* Header */}
                <div className="border-b border-border bg-muted/30 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
                  <div>
                    <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                      <FilesIcon size={18} className="text-primary" />
                      {dbDetailData.file.title || dbDetailData.file.key}
                    </h1>
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
                        Path: <code className="font-semibold text-foreground">{dbDetailData.file.path}</code>
                      </span>
                      <span className="flex items-center gap-1">
                        <AgentIcon size={12} />
                        Created by Agent: <strong className="text-foreground">{agentMap.get(dbDetailData.file.createdByAgentId || "") || "Unknown Agent"}</strong>
                      </span>
                      <span>•</span>
                      <span>Updated: {new Date(dbDetailData.file.updatedAt).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                    {isEditingProducedFile ? (
                      <>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          className="inline-flex items-center justify-center rounded-md text-xs font-semibold h-8 px-3 border border-border bg-background hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={isSaving}
                          className="inline-flex items-center justify-center rounded-md text-xs font-semibold h-8 px-3 border border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </button>
                      </>
                    ) : canEditProducedFile ? (
                      <button
                        type="button"
                        onClick={startProducedEdit}
                        className="inline-flex items-center justify-center rounded-md text-xs font-semibold h-8 px-3 border border-border bg-background hover:bg-accent transition-colors"
                      >
                        Edit
                      </button>
                    ) : null}
                    <button
                      onClick={() => navigate(`/issues/${selectedDbFile.issueId}`)}
                      className="inline-flex items-center justify-center rounded-md text-xs font-semibold h-8 px-3 border border-border bg-background hover:bg-accent transition-colors"
                    >
                      <IssueIcon size={11} className="mr-1.5" />
                      View Original Issue
                    </button>
                  </div>
                </div>

                {(isEditingProducedFile || saveMessage || saveError) && (
                  <div className="border-b border-border px-4 py-2 text-xs">
                    {saveError ? (
                      <span className="text-destructive">{saveError}</span>
                    ) : saveMessage ? (
                      <span className="text-emerald-600">{saveMessage}</span>
                    ) : (
                      <span className="text-muted-foreground">Unsaved edits</span>
                    )}
                  </div>
                )}

                {/* Content body */}
                <div className="flex-1 overflow-y-auto p-6 bg-background/50 flex flex-col items-center justify-start">
                  {isEditingProducedFile ? (
                    <div className="w-full">
                      <MarkdownEditor
                        value={draftContent}
                        onChange={handleDraftChange}
                        bordered
                        className="w-full"
                        contentClassName="min-h-[54vh]"
                      />
                    </div>
                  ) : dbDetailData.file.body ? (
                    ["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(dbDetailData.file.format.toLowerCase()) ? (
                      <div className="max-w-full flex items-center justify-center p-4 bg-muted/20 rounded-lg border border-border/50 shadow-inner">
                        <img
                          src={dbDetailData.file.body.startsWith("data:") ? dbDetailData.file.body : `data:image/${dbDetailData.file.format.toLowerCase()};base64,${dbDetailData.file.body}`}
                          alt={dbDetailData.file.title || dbDetailData.file.key}
                          className="max-w-full h-auto max-h-[70vh] rounded-md object-contain shadow-md"
                        />
                      </div>
                    ) : (
                      <div className="prose dark:prose-invert max-w-none w-full">
                        <MarkdownBlock content={dbDetailData.file.body} />
                      </div>
                    )
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-12 italic w-full">
                      This file has no content.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-destructive">
                {dbDetailData?.error || "Error loading file content"}
              </div>
            )
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
              <FilesIcon size={40} className="stroke-[1.5] text-muted-foreground/40 mb-3" />
              <h3 className="text-sm font-semibold text-foreground mb-1">No Produced File Selected</h3>
              <p className="text-xs text-center max-w-xs">
                Select an agent-produced file from the list on the left to view its contents and metadata.
              </p>
            </div>
          )
        ) : (
          // PHYSICAL DIR FILE PREVIEW
          selectedDirFile ? (
            dirFileContentLoading ? (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Loading physical file...
              </div>
            ) : dirFileContentData ? (
              <>
                {/* Header */}
                <div className="border-b border-border bg-muted/30 p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 shrink-0">
                  <div>
                    <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
                      <FilesIcon size={18} className="text-primary" />
                      {selectedDirFile.name}
                    </h1>
                    <div className="flex flex-wrap items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1 bg-muted px-2 py-0.5 rounded border border-border">
                        Path: <code className="font-semibold text-foreground">{selectedDirFile.path}</code>
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
                    {isEditingCompanyFile ? (
                      <>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          disabled={isSaving}
                          className="inline-flex items-center justify-center rounded-md text-xs font-semibold h-8 px-3 border border-border bg-background hover:bg-accent transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveEdit()}
                          disabled={isSaving}
                          className="inline-flex items-center justify-center rounded-md text-xs font-semibold h-8 px-3 border border-primary bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isSaving ? "Saving..." : "Save"}
                        </button>
                      </>
                    ) : canEditCompanyFile ? (
                      <button
                        type="button"
                        onClick={startCompanyEdit}
                        className="inline-flex items-center justify-center rounded-md text-xs font-semibold h-8 px-3 border border-border bg-background hover:bg-accent transition-colors"
                      >
                        Edit
                      </button>
                    ) : null}
                  </div>
                </div>

                {(isEditingCompanyFile || saveMessage || saveError) && (
                  <div className="border-b border-border px-4 py-2 text-xs">
                    {saveError ? (
                      <span className="text-destructive">{saveError}</span>
                    ) : saveMessage ? (
                      <span className="text-emerald-600">{saveMessage}</span>
                    ) : (
                      <span className="text-muted-foreground">Unsaved edits</span>
                    )}
                  </div>
                )}

                {/* Content body */}
                <div className="flex-1 overflow-y-auto p-6 bg-background/50 flex flex-col items-center justify-start">
                  {isEditingCompanyFile ? (
                    <div className="w-full">
                      <MarkdownEditor
                        value={draftContent}
                        onChange={handleDraftChange}
                        bordered
                        className="w-full"
                        contentClassName="min-h-[54vh]"
                      />
                    </div>
                  ) : dirFileContentData.error ? (
                    <div className="text-sm text-destructive text-center py-12 w-full">
                      Error: {dirFileContentData.error}
                    </div>
                  ) : dirFileContentData.isBinary ? (
                    dirFileContentData.mimeType?.startsWith("image/") ? (
                      <div className="max-w-full flex items-center justify-center p-4 bg-muted/20 rounded-lg border border-border/50 shadow-inner">
                        <img
                          src={`data:${dirFileContentData.mimeType};base64,${dirFileContentData.content}`}
                          alt={selectedDirFile.name}
                          className="max-w-full h-auto max-h-[70vh] rounded-md object-contain shadow-md"
                        />
                      </div>
                    ) : dirFileContentData.mimeType?.startsWith("video/") ? (
                      <div className="max-w-full flex items-center justify-center p-4 bg-muted/20 rounded-lg border border-border/50 shadow-inner">
                        <video
                          controls
                          src={`data:${dirFileContentData.mimeType};base64,${dirFileContentData.content}`}
                          className="max-w-full h-auto max-h-[70vh] rounded-md shadow-md"
                        />
                      </div>
                    ) : dirFileContentData.mimeType?.startsWith("audio/") ? (
                      <div className="w-full flex items-center justify-center p-8 bg-muted/20 rounded-lg border border-border/50">
                        <audio
                          controls
                          src={`data:${dirFileContentData.mimeType};base64,${dirFileContentData.content}`}
                          className="w-full max-w-md"
                        />
                      </div>
                    ) : dirFileContentData.mimeType === "application/pdf" ? (
                      <iframe
                        src={`data:${dirFileContentData.mimeType};base64,${dirFileContentData.content}`}
                        className="w-full h-[70vh] rounded-md border border-border shadow-md"
                        title={selectedDirFile.name}
                      />
                    ) : (
                      <div className="text-sm text-muted-foreground text-center py-12 italic w-full">
                        This file format ({dirFileContentData.mimeType}) is not supported for in-app preview.
                      </div>
                    )
                  ) : dirFileContentData.content !== undefined ? (
                    selectedDirFile.name.endsWith(".json") ? (
                      <pre className="text-xs font-mono bg-muted p-4 rounded overflow-auto border border-border w-full align-self-stretch">
                        {dirFileContentData.content}
                      </pre>
                    ) : (
                      <div className="prose dark:prose-invert max-w-none w-full">
                        <MarkdownBlock content={dirFileContentData.content} />
                      </div>
                    )
                  ) : (
                    <div className="text-sm text-muted-foreground text-center py-12 italic w-full">
                      This file has no content.
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-destructive">
                Error loading physical file
              </div>
            )
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground p-8">
              <FolderIcon size={40} className="stroke-[1.5] text-muted-foreground/40 mb-3" />
              <h3 className="text-sm font-semibold text-foreground mb-1">No Company File Selected</h3>
              <p className="text-xs text-center max-w-xs">
                Select a physical file from the workspace directory tree on the left to preview it.
              </p>
            </div>
          )
        )}
      </div>
    </div>
  );
}
