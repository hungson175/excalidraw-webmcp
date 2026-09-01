import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RegistryPalette } from "../RegistryPalette";

const descriptors = [
  {
    name: "select_shapes",
    description: "Select shapes",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        type: { type: "string", enum: ["rectangle", "diamond"] },
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: "align_shapes",
    description: "Align shapes",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        edge: { type: "string", enum: ["left", "top"] },
      },
      required: ["edge"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "equalize_size",
    description: "Equalize shapes",
    inputSchema: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" } },
        dimension: { type: "string", enum: ["width", "height"] },
      },
      required: ["dimension"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
  {
    name: "connect_shapes",
    description: "Connect shapes",
    inputSchema: {
      type: "object",
      properties: {
        sourceIds: { type: "array", items: { type: "string" } },
        targetId: { type: "string" },
      },
      required: ["sourceIds", "targetId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false },
  },
];

const snapshot = {
  selectedIds: [],
  pending: null,
  ledger: [
    {
      sequence: 1,
      tool: "align_shapes",
      changedIds: ["private-shape-id-a", "private-shape-id-b"],
      outcome: "uncommitted",
    },
  ],
};

const makeController = () => ({
  listTools: vi.fn(() => descriptors),
  executeTool: vi.fn(
    async (
      _name: string,
      _args: unknown,
      _context: { signal: AbortSignal },
    ) => ({ ok: true, changedCount: 2 }),
  ),
});

const openPalette = () =>
  fireEvent.click(screen.getByRole("button", { name: /commands/i }));

describe("RegistryPalette", () => {
  it("renders the exact registry catalogue without a commit or discard tool", () => {
    const controller = makeController();
    render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    openPalette();
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>("[data-tool-name]"),
      ).map((button) => button.dataset.toolName),
    ).toEqual(descriptors.map(({ name }) => name));
    expect(screen.queryByRole("button", { name: /commit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();
  });

  it("turns schema array fields into string arrays before controller revalidation", async () => {
    const controller = makeController();
    render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    openPalette();
    fireEvent.click(screen.getByRole("button", { name: "connect_shapes" }));
    fireEvent.change(screen.getByLabelText("sourceIds"), {
      target: { value: "source-a, source-b\nsource-c" },
    });
    fireEvent.change(screen.getByLabelText("targetId"), {
      target: { value: "gateway" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));

    await waitFor(() =>
      expect(controller.executeTool).toHaveBeenCalledTimes(1),
    );
    expect(controller.executeTool.mock.calls[0][0]).toBe("connect_shapes");
    expect(controller.executeTool.mock.calls[0][1]).toEqual({
      sourceIds: ["source-a", "source-b", "source-c"],
      targetId: "gateway",
    });
  });

  it("blocks malformed array input before the controller call", () => {
    const controller = makeController();
    render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    openPalette();
    fireEvent.click(screen.getByRole("button", { name: "connect_shapes" }));
    fireEvent.change(screen.getByLabelText("sourceIds"), {
      target: { value: "source-a,,source-b" },
    });
    fireEvent.change(screen.getByLabelText("targetId"), {
      target: { value: "gateway" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));

    expect(controller.executeTool).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Invalid sourceIds list",
    );
  });

  it("shows a bounded recent ledger without exposing element ids", () => {
    const controller = makeController();
    const longLedger = Array.from({ length: 14 }, (_, index) => ({
      sequence: index + 1,
      tool: index % 2 ? "align_shapes" : "select_shapes",
      changedIds: [`private-id-${index}`],
      outcome: "uncommitted",
    }));
    const { container } = render(
      <RegistryPalette
        controller={controller as never}
        snapshot={{ ...snapshot, ledger: longLedger } as never}
      />,
    );

    expect(
      container.querySelectorAll("[data-ledger-entry='true']"),
    ).toHaveLength(10);
    expect(
      screen.getByText(/#14 · align_shapes · 1 shape · uncommitted/),
    ).toBeTruthy();
    expect(container.textContent).not.toContain("private-id-");
  });
});
