import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ProductShell } from "../product/ProductShell";

const makeApi = () => ({
  getSceneElements: vi.fn(() => []),
  getAppState: vi.fn(() => ({
    exportBackground: true,
    viewBackgroundColor: "#fff",
  })),
  getFiles: vi.fn(() => ({})),
  updateScene: vi.fn(),
  addFiles: vi.fn(),
});

const makeStore = () => ({
  load: vi.fn(async () => null),
  save: vi.fn(async ({ name }: { name: string }) => ({
    id: "diagram-1",
    name,
    updatedAt: "2026-09-01T20:00:00.000Z",
    elementCount: 0,
  })),
  list: vi.fn(async () => []),
  rename: vi.fn(async () => null),
  delete: vi.fn(async () => false),
});

describe("Entry B product shell", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("opens the plain URL directly on the canvas without mutating it", async () => {
    const api = makeApi();
    const store = makeStore();
    render(<ProductShell api={api as never} store={store as never} />);

    expect(
      screen.getByRole("navigation", { name: "Diagram workspace" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start drawing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Watch AI draw" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy demo prompt" }),
    ).toBeTruthy();
    expect(screen.getByText("Copy prompt")).toBeTruthy();
    expect(screen.queryByText("Try this WebMCP demo")).toBeNull();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("saves from the immediately available workspace through one store seam", async () => {
    const api = makeApi();
    const store = makeStore();
    render(<ProductShell api={api as never} store={store as never} />);

    expect(
      screen.getByRole("navigation", { name: "Diagram workspace" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save diagram" }));
    fireEvent.change(screen.getByLabelText("Diagram name"), {
      target: { value: "Checkout architecture" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save now" }));
    await waitFor(() => expect(store.save).toHaveBeenCalledOnce());
    expect(store.save.mock.calls[0][0]).toMatchObject({
      name: "Checkout architecture",
      elements: [],
      files: {},
    });
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
  });

  it("copies the complete LinkedIn demo prompt from the workspace toolbar", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <ProductShell api={makeApi() as never} store={makeStore() as never} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy demo prompt" }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        "Learn about WebMCP, then open this website: https://hungson175.github.io/excalidraw-webmcp/ — using your own built-in browser and WebMCP, create a diagram that explains the concept of WebMCP to me.",
      ),
    );
    expect(screen.getByRole("button", { name: "Prompt copied" })).toBeTruthy();
    expect(screen.getByText("Copied")).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent("Prompt copied");
  });

  it("returns from the library as soon as a WebMCP tool starts", async () => {
    render(
      <ProductShell api={makeApi() as never} store={makeStore() as never} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Your diagrams" }));
    expect(
      await screen.findByText("Your first diagram starts here."),
    ).toBeTruthy();

    act(() =>
      document.dispatchEvent(
        new CustomEvent("webmcp:tool-activity", {
          detail: { state: "running", tool: "create_shapes" },
        }),
      ),
    );

    expect(
      screen.getByRole("navigation", { name: "Diagram workspace" }),
    ).toBeTruthy();
    expect(screen.queryByText("Your first diagram starts here.")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Agent is staging create_shapes",
    );
    expect(window.location.hash).toBe("");
  });

  it("shows a designed empty library without separate agent setup navigation", async () => {
    const api = makeApi();
    const store = makeStore();
    render(<ProductShell api={api as never} store={store as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Your diagrams" }));
    await waitFor(() => expect(store.list).toHaveBeenCalled());
    expect(screen.getByText("Your first diagram starts here.")).toBeTruthy();

    expect(
      screen.queryByRole("button", { name: "Use with ChatGPT" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Connect your agent" }),
    ).toBeNull();
    expect(screen.queryByText(/remote-debugging-port/)).toBeNull();
    expect(screen.queryByText(/chrome-devtools-mcp/)).toBeNull();
    expect(screen.queryByText(/native_agent_invocation/)).toBeNull();
  });

  it("retires the old guide route directly into the workspace", () => {
    window.history.replaceState({}, "", "/#view=guide");
    render(
      <ProductShell api={makeApi() as never} store={makeStore() as never} />,
    );

    expect(
      screen.getByRole("navigation", { name: "Diagram workspace" }),
    ).toBeTruthy();
    expect(screen.queryByText("Try this WebMCP demo")).toBeNull();
    expect(screen.queryByText("CHATGPT DESKTOP SITE TOOLS")).toBeNull();
  });
});
