import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RegistryPalette } from "../RegistryPalette";

const controller = {
  listTools: () => [
    {
      name: "select_shapes",
      description: "Select shapes",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
    },
  ],
  executeTool: vi.fn(async () => ({ ok: true })),
};
const snapshot = { selectedIds: [], pending: null, ledger: [] };

describe("RegistryPalette keyboard lifecycle", () => {
  it("opens with Ctrl-K and restores focus after Escape", async () => {
    render(
      <>
        <button type="button">Original focus</button>
        <RegistryPalette
          controller={controller as never}
          snapshot={snapshot as never}
        />
      </>,
    );
    const original = screen.getByRole("button", { name: "Original focus" });
    original.focus();

    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const firstTool = await screen.findByRole("button", {
      name: "select_shapes",
    });
    await waitFor(() => expect(firstTool).toHaveFocus());

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(original).toHaveFocus());
  });

  it("opens with Cmd-K but ignores the shortcut from writable controls", () => {
    render(
      <>
        <input aria-label="External input" />
        <RegistryPalette
          controller={controller as never}
          snapshot={snapshot as never}
        />
      </>,
    );
    const input = screen.getByLabelText("External input");
    input.focus();
    fireEvent.keyDown(input, { key: "k", metaKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("does not retain duplicate active shortcuts through StrictMode lifecycle", () => {
    render(
      <StrictMode>
        <RegistryPalette
          controller={controller as never}
          snapshot={snapshot as never}
        />
      </StrictMode>,
    );
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("claims an accepted shortcut before the host application can handle it", () => {
    let hostShortcutCount = 0;
    const hostHandler = () => {
      hostShortcutCount += 1;
    };
    document.addEventListener("keydown", hostHandler, { capture: true });
    render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
    document.removeEventListener("keydown", hostHandler, { capture: true });

    expect(
      screen.getByRole("dialog", { name: "WebMCP commands" }),
    ).toBeTruthy();
    expect(hostShortcutCount).toBe(0);
  });
});
