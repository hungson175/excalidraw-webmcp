import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  it("makes the plain URL understandable without mutating the drawing", async () => {
    const api = makeApi();
    const store = makeStore();
    render(<ProductShell api={api as never} store={store as never} />);

    expect(
      screen.getByRole("heading", {
        name: "Draw by hand. Shape it with your own AI.",
      }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Start drawing" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Watch AI draw" })).toBeTruthy();
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(store.save).not.toHaveBeenCalled();
  });

  it("enters the full workspace and saves through the one store seam", async () => {
    const api = makeApi();
    const store = makeStore();
    render(<ProductShell api={api as never} store={store as never} />);

    fireEvent.click(screen.getByRole("button", { name: "Start drawing" }));
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

  it("shows a designed empty library and an honest agent setup guide", async () => {
    const api = makeApi();
    const store = makeStore();
    render(<ProductShell api={api as never} store={store as never} />);
    fireEvent.click(screen.getByRole("button", { name: "Start drawing" }));
    fireEvent.click(screen.getByRole("button", { name: "Your diagrams" }));
    await waitFor(() => expect(store.list).toHaveBeenCalled());
    expect(screen.getByText("Your first diagram starts here.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Connect your agent" }));
    expect(screen.getByText("LOCAL AGENT VIA CDP BRIDGE")).toBeTruthy();
    expect(screen.getByText(/remote-debugging-port/)).toBeTruthy();
    expect(screen.getByText("native_agent_invocation=UNPROVEN")).toBeTruthy();
  });
});
