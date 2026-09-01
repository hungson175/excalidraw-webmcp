import { describe, expect, it, vi } from "vitest";

import { createRetrofitController } from "../retrofit_controller";

const appState = {
  selectedElementIds: {},
  width: 1200,
  height: 800,
  offsetLeft: 0,
  offsetTop: 0,
  scrollX: 0,
  scrollY: 0,
  zoom: { value: 1 },
};

const makeApi = (initial: unknown[] = []) => {
  const live = [...initial];
  return {
    live,
    getSceneElements: vi.fn(() => live),
    getAppState: vi.fn(() => appState),
    updateScene: vi.fn(),
  };
};

const invoke = (
  controller: ReturnType<typeof createRetrofitController>,
  name: string,
  args: unknown,
) =>
  controller.executeTool(name, args, {
    signal: new AbortController().signal,
  });

describe("create_shapes staged creation", () => {
  it("publishes one bounded sixth descriptor and no commit tool", () => {
    const controller = createRetrofitController(makeApi() as never);
    const tools = controller.listTools();
    const create = tools.find(({ name }) => name === "create_shapes");

    expect(tools.map(({ name }) => name)).toEqual([
      "select_shapes",
      "align_shapes",
      "equalize_size",
      "distribute_shapes",
      "connect_shapes",
      "create_shapes",
    ]);
    expect(create).toMatchObject({
      annotations: { readOnlyHint: false },
      inputSchema: {
        type: "object",
        required: ["shapes"],
        additionalProperties: false,
      },
    });
    expect(create?.inputSchema.properties).toMatchObject({
      shapes: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: {
          type: "object",
          required: ["type"],
          additionalProperties: false,
        },
      },
    });
    expect(
      tools.some(({ name }) => /commit|accept|approve|reject/i.test(name)),
    ).toBe(false);
  });

  it("stages real labeled container/text pairs without writing the live scene", async () => {
    const api = makeApi();
    const controller = createRetrofitController(api as never);
    const result = await invoke(controller, "create_shapes", {
      shapes: [
        {
          clientId: "browser",
          type: "rectangle",
          label: "Browser",
          x: 100,
          y: 180,
          width: 160,
          height: 60,
        },
        {
          clientId: "worker",
          type: "ellipse",
          label: "Worker",
          x: 360,
          y: 250,
          width: 140,
          height: 60,
        },
        {
          clientId: "storage",
          type: "diamond",
          label: "Storage",
          x: 620,
          y: 390,
          width: 150,
          height: 80,
        },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      status: "uncommitted",
      createdCount: 3,
      truncated: false,
    });
    const success = result as typeof result & {
      createdIds: string[];
      idMap: Record<string, string>;
    };
    expect(success.createdIds).toHaveLength(3);
    expect(Object.keys(success.idMap)).toEqual([
      "browser",
      "worker",
      "storage",
    ]);
    expect(new Set(Object.values(success.idMap))).toEqual(
      new Set(success.createdIds),
    );

    const pending = controller.getSnapshot().pending;
    expect(pending?.operations).toEqual(["create_shapes"]);
    expect(pending?.elements).toHaveLength(6);
    const containers = pending?.elements.filter((element) =>
      ["rectangle", "ellipse", "diamond"].includes(element.type),
    );
    const labels = pending?.elements.filter(
      (element) => element.type === "text",
    );
    expect(containers).toHaveLength(3);
    expect(labels).toHaveLength(3);
    for (const container of containers ?? []) {
      const textBinding = container.boundElements?.find(
        ({ type }) => type === "text",
      );
      expect(textBinding).toBeTruthy();
      expect(
        labels?.some(
          (label) =>
            label.id === textBinding?.id &&
            label.type === "text" &&
            label.containerId === container.id,
        ),
      ).toBe(true);
    }
    expect(api.live).toHaveLength(0);
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(controller.getSnapshot().ledger).toMatchObject([
      { tool: "create_shapes", outcome: "uncommitted" },
    ]);
  });

  it("composes layout and bound connectors against pending creations", async () => {
    const api = makeApi();
    const controller = createRetrofitController(api as never);
    const created = (await invoke(controller, "create_shapes", {
      shapes: [
        {
          clientId: "browser",
          type: "rectangle",
          label: "Browser",
          x: 100,
          y: 180,
          width: 120,
          height: 40,
        },
        {
          clientId: "worker",
          type: "rectangle",
          label: "Worker",
          x: 180,
          y: 250,
          width: 160,
          height: 50,
        },
        {
          clientId: "storage",
          type: "rectangle",
          label: "Storage",
          x: 260,
          y: 390,
          width: 140,
          height: 50,
        },
        {
          clientId: "receipt",
          type: "diamond",
          label: "Receipt",
          x: 700,
          y: 270,
          width: 150,
          height: 90,
        },
      ],
    })) as {
      ok: true;
      createdIds: string[];
      idMap: Record<string, string>;
    };
    const sources = [
      created.idMap.browser,
      created.idMap.worker,
      created.idMap.storage,
    ];

    expect(
      await invoke(controller, "align_shapes", {
        ids: sources,
        edge: "left",
        to: "first",
      }),
    ).toMatchObject({ ok: true, status: "uncommitted" });
    expect(
      await invoke(controller, "equalize_size", {
        ids: sources,
        dimension: "width",
        mode: "max",
      }),
    ).toMatchObject({ ok: true, status: "uncommitted" });
    expect(
      await invoke(controller, "distribute_shapes", {
        ids: sources,
        axis: "vertical",
      }),
    ).toMatchObject({ ok: true, status: "uncommitted" });
    expect(
      await invoke(controller, "connect_shapes", {
        sourceIds: sources,
        targetId: created.idMap.receipt,
      }),
    ).toMatchObject({
      ok: true,
      status: "uncommitted",
      connectorCount: 3,
    });

    const snapshot = controller.getSnapshot();
    expect(snapshot.pending?.operations).toEqual([
      "create_shapes",
      "align_shapes",
      "equalize_size",
      "distribute_shapes",
      "connect_shapes",
    ]);
    expect(snapshot.ledger.map(({ tool }) => tool)).toEqual(
      snapshot.pending?.operations,
    );
    expect(snapshot.pending?.elements).toHaveLength(11);
    const arrows = snapshot.pending?.elements.filter(
      (element) => element.type === "arrow",
    );
    expect(arrows).toHaveLength(3);
    for (const arrow of arrows ?? []) {
      if (arrow.type !== "arrow") {
        throw new Error("expected an arrow");
      }
      expect(arrow.startBinding?.elementId).toBeTruthy();
      expect(arrow.endBinding?.elementId).toBe(created.idMap.receipt);
      const start = snapshot.pending?.elements.find(
        ({ id }) => id === arrow.startBinding?.elementId,
      );
      const target = snapshot.pending?.elements.find(
        ({ id }) => id === arrow.endBinding?.elementId,
      );
      expect(start?.boundElements?.some(({ id }) => id === arrow.id)).toBe(
        true,
      );
      expect(target?.boundElements?.some(({ id }) => id === arrow.id)).toBe(
        true,
      );
    }
    expect(api.live).toHaveLength(0);
    expect(api.updateScene).not.toHaveBeenCalled();

    expect(controller.commitFromHuman({ isTrusted: false })).toEqual({
      ok: false,
      reason: "human_gesture_required",
    });
    expect(api.updateScene).not.toHaveBeenCalled();
    expect(controller.commitFromHuman({ isTrusted: true })).toMatchObject({
      ok: true,
    });
    expect(api.updateScene).toHaveBeenCalledTimes(1);
    expect(api.updateScene.mock.calls[0][0].elements).toHaveLength(11);
  });

  it("rejects malformed, duplicate, over-budget, and aborted creation with no delta", async () => {
    const invalidInputs = [
      {},
      { shapes: [] },
      { shapes: [{ type: "line" }] },
      { shapes: [{ type: "rectangle", label: "x".repeat(81) }] },
      { shapes: [{ type: "rectangle", clientId: "__proto__" }] },
      {
        shapes: [
          { type: "rectangle", clientId: "same" },
          { type: "ellipse", clientId: "same" },
        ],
      },
      { shapes: [{ type: "rectangle", width: 10 }] },
      { shapes: [{ type: "rectangle", x: Number.POSITIVE_INFINITY }] },
      { shapes: [{ type: "rectangle", unknown: true }] },
      {
        shapes: Array.from({ length: 13 }, () => ({ type: "rectangle" })),
      },
    ];

    for (const input of invalidInputs) {
      const api = makeApi();
      const controller = createRetrofitController(api as never);
      const before = controller.getSnapshot();
      const result = await invoke(controller, "create_shapes", input);
      expect(result).toMatchObject({ ok: false, reason: "invalid_args" });
      expect(JSON.stringify(result).length).toBeLessThanOrEqual(1536);
      expect(controller.getSnapshot()).toEqual(before);
      expect(api.updateScene).not.toHaveBeenCalled();
    }

    const api = makeApi();
    const controller = createRetrofitController(api as never);
    const abort = new AbortController();
    abort.abort();
    await expect(
      controller.executeTool(
        "create_shapes",
        { shapes: [{ type: "rectangle", label: "Aborted" }] },
        { signal: abort.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(controller.getSnapshot()).toEqual({
      selectedIds: [],
      pending: null,
      ledger: [],
    });
    expect(api.updateScene).not.toHaveBeenCalled();
  });
});
