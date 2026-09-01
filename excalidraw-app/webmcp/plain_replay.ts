import type { RetrofitController } from "./retrofit_controller";

export const PLAIN_REPLAY_REQUEST_EVENT = "webmcp:watch-replay";
export const PLAIN_REPLAY_STATUS_EVENT = "webmcp:watch-replay-status";

const MAX_STATUS_MESSAGE = 240;
const STEPS = [
  "create_shapes",
  "align_shapes",
  "equalize_size",
  "distribute_shapes",
  "connect_shapes",
] as const;

type ReplayStep = typeof STEPS[number];
type ReplayOptions = {
  signal: AbortSignal;
  onStep?: (progress: { step: ReplayStep; completedSteps: number }) => void;
};

type ReplayFailure = {
  ok: false;
  reason: string;
  failedStep: ReplayStep;
  completedSteps: number;
  message: string;
};

type ReplaySuccess = {
  ok: true;
  status: "uncommitted";
  completedSteps: 5;
};

export type PlainReplayResult = ReplaySuccess | ReplayFailure;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedMessage = (value: unknown, fallback: string) =>
  (typeof value === "string" && value.trim() ? value.trim() : fallback).slice(
    0,
    MAX_STATUS_MESSAGE,
  );

const stopped = (
  failedStep: ReplayStep,
  completedSteps: number,
): ReplayFailure => ({
  ok: false,
  reason: "aborted",
  failedStep,
  completedSteps,
  message: "Replay stopped",
});

export const runPlainReplay = async (
  controller: Pick<RetrofitController, "executeTool">,
  { signal, onStep }: ReplayOptions,
): Promise<PlainReplayResult> => {
  let completedSteps = 0;
  const execute = async (step: ReplayStep, input: unknown) => {
    if (signal.aborted) {
      return stopped(step, completedSteps);
    }
    try {
      const result = await controller.executeTool(step, input, { signal });
      if (!result.ok) {
        return {
          ok: false as const,
          reason: result.reason,
          failedStep: step,
          completedSteps,
          message: boundedMessage(result.message, "Replay could not continue"),
        };
      }
      completedSteps += 1;
      onStep?.({ step, completedSteps });
      return result;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        return stopped(step, completedSteps);
      }
      return {
        ok: false as const,
        reason: "execute_failed",
        failedStep: step,
        completedSteps,
        message: boundedMessage(
          error instanceof Error ? error.message : error,
          "Replay could not continue",
        ),
      };
    }
  };

  const created = await execute("create_shapes", {
    shapes: [
      {
        type: "rectangle",
        label: "Browser",
        clientId: "browser",
        x: 160,
        y: 160,
        width: 190,
        height: 80,
      },
      {
        type: "ellipse",
        label: "Worker",
        clientId: "worker",
        x: 440,
        y: 310,
        width: 150,
        height: 70,
      },
      {
        type: "diamond",
        label: "Database",
        clientId: "database",
        x: 720,
        y: 520,
        width: 170,
        height: 100,
      },
    ],
  });
  if (!created.ok) {
    return created;
  }
  if (!isRecord(created.idMap)) {
    return {
      ok: false,
      reason: "unsafe_retry",
      failedStep: "create_shapes",
      completedSteps,
      message: "Creation did not return addressable runtime IDs",
    };
  }
  const { browser, worker, database } = created.idMap;
  if (
    typeof browser !== "string" ||
    typeof worker !== "string" ||
    typeof database !== "string"
  ) {
    return {
      ok: false,
      reason: "unsafe_retry",
      failedStep: "create_shapes",
      completedSteps,
      message: "Creation returned incomplete runtime IDs",
    };
  }
  const ids = [browser, worker, database];

  const aligned = await execute("align_shapes", {
    ids,
    edge: "left",
    to: "first",
  });
  if (!aligned.ok) {
    return aligned;
  }
  const equalized = await execute("equalize_size", {
    ids,
    dimension: "width",
    mode: "max",
  });
  if (!equalized.ok) {
    return equalized;
  }
  const distributed = await execute("distribute_shapes", {
    ids,
    axis: "vertical",
  });
  if (!distributed.ok) {
    return distributed;
  }
  const connected = await execute("connect_shapes", {
    sourceIds: [browser, worker],
    targetId: database,
  });
  if (!connected.ok) {
    return connected;
  }
  return { ok: true, status: "uncommitted", completedSteps: 5 };
};
