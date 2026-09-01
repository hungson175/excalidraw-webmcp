import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RegistryPalette } from "../RegistryPalette";

const createDescriptor = {
  name: "create_shapes",
  description: "Create staged labeled shapes",
  inputSchema: {
    type: "object",
    properties: {
      shapes: {
        type: "array",
        items: {
          type: "object",
          properties: {
            type: { type: "string" },
            label: { type: "string" },
          },
        },
      },
    },
    required: ["shapes"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false },
};

const snapshot = { selectedIds: [], pending: null, ledger: [] };

describe("RegistryPalette create_shapes", () => {
  it("parses object-array JSON and blocks malformed JSON before execution", async () => {
    const controller = {
      listTools: vi.fn(() => [createDescriptor]),
      executeTool: vi.fn(
        async (
          _name: string,
          _args: unknown,
          _context: { signal: AbortSignal },
        ) => ({
          ok: true,
          status: "uncommitted",
          createdCount: 2,
        }),
      ),
    };
    render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /commands/i }));
    const shapes = screen.getByLabelText("shapes");
    expect(shapes.tagName).toBe("TEXTAREA");

    fireEvent.change(shapes, { target: { value: "[{" } });
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));
    expect(controller.executeTool).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Invalid shapes JSON");

    const value = [
      { type: "rectangle", label: "Browser" },
      { type: "ellipse", label: "Worker" },
    ];
    fireEvent.change(shapes, { target: { value: JSON.stringify(value) } });
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));
    await waitFor(() => expect(controller.executeTool).toHaveBeenCalledOnce());
    expect(controller.executeTool.mock.calls[0][0]).toBe("create_shapes");
    expect(controller.executeTool.mock.calls[0][1]).toEqual({ shapes: value });
  });
});
