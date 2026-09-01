import { describe, expect, it, vi } from "vitest";

import {
  PLAIN_REPLAY_REQUEST_EVENT,
  PLAIN_REPLAY_STATUS_EVENT,
  runPlainReplay,
} from "../plain_replay";

const runtimeIds = {
  browser: "runtime-browser",
  worker: "runtime-worker",
  database: "runtime-database",
};

describe("plain-URL explicit replay", () => {
  it("composes five real controller tools with IDs returned at runtime", async () => {
    const executeTool = vi.fn(
      async (
        name: string,
        _input: unknown,
        _context: { signal: AbortSignal },
      ) =>
        name === "create_shapes"
          ? {
              ok: true,
              status: "uncommitted",
              createdCount: 3,
              createdIds: Object.values(runtimeIds),
              idMap: runtimeIds,
            }
          : { ok: true, status: "uncommitted" },
    );
    const controller = {
      executeTool,
      commitFromHuman: vi.fn(),
      discardFromHuman: vi.fn(),
    };
    const onStep = vi.fn();
    const result = await runPlainReplay(controller as never, {
      signal: new AbortController().signal,
      onStep,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "uncommitted",
      completedSteps: 5,
    });
    expect(executeTool.mock.calls.map(([name]) => name)).toEqual([
      "create_shapes",
      "align_shapes",
      "equalize_size",
      "distribute_shapes",
      "connect_shapes",
    ]);
    expect(executeTool.mock.calls[1][1]).toMatchObject({
      ids: Object.values(runtimeIds),
    });
    expect(executeTool.mock.calls[2][1]).toMatchObject({
      ids: Object.values(runtimeIds),
    });
    expect(executeTool.mock.calls[3][1]).toMatchObject({
      ids: Object.values(runtimeIds),
    });
    expect(executeTool.mock.calls[4][1]).toEqual({
      sourceIds: [runtimeIds.browser, runtimeIds.worker],
      targetId: runtimeIds.database,
    });
    expect(executeTool.mock.calls.every((call) => call[2]?.signal)).toBe(true);
    expect(controller.commitFromHuman).not.toHaveBeenCalled();
    expect(controller.discardFromHuman).not.toHaveBeenCalled();
    expect(onStep).toHaveBeenCalledTimes(5);
  });

  it("stops after a bounded tool failure and never reports completion", async () => {
    const executeTool = vi.fn(
      async (
        name: string,
        _input: unknown,
        _context: { signal: AbortSignal },
      ) =>
        name === "create_shapes"
          ? { ok: true, status: "uncommitted", idMap: runtimeIds }
          : { ok: false, reason: "unsafe_retry", message: "Drawing changed" },
    );
    const result = await runPlainReplay({ executeTool } as never, {
      signal: new AbortController().signal,
    });

    expect(result).toEqual({
      ok: false,
      reason: "unsafe_retry",
      failedStep: "align_shapes",
      completedSteps: 1,
      message: "Drawing changed",
    });
    expect(executeTool).toHaveBeenCalledTimes(2);
  });

  it("honors AbortSignal between steps and exposes stable event names", async () => {
    const abort = new AbortController();
    const executeTool = vi.fn(
      async (
        name: string,
        _input: unknown,
        _context: { signal: AbortSignal },
      ) => {
        if (name === "create_shapes") {
          abort.abort();
          return { ok: true, status: "uncommitted", idMap: runtimeIds };
        }
        throw new Error("post-abort tool leaked");
      },
    );
    const result = await runPlainReplay({ executeTool } as never, {
      signal: abort.signal,
    });

    expect(result).toEqual({
      ok: false,
      reason: "aborted",
      failedStep: "align_shapes",
      completedSteps: 1,
      message: "Replay stopped",
    });
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(PLAIN_REPLAY_REQUEST_EVENT).toBe("webmcp:watch-replay");
    expect(PLAIN_REPLAY_STATUS_EVENT).toBe("webmcp:watch-replay-status");
  });
});
