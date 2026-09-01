import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RegistryPalette } from "../RegistryPalette";

const descriptor = {
  name: "select_shapes",
  description: "Select shapes",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: { readOnlyHint: true },
};
const snapshot = { selectedIds: [], pending: null, ledger: [] };

const deferredController = () => {
  const signals: AbortSignal[] = [];
  return {
    signals,
    listTools: () => [descriptor],
    executeTool: vi.fn(
      async (
        _name: string,
        _args: unknown,
        context: { signal: AbortSignal },
      ) => {
        signals.push(context.signal);
        return new Promise(() => {});
      },
    ),
  };
};

describe("RegistryPalette cancellation", () => {
  it("aborts an in-flight invocation when Escape closes the surface", async () => {
    const controller = deferredController();
    render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /commands/i }));
    fireEvent.click(screen.getByRole("button", { name: "Run tool" }));
    await waitFor(() => expect(controller.signals).toHaveLength(1));
    expect(controller.signals[0].aborted).toBe(false);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(controller.signals[0].aborted).toBe(true);
  });

  it("aborts the prior invocation when a replacement starts", async () => {
    const controller = deferredController();
    render(
      <RegistryPalette
        controller={controller as never}
        snapshot={snapshot as never}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /commands/i }));
    const run = screen.getByRole("button", { name: "Run tool" });
    fireEvent.click(run);
    await waitFor(() => expect(controller.signals).toHaveLength(1));
    fireEvent.click(run);
    await waitFor(() => expect(controller.signals).toHaveLength(2));

    expect(controller.signals[0].aborted).toBe(true);
    expect(controller.signals[1].aborted).toBe(false);
  });
});
