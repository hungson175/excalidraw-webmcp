import { describe, expect, it, vi } from "vitest";

import { createRetrofitController } from "../retrofit_controller";
import { createWebMCPRegistration } from "../webmcp_adapter";

const elements = [
  {
    id: "service-a",
    type: "rectangle",
    x: 10,
    y: 10,
    width: 60,
    height: 30,
    version: 1,
    versionNonce: 10,
    isDeleted: false,
    locked: false,
    angle: 0,
  },
  {
    id: "service-b",
    type: "rectangle",
    x: 100,
    y: 90,
    width: 80,
    height: 40,
    version: 1,
    versionNonce: 20,
    isDeleted: false,
    locked: false,
    angle: 0,
  },
];

const makeController = () =>
  createRetrofitController({
    getSceneElements: () => elements,
    getAppState: () => ({
      selectedElementIds: {},
      width: 1200,
      height: 800,
      scrollX: 0,
      scrollY: 0,
      zoom: { value: 1 },
    }),
    updateScene: vi.fn(),
  } as never);

const fakeDocument = (
  registerTool: (
    definition: Record<string, unknown>,
    options: { signal: AbortSignal },
  ) => Promise<void>,
) => ({ modelContext: { registerTool } });

describe("WebMCP registration bridge", () => {
  it("keeps unsupported browsers on the normal local editor path", async () => {
    const controller = makeController();
    const registration = createWebMCPRegistration(controller, {});

    await expect(registration.ready).resolves.toEqual({
      supported: false,
      registered: [],
    });
    expect(registration.supported).toBe(false);
    expect(controller.getSnapshot().pending).toBeNull();
  });

  it("fails closed when browser feature detection itself throws", async () => {
    const hostileDocument = {};
    Object.defineProperty(hostileDocument, "modelContext", {
      get() {
        throw new DOMException("Blocked", "SecurityError");
      },
    });

    expect(() =>
      createWebMCPRegistration(makeController(), hostileDocument),
    ).not.toThrow();
    const registration = createWebMCPRegistration(
      makeController(),
      hostileDocument,
    );
    await expect(registration.ready).resolves.toEqual({
      supported: false,
      registered: [],
    });
  });

  it("registers the exact three reviewed tools sequentially with owned signals", async () => {
    const calls: Array<{
      definition: Record<string, unknown>;
      options: { signal: AbortSignal };
    }> = [];
    const registerTool = vi.fn(async (definition, options) => {
      calls.push({ definition, options });
    });
    const registration = createWebMCPRegistration(
      makeController(),
      fakeDocument(registerTool),
    );

    await expect(registration.ready).resolves.toEqual({
      supported: true,
      registered: ["select_shapes", "align_shapes", "equalize_size"],
    });
    expect(calls.map(({ definition }) => definition.name)).toEqual([
      "select_shapes",
      "align_shapes",
      "equalize_size",
    ]);
    expect(
      calls.every(({ options }) => options.signal instanceof AbortSignal),
    ).toBe(true);
    expect(calls.every(({ options }) => !options.signal.aborted)).toBe(true);
    expect(
      calls.every(
        ({ definition }) =>
          !/commit|accept|reject|discard/i.test(String(definition.name)),
      ),
    ).toBe(true);
  });

  it("delegates parsed input and the browser invocation signal to the reviewed controller", async () => {
    const calls: Array<{ definition: Record<string, unknown> }> = [];
    const registration = createWebMCPRegistration(
      makeController(),
      fakeDocument(async (definition) => {
        calls.push({ definition });
      }),
    );
    await registration.ready;

    const select = calls[0].definition.execute as (
      args: unknown,
      context: { signal: AbortSignal },
    ) => Promise<Record<string, unknown>>;
    const result = await select(
      { type: "rectangle" },
      { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({ ok: true, selectedCount: 2 });

    const aborted = new AbortController();
    aborted.abort();
    await expect(
      select({ type: "rectangle" }, { signal: aborted.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rolls back all earlier registrations after a partial failure", async () => {
    const signals: AbortSignal[] = [];
    let count = 0;
    const registration = createWebMCPRegistration(
      makeController(),
      fakeDocument(async (_definition, options) => {
        signals.push(options.signal);
        count += 1;
        if (count === 2) {
          throw new Error("browser rejected the second descriptor");
        }
      }),
    );

    await expect(registration.ready).resolves.toEqual({
      supported: true,
      registered: [],
      failed: "align_shapes",
      rolledBack: true,
    });
    expect(signals).toHaveLength(2);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("aborts every registered tool when the owning panel unmounts", async () => {
    const signals: AbortSignal[] = [];
    const registration = createWebMCPRegistration(
      makeController(),
      fakeDocument(async (_definition, options) => {
        signals.push(options.signal);
      }),
    );
    await registration.ready;

    registration.dispose();
    expect(signals).toHaveLength(3);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});
