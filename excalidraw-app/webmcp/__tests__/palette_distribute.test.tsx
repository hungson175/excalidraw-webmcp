import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RegistryPalette } from "../RegistryPalette";

const descriptors = [
  "select_shapes",
  "align_shapes",
  "equalize_size",
  "distribute_shapes",
  "connect_shapes",
].map((name) => ({
  name,
  description: `Run ${name}`,
  inputSchema:
    name === "distribute_shapes"
      ? {
          type: "object",
          properties: {
            ids: { type: "array", items: { type: "string" } },
            axis: { type: "string", enum: ["horizontal", "vertical"] },
          },
          required: ["axis"],
          additionalProperties: false,
        }
      : {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
  annotations: { readOnlyHint: name === "select_shapes" },
}));

const snapshot = {
  selectedIds: [],
  pending: null,
  ledger: [
    {
      sequence: 1,
      tool: "distribute_shapes",
      changedIds: ["private-middle-id"],
      outcome: "uncommitted",
    },
  ],
};

describe("RegistryPalette distribute_shapes", () => {
  it("uses the same five-tool catalogue and schema-driven bounded arguments without a commit route", async () => {
    const controller = {
      listTools: vi.fn(() => descriptors),
      executeTool: vi.fn(
        async (
          _name: string,
          _args: unknown,
          _context: { signal: AbortSignal },
        ) => ({
          ok: true,
          status: "uncommitted",
          changedCount: 1,
        }),
      ),
    };
    const view = render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /commands/i }));
    expect(
      Array.from(
        view.container.querySelectorAll<HTMLButtonElement>("[data-tool-name]"),
      ).map((button) => button.dataset.toolName),
    ).toEqual(descriptors.map(({ name }) => name));
    expect(screen.queryByRole("button", { name: /commit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "distribute_shapes" }));
    expect(screen.getByLabelText("axis").tagName).toBe("SELECT");
    expect(screen.getByLabelText("ids").tagName).toBe("TEXTAREA");
    fireEvent.change(screen.getByLabelText("ids"), {
      target: { value: "shape-a,,shape-b" },
    });
    fireEvent.change(screen.getByLabelText("axis"), {
      target: { value: "vertical" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));
    expect(controller.executeTool).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Invalid ids list");

    fireEvent.change(screen.getByLabelText("ids"), {
      target: { value: "shape-a, shape-b\nshape-c" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));
    await waitFor(() =>
      expect(controller.executeTool).toHaveBeenCalledTimes(1),
    );
    expect(controller.executeTool.mock.calls[0][0]).toBe("distribute_shapes");
    expect(controller.executeTool.mock.calls[0][1]).toEqual({
      ids: ["shape-a", "shape-b", "shape-c"],
      axis: "vertical",
    });
    expect(
      screen.getByText(/distribute_shapes · 1 shape · uncommitted/),
    ).toBeTruthy();
    expect(view.container.textContent).not.toContain("private-middle-id");
  });
});
