// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => {
  const state = {
    producedBody: "Persisted produced content",
    companyBody: "Persisted company content",
    navigate: vi.fn(),
    refreshProduced: vi.fn(),
    refreshCompany: vi.fn(),
    saveProduced: vi.fn(),
    saveCompany: vi.fn(),
  };

  state.saveProduced = vi.fn(async (params: Record<string, unknown>) => {
    state.producedBody = String(params.body);
    return { ok: true, file: { body: state.producedBody } };
  });
  state.saveCompany = vi.fn(async (params: Record<string, unknown>) => {
    state.companyBody = String(params.content);
    return { ok: true, path: params.relativePath };
  });

  return state;
});

vi.mock("@paperclipai/plugin-sdk/ui", async () => {
  const { createElement } = await import("react");

  return {
    useHostContext: () => ({ companyId: "comp-1" }),
    useHostNavigation: () => ({ navigate: mockState.navigate }),
    usePluginAction: (key: string) => {
      if (key === "save-company-file-details") return mockState.saveProduced;
      if (key === "save-company-directory-file-content") return mockState.saveCompany;
      return vi.fn();
    },
    usePluginData: (key: string, params?: Record<string, unknown>) => {
      if (key === "list-company-files") {
        return {
          data: {
            files: [
              {
                issueDocumentId: "doc-rel-1",
                issueId: "issue-1",
                key: "notes.md",
                path: "notes.md",
                title: "Notes",
                format: "markdown",
                createdAt: "2026-05-28T12:00:00.000Z",
                updatedAt: "2026-05-28T12:00:00.000Z",
                createdByAgentId: "agent-1",
                createdByUserId: null,
                issueIdentifier: "QUI-1",
                issueTitle: "Produce notes",
              },
            ],
            agents: [{ id: "agent-1", name: "CRM Integration Engineer" }],
          },
          loading: false,
          refresh: vi.fn(),
        };
      }

      if (key === "list-company-directory-files") {
        return {
          data: {
            cwd: "/workspace",
            entries: [
              {
                path: "company/knowledge/company.md",
                name: "company.md",
                kind: "file",
                size: 256,
                modifiedAt: "2026-05-28T12:00:00.000Z",
              },
            ],
          },
          loading: false,
          refresh: vi.fn(),
        };
      }

      if (key === "get-company-file-details") {
        const selected = Boolean(params?.issueId && params?.key);
        return {
          data: selected
            ? {
                file: {
                  id: "doc-1",
                  key: "notes.md",
                  path: "notes.md",
                  title: "Notes",
                  format: "markdown",
                  body: mockState.producedBody,
                  createdAt: "2026-05-28T12:00:00.000Z",
                  updatedAt: "2026-05-28T12:00:00.000Z",
                  createdByAgentId: "agent-1",
                  createdByUserId: null,
                },
              }
            : undefined,
          loading: false,
          refresh: mockState.refreshProduced,
        };
      }

      if (key === "get-company-directory-file-content") {
        const selected = Boolean(params?.relativePath);
        return {
          data: selected ? { content: mockState.companyBody, isBinary: false } : undefined,
          loading: false,
          refresh: mockState.refreshCompany,
        };
      }

      return { data: undefined, loading: false, refresh: vi.fn() };
    },
    MarkdownBlock: ({ content }: { content: string }) =>
      createElement("div", { "data-testid": "markdown-block" }, content),
    MarkdownEditor: ({
      value,
      onChange,
    }: {
      value: string;
      onChange: (value: string) => void;
    }) =>
      createElement("textarea", {
        "data-testid": "markdown-editor",
        value,
        onChange: (event: { currentTarget: { value: string } }) => onChange(event.currentTarget.value),
      }),
  };
});

import { CompanyFilesPage } from "../src/ui/index.js";

function buttonByText(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent?.trim() === text,
  );

  if (!button) throw new Error(`Button not found: ${text}`);

  return button as HTMLButtonElement;
}

function producedFileCard(container: HTMLElement) {
  const card = Array.from(container.querySelectorAll(".cursor-pointer")).find((element) =>
    element.textContent?.includes("Notes"),
  );

  if (!card) throw new Error("Produced file card not found");

  return card as HTMLElement;
}

function companyFileRow(container: HTMLElement) {
  const row = Array.from(container.querySelectorAll(".cursor-pointer")).find((element) =>
    element.textContent?.includes("company.md"),
  );

  if (!row) throw new Error("Company file row not found");

  return row as HTMLElement;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function changeTextarea(container: HTMLElement, value: string) {
  const textarea = container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]');
  if (!textarea) throw new Error("Markdown editor not found");

  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    valueSetter?.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("CompanyFilesPage edit controls", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mockState.producedBody = "Persisted produced content";
    mockState.companyBody = "Persisted company content";
    mockState.navigate.mockClear();
    mockState.refreshProduced.mockClear();
    mockState.refreshCompany.mockClear();
    mockState.saveProduced.mockClear();
    mockState.saveCompany.mockClear();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps produced edits local until Save and returns to the refreshed preview after saving", async () => {
    await act(async () => {
      root.render(createElement(CompanyFilesPage));
    });

    await click(producedFileCard(container));
    expect(container.querySelector('[data-testid="markdown-block"]')?.textContent).toContain(
      "Persisted produced content",
    );

    await click(buttonByText(container, "Edit"));
    await changeTextarea(container, "Saved produced draft");

    expect(mockState.saveProduced).not.toHaveBeenCalled();

    await click(buttonByText(container, "Save"));

    expect(mockState.saveProduced).toHaveBeenCalledWith({
      companyId: "comp-1",
      issueId: "issue-1",
      key: "notes.md",
      body: "Saved produced draft",
    });
    expect(mockState.refreshProduced).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Saved");
    expect(container.querySelector('[data-testid="markdown-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="markdown-block"]')?.textContent).toContain(
      "Saved produced draft",
    );
  });

  it("cancels produced edits without saving and restores the persisted preview", async () => {
    await act(async () => {
      root.render(createElement(CompanyFilesPage));
    });

    await click(producedFileCard(container));
    await click(buttonByText(container, "Edit"));
    await changeTextarea(container, "Discarded produced draft");
    await click(buttonByText(container, "Cancel"));

    expect(mockState.saveProduced).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="markdown-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="markdown-block"]')?.textContent).toContain(
      "Persisted produced content",
    );
  });

  it("keeps company file edits local until Save and returns to the refreshed preview after saving", async () => {
    await act(async () => {
      root.render(createElement(CompanyFilesPage));
    });

    await click(buttonByText(container, "Company Files"));
    await click(companyFileRow(container));
    expect(container.querySelector('[data-testid="markdown-block"]')?.textContent).toContain(
      "Persisted company content",
    );

    await click(buttonByText(container, "Edit"));
    await changeTextarea(container, "Saved company draft");

    expect(mockState.saveCompany).not.toHaveBeenCalled();

    await click(buttonByText(container, "Save"));

    expect(mockState.saveCompany).toHaveBeenCalledWith({
      companyId: "comp-1",
      relativePath: "company/knowledge/company.md",
      content: "Saved company draft",
    });
    expect(mockState.refreshCompany).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Saved");
    expect(container.querySelector('[data-testid="markdown-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="markdown-block"]')?.textContent).toContain(
      "Saved company draft",
    );
  });

  it("cancels company file edits without saving and restores the persisted preview", async () => {
    await act(async () => {
      root.render(createElement(CompanyFilesPage));
    });

    await click(buttonByText(container, "Company Files"));
    await click(companyFileRow(container));
    await click(buttonByText(container, "Edit"));
    await changeTextarea(container, "Discarded company draft");
    await click(buttonByText(container, "Cancel"));

    expect(mockState.saveCompany).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="markdown-editor"]')).toBeNull();
    expect(container.querySelector('[data-testid="markdown-block"]')?.textContent).toContain(
      "Persisted company content",
    );
  });

  it("keeps company file drafts open and reports Save failures", async () => {
    mockState.saveCompany.mockRejectedValueOnce(new Error("Write failed"));

    await act(async () => {
      root.render(createElement(CompanyFilesPage));
    });

    await click(buttonByText(container, "Company Files"));
    await click(companyFileRow(container));
    await click(buttonByText(container, "Edit"));
    await changeTextarea(container, "Unsaved company draft");
    await click(buttonByText(container, "Save"));

    expect(mockState.refreshCompany).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Write failed");
    expect(container.querySelector('[data-testid="markdown-editor"]')).not.toBeNull();
    expect(container.querySelector<HTMLTextAreaElement>('[data-testid="markdown-editor"]')?.value).toBe(
      "Unsaved company draft",
    );
  });
});
