import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RetrofitPanel } from "../RetrofitPanel";

const originalModelContext = (
  document as Document & {
    modelContext?: unknown;
  }
).modelContext;

afterEach(() => {
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: originalModelContext,
  });
});

describe("RetrofitPanel WebMCP lifecycle", () => {
  it("shows the exact registered count and aborts registrations on unmount", async () => {
    const signals: AbortSignal[] = [];
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (_definition, options) => {
          signals.push(options.signal);
        }),
      },
    });
    const api = {
      getSceneElements: () => [],
      getAppState: () => ({
        selectedElementIds: {},
        width: 1200,
        height: 800,
        offsetLeft: 0,
        offsetTop: 0,
        scrollX: 0,
        scrollY: 0,
        zoom: { value: 1 },
      }),
      updateScene: vi.fn(),
      onChange: vi.fn(() => () => {}),
      onScrollChange: vi.fn(() => () => {}),
    };

    const view = render(<RetrofitPanel api={api as never} />);
    await waitFor(() => expect(screen.getByText("WEBMCP 6")).toBeTruthy());
    expect(signals).toHaveLength(6);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    view.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
