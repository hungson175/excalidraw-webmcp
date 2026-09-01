import {
  CaptureUpdateAction,
  exportToBlob,
  MIME_TYPES,
} from "@excalidraw/excalidraw";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import {
  WEBMCP_TOOL_ACTIVITY_EVENT,
  type WebMCPToolActivity,
} from "../tool_activity";

import {
  getLocalDiagramStore,
  type DiagramStore,
  type DiagramSummary,
  type StoredElement,
  type StoredFiles,
} from "./diagram_store";
import {
  decodeSharedScene,
  encodeSharedScene,
  shareFragment,
} from "./share_scene";
import "./ProductShell.scss";

type ProductShellProps = {
  api: ExcalidrawImperativeAPI;
  store?: DiagramStore;
};

type ProductView = "landing" | "workspace" | "library";

const readRoute = () => {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const requested = params.get("view");
  const view: ProductView = params.has("share")
    ? "workspace"
    : requested === "workspace" || requested === "library"
    ? requested
    : "landing";
  return { view, share: params.get("share") };
};

const sceneElements = (api: ExcalidrawImperativeAPI) =>
  api
    .getSceneElements()
    .filter(({ isDeleted }) => !isDeleted) as unknown as StoredElement[];

const sceneFiles = (api: ExcalidrawImperativeAPI) =>
  api.getFiles() as unknown as StoredFiles;

const safeFilename = (name: string) =>
  `${
    name
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "")
      .slice(0, 60) || "diagram"
  }.png`;

export const ProductShell = ({
  api,
  store: suppliedStore,
}: ProductShellProps) => {
  const store = useMemo(
    () => suppliedStore ?? getLocalDiagramStore(),
    [suppliedStore],
  );
  const initialRoute = useMemo(readRoute, []);
  const [view, setView] = useState<ProductView>(initialRoute.view);
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState("Untitled diagram");
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [status, setStatus] = useState("Ready");
  const [shareUrl, setShareUrl] = useState("");
  const importedShare = useRef<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const go = useCallback((next: ProductView) => {
    const params = new URLSearchParams();
    if (next !== "landing") {
      params.set("view", next);
    }
    const fragment = params.toString();
    window.history.pushState(
      {},
      "",
      `${window.location.pathname}${window.location.search}${
        fragment ? `#${fragment}` : ""
      }`,
    );
    setView(next);
    setStatus("Ready");
  }, []);

  useEffect(() => {
    const routeChanged = () => setView(readRoute().view);
    window.addEventListener("hashchange", routeChanged);
    window.addEventListener("popstate", routeChanged);
    return () => {
      window.removeEventListener("hashchange", routeChanged);
      window.removeEventListener("popstate", routeChanged);
    };
  }, []);

  useLayoutEffect(() => {
    const ownerDocument = rootRef.current?.ownerDocument;
    const ownerWindow = ownerDocument?.defaultView;
    if (!ownerDocument || !ownerWindow) {
      return;
    }
    const revealAgentWorkspace = (event: Event) => {
      const detail = (event as CustomEvent<WebMCPToolActivity>).detail;
      if (
        detail?.state !== "running" ||
        typeof detail.tool !== "string" ||
        !detail.tool
      ) {
        return;
      }
      const params = new URLSearchParams();
      params.set("view", "workspace");
      ownerWindow.history.replaceState(
        {},
        "",
        `${ownerWindow.location.pathname}${ownerWindow.location.search}#${params}`,
      );
      setView("workspace");
      setStatus(`Agent is staging ${detail.tool}…`);
    };
    ownerDocument.addEventListener(
      WEBMCP_TOOL_ACTIVITY_EVENT,
      revealAgentWorkspace,
    );
    return () =>
      ownerDocument.removeEventListener(
        WEBMCP_TOOL_ACTIVITY_EVENT,
        revealAgentWorkspace,
      );
  }, []);

  useEffect(() => {
    const { share } = readRoute();
    if (!share || importedShare.current === share) {
      return;
    }
    const decoded = decodeSharedScene(share);
    if (!decoded.ok) {
      importedShare.current = share;
      setStatus(decoded.message);
      return;
    }
    const applySharedScene = () => {
      if (api.getAppState().isLoading) {
        return false;
      }
      api.addFiles(decoded.scene.files as never);
      api.updateScene({
        elements: decoded.scene.elements as never,
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
      importedShare.current = share;
      setName(decoded.scene.name ?? "Shared diagram");
      setCurrentId(undefined);
      setStatus("Shared diagram opened locally");
      return true;
    };
    if (applySharedScene()) {
      return;
    }
    setStatus("Opening shared diagram…");
    let unsubscribe: () => void = () => undefined;
    unsubscribe = api.onChange(() => {
      if (applySharedScene()) {
        unsubscribe();
      }
    });
    return unsubscribe;
  }, [api, view]);

  const refreshDiagrams = useCallback(async () => {
    setDiagrams(await store.list());
  }, [store]);

  useEffect(() => {
    if (view === "library") {
      void refreshDiagrams();
    }
  }, [refreshDiagrams, view]);

  const saveDiagram = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const saved = await store.save({
        ...(currentId ? { id: currentId } : {}),
        name,
        elements: sceneElements(api),
        files: sceneFiles(api),
      });
      setCurrentId(saved.id);
      setName(saved.name);
      setStatus("Saved to this browser");
      setSaveOpen(false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Save failed safely");
    }
  };

  const openDiagram = async (id: string) => {
    const record = await store.load(id);
    if (!record) {
      setStatus("That saved diagram is no longer available");
      await refreshDiagrams();
      return;
    }
    api.addFiles(record.files as never);
    api.updateScene({ elements: record.elements as never });
    setCurrentId(record.id);
    setName(record.name);
    go("workspace");
    setStatus(`Opened ${record.name}`);
  };

  const renameDiagram = async (id: string) => {
    try {
      const renamed = await store.rename(id, editingName);
      if (!renamed) {
        setStatus("That saved diagram is no longer available");
      } else {
        setStatus("Diagram renamed");
      }
      setEditingId(null);
      await refreshDiagrams();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Rename failed safely",
      );
    }
  };

  const deleteDiagram = async (id: string) => {
    const deleted = await store.delete(id);
    setDeleteId(null);
    setStatus(deleted ? "Diagram deleted" : "Diagram was already unavailable");
    await refreshDiagrams();
  };

  const createShareLink = async () => {
    try {
      const token = encodeSharedScene({
        name,
        elements: sceneElements(api),
        files: sceneFiles(api),
      });
      const url = `${window.location.href.split("#")[0]}${shareFragment(
        token,
      )}`;
      setShareUrl(url);
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setStatus("Share link copied — the diagram is inside the URL");
      } else {
        setStatus("Share link ready — copy it below");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Share failed safely");
    }
  };

  const exportPng = async () => {
    const elements = api
      .getSceneElements()
      .filter(({ isDeleted }) => !isDeleted);
    if (!elements.length) {
      setStatus("Draw something before exporting");
      return;
    }
    try {
      const blob = await exportToBlob({
        elements: elements as never,
        appState: {
          ...api.getAppState(),
          exportBackground: true,
        } as never,
        files: api.getFiles(),
        mimeType: MIME_TYPES.png,
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = safeFilename(name);
      anchor.click();
      URL.revokeObjectURL(url);
      setStatus("PNG exported");
    } catch {
      setStatus("Image export failed safely");
    }
  };

  return (
    <div ref={rootRef} className="product-shell" data-product-view={view}>
      {view === "landing" ? (
        <main className="product-shell__landing">
          <nav aria-label="Product">
            <span className="product-shell__brand">
              <span aria-hidden="true">◇</span> Canvas Agent
            </span>
          </nav>
          <section>
            <p className="product-shell__eyebrow">
              YOUR CANVAS. YOUR AGENT. SAME TIME.
            </p>
            <h1>Draw by hand. Shape it with your own AI.</h1>
            <p className="product-shell__lede">
              A complete Excalidraw workspace where your local coding agent
              creates and edits real objects without taking your cursor.
            </p>
            <div className="product-shell__hero-actions">
              <button
                className="is-primary"
                type="button"
                onClick={() => go("workspace")}
              >
                Start drawing
              </button>
            </div>
            <ul aria-label="Product promises">
              <li>No account</li>
              <li>No backend</li>
              <li>Human-only commit</li>
            </ul>
            <aside
              className="product-shell__chatgpt-guide"
              aria-labelledby="chatgpt-guide-title"
            >
              <h2 id="chatgpt-guide-title">Try this WebMCP demo</h2>
              <ol>
                <li>Open the ChatGPT Desktop app.</li>
                <li>Open Codex and select Sol or Terra.</li>
                <li>Paste this prompt:</li>
              </ol>
              <blockquote>
                Learn about WebMCP, then open this website:
                https://hungson175.github.io/excalidraw-webmcp/ — using your own
                built-in browser and WebMCP, create a diagram that explains the
                concept of WebMCP to me.
              </blockquote>
              <p>
                Wait while it draws. Click Commit layout, then edit the diagram
                by hand if you like.
              </p>
            </aside>
          </section>
          <footer>
            Local-first by design. Ignore every AI control and ordinary
            Excalidraw still works.
          </footer>
        </main>
      ) : (
        <nav
          className="product-shell__workspace-nav"
          aria-label="Diagram workspace"
        >
          <button
            type="button"
            className="product-shell__wordmark"
            onClick={() => go("landing")}
          >
            ◇ Canvas Agent
          </button>
          <div>
            <button type="button" onClick={() => go("library")}>
              Your diagrams
            </button>
            <button type="button" onClick={() => setSaveOpen(true)}>
              Save diagram
            </button>
            <button type="button" onClick={() => void createShareLink()}>
              Share link
            </button>
            <button type="button" onClick={() => void exportPng()}>
              Export PNG
            </button>
          </div>
        </nav>
      )}

      {view === "library" ? (
        <main
          className="product-shell__page"
          aria-labelledby="diagram-library-title"
        >
          <header>
            <p className="product-shell__eyebrow">LOCAL TO THIS BROWSER</p>
            <h1 id="diagram-library-title">Your diagrams</h1>
            <p>
              Open, rename, or delete your saved work. Nothing is sent to a
              server.
            </p>
          </header>
          {diagrams.length ? (
            <ul className="product-shell__diagram-grid">
              {diagrams.map((diagram) => (
                <li key={diagram.id}>
                  {editingId === diagram.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void renameDiagram(diagram.id);
                      }}
                    >
                      <label>
                        <span>New diagram name</span>
                        <input
                          value={editingName}
                          onChange={(event) =>
                            setEditingName(event.target.value)
                          }
                          maxLength={80}
                          autoFocus
                        />
                      </label>
                      <button type="submit">Save name</button>
                      <button type="button" onClick={() => setEditingId(null)}>
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <>
                      <strong>{diagram.name}</strong>
                      <span>{diagram.elementCount} visible objects</span>
                      <time dateTime={diagram.updatedAt}>
                        {new Date(diagram.updatedAt).toLocaleString()}
                      </time>
                      <div>
                        <button
                          type="button"
                          onClick={() => void openDiagram(diagram.id)}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingId(diagram.id);
                            setEditingName(diagram.name);
                          }}
                        >
                          Rename
                        </button>
                        {deleteId === diagram.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => void deleteDiagram(diagram.id)}
                            >
                              Confirm delete
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeleteId(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setDeleteId(diagram.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <section className="product-shell__empty">
              <span aria-hidden="true">◇</span>
              <h2>Your first diagram starts here.</h2>
              <p>Draw freely, then save a named copy to this browser.</p>
              <button
                className="is-primary"
                type="button"
                onClick={() => go("workspace")}
              >
                Open the canvas
              </button>
            </section>
          )}
        </main>
      ) : null}

      {saveOpen ? (
        <div className="product-shell__modal-backdrop">
          <form
            className="product-shell__modal"
            onSubmit={saveDiagram}
            aria-labelledby="save-title"
          >
            <h2 id="save-title">Save this diagram</h2>
            <p>Stored only in this browser. You can rename it later.</p>
            <label>
              <span>Diagram name</span>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                autoFocus
              />
            </label>
            <div>
              <button className="is-primary" type="submit">
                Save now
              </button>
              <button type="button" onClick={() => setSaveOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {shareUrl ? (
        <section className="product-shell__share" aria-label="Share link ready">
          <label>
            <span>Share URL</span>
            <input
              readOnly
              value={shareUrl}
              onFocus={(event) => event.currentTarget.select()}
            />
          </label>
          <a href={shareUrl} target="_blank" rel="noreferrer">
            Test link
          </a>
          <button
            type="button"
            aria-label="Close share link"
            onClick={() => setShareUrl("")}
          >
            ×
          </button>
        </section>
      ) : null}

      <output className="product-shell__status" aria-live="polite">
        {status}
      </output>
    </div>
  );
};
