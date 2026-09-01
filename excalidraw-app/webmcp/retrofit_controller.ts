import { CaptureUpdateAction } from "@excalidraw/excalidraw";
import { newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createToolRegistry } from "./tool_registry";

import type {
  PublicToolDescriptor,
  ToolDescriptor,
  ToolExecutionContext,
  ToolFailure,
  ToolResult,
} from "./tool_registry";

const MAX_ELEMENTS = 240;
const MAX_RETURNED_IDS = 40;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SHAPE_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "text",
  "freedraw",
]);
const ALIGN_EDGES = new Set([
  "left",
  "centerX",
  "right",
  "top",
  "centerY",
  "bottom",
]);
const ALIGN_TARGETS = new Set(["selection", "canvas", "first"]);
const DIMENSIONS = new Set(["width", "height"]);
const SIZE_MODES = new Set(["max", "min", "first", "average"]);

type SceneApi = Pick<
  ExcalidrawImperativeAPI,
  "getSceneElements" | "getAppState" | "updateScene"
>;

type Geometry = Pick<
  ExcalidrawElement,
  "id" | "type" | "x" | "y" | "width" | "height" | "angle"
>;

type PendingLayout = {
  baseVersions: Record<string, { version: number; versionNonce: number }>;
  elements: Geometry[];
  operations: string[];
};

type LedgerEntry = {
  sequence: number;
  tool: string;
  changedIds: string[];
  outcome: "uncommitted" | "committed" | "discarded" | "unsafe_retry";
};

export type RetrofitSnapshot = {
  selectedIds: string[];
  pending: PendingLayout | null;
  ledger: LedgerEntry[];
};

type Listener = (snapshot: RetrofitSnapshot) => void;
type HumanGesture = { isTrusted: boolean };

const failure = (
  reason: ToolFailure["reason"],
  message: string,
): ToolFailure => ({ ok: false, reason, message });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hasOnlyKeys = (value: Record<string, unknown>, keys: string[]) =>
  Object.keys(value).every((key) => keys.includes(key));

const parseIds = (value: unknown): string[] | ToolFailure | undefined => {
  if (typeof value === "undefined") {
    return undefined;
  }
  if (!Array.isArray(value) || value.length > MAX_ELEMENTS) {
    return failure(
      "invalid_args",
      `ids must contain at most ${MAX_ELEMENTS} items`,
    );
  }
  const ids = Array.from(new Set(value));
  if (
    ids.some(
      (id) =>
        typeof id !== "string" ||
        !SAFE_ID_RE.test(id) ||
        id === "__proto__" ||
        id === "constructor" ||
        id === "prototype",
    )
  ) {
    return failure("invalid_args", "ids contain an invalid element id");
  }
  return ids as string[];
};

const checkAbort = (signal: AbortSignal) => {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
};

const summarizeIds = (ids: string[]) => ({
  changedIds: ids.slice(0, MAX_RETURNED_IDS),
  changedCount: ids.length,
  truncated: ids.length > MAX_RETURNED_IDS,
});

const cloneSnapshot = (snapshot: RetrofitSnapshot): RetrofitSnapshot =>
  structuredClone(snapshot);

const toolSchema = (
  properties: Record<string, unknown>,
  required: string[] = [],
) => ({
  type: "object",
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

export const createRetrofitController = (api: SceneApi) => {
  let snapshot: RetrofitSnapshot = {
    selectedIds: [],
    pending: null,
    ledger: [],
  };
  let sequence = 0;
  const listeners = new Set<Listener>();

  const emit = () => {
    const next = cloneSnapshot(snapshot);
    listeners.forEach((listener) => listener(next));
  };

  const liveElements = () =>
    api
      .getSceneElements()
      .filter((element) => !element.isDeleted) as readonly ExcalidrawElement[];

  const workingMap = () => {
    const map = new Map(liveElements().map((element) => [element.id, element]));
    snapshot.pending?.elements.forEach((element) =>
      map.set(element.id, element as ExcalidrawElement),
    );
    return map;
  };

  const resolveTargets = (
    idsValue: unknown,
  ): ExcalidrawElement[] | ToolFailure => {
    const parsed = parseIds(idsValue);
    if (parsed && !Array.isArray(parsed)) {
      return parsed;
    }
    const requested =
      parsed ??
      (snapshot.selectedIds.length
        ? snapshot.selectedIds
        : Object.entries(api.getAppState().selectedElementIds)
            .filter(([, selected]) => selected)
            .map(([id]) => id));
    if (!requested.length) {
      return failure("no_selection", "Select at least two unlocked shapes");
    }
    if (requested.length > MAX_ELEMENTS) {
      return failure(
        "invalid_args",
        `A call may address at most ${MAX_ELEMENTS} shapes`,
      );
    }

    const map = workingMap();
    const targets: ExcalidrawElement[] = [];
    for (const id of requested) {
      const target = map.get(id);
      if (!target) {
        return failure(
          "not_found",
          "One or more requested shapes no longer exist",
        );
      }
      if (target.locked || target.isDeleted) {
        return failure(
          "unsafe_retry",
          "A requested shape is locked or deleted",
        );
      }
      targets.push(target);
    }
    return targets;
  };

  const stage = (
    tool: string,
    geometries: Geometry[],
    context: ToolExecutionContext,
  ): ToolResult => {
    checkAbort(context.signal);
    const currentById = new Map(
      liveElements().map((element) => [element.id, element]),
    );
    const previous = snapshot.pending;
    const baseVersions = previous ? { ...previous.baseVersions } : {};
    const pendingById = new Map(
      previous?.elements.map((item) => [item.id, item]),
    );

    for (const geometry of geometries) {
      const live = currentById.get(geometry.id);
      if (!live) {
        return failure(
          "unsafe_retry",
          "A target changed before preview could be staged",
        );
      }
      baseVersions[geometry.id] ??= {
        version: live.version,
        versionNonce: live.versionNonce,
      };
      pendingById.set(geometry.id, geometry);
    }
    checkAbort(context.signal);

    snapshot = {
      ...snapshot,
      pending: {
        baseVersions,
        elements: Array.from(pendingById.values()),
        operations: [...(previous?.operations ?? []), tool],
      },
      ledger: [
        ...snapshot.ledger,
        {
          sequence: ++sequence,
          tool,
          changedIds: geometries.map(({ id }) => id),
          outcome: "uncommitted",
        },
      ],
    };
    emit();
    return {
      ok: true,
      status: "uncommitted",
      ...summarizeIds(geometries.map(({ id }) => id)),
    };
  };

  const selectShapes: ToolDescriptor["execute"] = async (args, context) => {
    checkAbort(context.signal);
    if (
      !isRecord(args) ||
      !hasOnlyKeys(args, ["ids", "type", "labelContains"])
    ) {
      return failure("invalid_args", "Use only ids, type, or labelContains");
    }
    const parsedIds = parseIds(args.ids);
    if (parsedIds && !Array.isArray(parsedIds)) {
      return parsedIds;
    }
    if (
      typeof args.type !== "undefined" &&
      (typeof args.type !== "string" || !SHAPE_TYPES.has(args.type))
    ) {
      return failure("invalid_args", "type is not supported");
    }
    if (
      typeof args.labelContains !== "undefined" &&
      (typeof args.labelContains !== "string" ||
        args.labelContains.length === 0 ||
        args.labelContains.length > 50)
    ) {
      return failure(
        "invalid_args",
        "labelContains must contain 1 to 50 characters",
      );
    }
    if (!parsedIds && !args.type && !args.labelContains) {
      return failure("invalid_args", "Provide ids, type, or labelContains");
    }

    const all = liveElements();
    const requested = parsedIds ? new Set(parsedIds) : null;
    const needle =
      typeof args.labelContains === "string"
        ? args.labelContains.toLocaleLowerCase()
        : null;
    const labels = new Map<string, string>();
    all.forEach((item) => {
      if (item.type === "text" && item.containerId && "text" in item) {
        labels.set(item.containerId, item.text.toLocaleLowerCase());
      }
    });
    const selected = all.filter((item) => {
      if (item.locked) {
        return false;
      }
      if (requested && !requested.has(item.id)) {
        return false;
      }
      if (args.type && item.type !== args.type) {
        return false;
      }
      if (needle) {
        const ownText = item.type === "text" && "text" in item ? item.text : "";
        if (
          !`${ownText} ${labels.get(item.id) ?? ""}`
            .toLocaleLowerCase()
            .includes(needle)
        ) {
          return false;
        }
      }
      return true;
    });
    if (!selected.length) {
      return failure("no_selection", "No unlocked shape matched the criteria");
    }
    if (requested && selected.length !== requested.size) {
      return failure(
        "not_found",
        "One or more requested shapes were not selectable",
      );
    }
    checkAbort(context.signal);
    snapshot = { ...snapshot, selectedIds: selected.map(({ id }) => id) };
    emit();
    return {
      ok: true,
      selectedCount: selected.length,
      selectedIds: selected.map(({ id }) => id).slice(0, MAX_RETURNED_IDS),
      truncated: selected.length > MAX_RETURNED_IDS,
    };
  };

  const alignShapes: ToolDescriptor["execute"] = async (args, context) => {
    checkAbort(context.signal);
    if (!isRecord(args) || !hasOnlyKeys(args, ["ids", "edge", "to"])) {
      return failure("invalid_args", "Use only ids, edge, or to");
    }
    if (typeof args.edge !== "string" || !ALIGN_EDGES.has(args.edge)) {
      return failure("invalid_args", "edge is not supported");
    }
    const to = args.to ?? "selection";
    if (typeof to !== "string" || !ALIGN_TARGETS.has(to)) {
      return failure("invalid_args", "to is not supported");
    }
    const targets = resolveTargets(args.ids);
    if (!Array.isArray(targets)) {
      return targets;
    }
    if (targets.length < 2 && to === "selection") {
      return failure(
        "unsafe_retry",
        "Selection alignment needs at least two shapes",
      );
    }

    const minX = Math.min(...targets.map(({ x }) => x));
    const maxX = Math.max(...targets.map(({ x, width }) => x + width));
    const minY = Math.min(...targets.map(({ y }) => y));
    const maxY = Math.max(...targets.map(({ y, height }) => y + height));
    const first = targets[0];
    const appState = api.getAppState();
    const zoom = appState.zoom.value || 1;
    const anchors =
      to === "first"
        ? {
            left: first.x,
            centerX: first.x + first.width / 2,
            right: first.x + first.width,
            top: first.y,
            centerY: first.y + first.height / 2,
            bottom: first.y + first.height,
          }
        : to === "canvas"
        ? {
            left: -appState.scrollX,
            centerX: -appState.scrollX + appState.width / zoom / 2,
            right: -appState.scrollX + appState.width / zoom,
            top: -appState.scrollY,
            centerY: -appState.scrollY + appState.height / zoom / 2,
            bottom: -appState.scrollY + appState.height / zoom,
          }
        : {
            left: minX,
            centerX: (minX + maxX) / 2,
            right: maxX,
            top: minY,
            centerY: (minY + maxY) / 2,
            bottom: maxY,
          };
    const edge = args.edge as keyof typeof anchors;
    const geometries = targets.map((item): Geometry => {
      let { x, y } = item;
      if (edge === "left") {
        x = anchors.left;
      }
      if (edge === "centerX") {
        x = anchors.centerX - item.width / 2;
      }
      if (edge === "right") {
        x = anchors.right - item.width;
      }
      if (edge === "top") {
        y = anchors.top;
      }
      if (edge === "centerY") {
        y = anchors.centerY - item.height / 2;
      }
      if (edge === "bottom") {
        y = anchors.bottom - item.height;
      }
      return {
        id: item.id,
        type: item.type,
        x,
        y,
        width: item.width,
        height: item.height,
        angle: item.angle,
      };
    });
    return stage("align_shapes", geometries, context);
  };

  const equalizeSize: ToolDescriptor["execute"] = async (args, context) => {
    checkAbort(context.signal);
    if (!isRecord(args) || !hasOnlyKeys(args, ["ids", "dimension", "mode"])) {
      return failure("invalid_args", "Use only ids, dimension, or mode");
    }
    if (typeof args.dimension !== "string" || !DIMENSIONS.has(args.dimension)) {
      return failure("invalid_args", "dimension is not supported");
    }
    const mode = args.mode ?? "max";
    if (typeof mode !== "string" || !SIZE_MODES.has(mode)) {
      return failure("invalid_args", "mode is not supported");
    }
    const targets = resolveTargets(args.ids);
    if (!Array.isArray(targets)) {
      return targets;
    }
    if (targets.length < 2) {
      return failure(
        "unsafe_retry",
        "Size equalization needs at least two shapes",
      );
    }
    const dimension = args.dimension as "width" | "height";
    const values = targets.map((item) => item[dimension]);
    const reference =
      mode === "min"
        ? Math.min(...values)
        : mode === "first"
        ? values[0]
        : mode === "average"
        ? values.reduce((sum, value) => sum + value, 0) / values.length
        : Math.max(...values);
    const geometries = targets.map(
      (item): Geometry => ({
        id: item.id,
        type: item.type,
        x: item.x,
        y: item.y,
        width: dimension === "width" ? reference : item.width,
        height: dimension === "height" ? reference : item.height,
        angle: item.angle,
      }),
    );
    return stage("equalize_size", geometries, context);
  };

  const descriptors: ToolDescriptor[] = [
    {
      name: "select_shapes",
      description:
        "Select up to 240 unlocked shapes by id, type, or visible label.",
      inputSchema: toolSchema({
        ids: {
          type: "array",
          items: { type: "string" },
          maxItems: MAX_ELEMENTS,
        },
        type: { type: "string", enum: Array.from(SHAPE_TYPES) },
        labelContains: { type: "string", maxLength: 50 },
      }),
      annotations: { readOnlyHint: true },
      execute: selectShapes,
    },
    {
      name: "align_shapes",
      description:
        "Stage an exact edge or center alignment without changing the live drawing.",
      inputSchema: toolSchema(
        {
          ids: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_ELEMENTS,
          },
          edge: { type: "string", enum: Array.from(ALIGN_EDGES) },
          to: { type: "string", enum: Array.from(ALIGN_TARGETS) },
        },
        ["edge"],
      ),
      annotations: { readOnlyHint: false },
      execute: alignShapes,
    },
    {
      name: "equalize_size",
      description:
        "Stage equal widths or heights without changing the live drawing.",
      inputSchema: toolSchema(
        {
          ids: {
            type: "array",
            items: { type: "string" },
            maxItems: MAX_ELEMENTS,
          },
          dimension: { type: "string", enum: Array.from(DIMENSIONS) },
          mode: { type: "string", enum: Array.from(SIZE_MODES) },
        },
        ["dimension"],
      ),
      annotations: { readOnlyHint: false },
      execute: equalizeSize,
    },
  ];
  const registry = createToolRegistry(descriptors);

  const commitFromHuman = (gesture: HumanGesture) => {
    if (!gesture.isTrusted) {
      return { ok: false as const, reason: "human_gesture_required" as const };
    }
    if (!snapshot.pending) {
      return { ok: false as const, reason: "no_pending" as const };
    }

    const pending = snapshot.pending;
    const current = liveElements();
    const currentById = new Map(
      current.map((element) => [element.id, element]),
    );
    const changedIds = pending.elements.map(({ id }) => id);
    for (const id of changedIds) {
      const base = pending.baseVersions[id];
      const live = currentById.get(id);
      if (
        !base ||
        !live ||
        live.locked ||
        live.version !== base.version ||
        live.versionNonce !== base.versionNonce
      ) {
        snapshot = {
          ...snapshot,
          ledger: [
            ...snapshot.ledger,
            {
              sequence: ++sequence,
              tool: "human_commit",
              changedIds,
              outcome: "unsafe_retry",
            },
          ],
        };
        emit();
        return { ok: false as const, reason: "unsafe_retry" as const };
      }
    }

    const geometryById = new Map(
      pending.elements.map((item) => [item.id, item]),
    );
    const elements = current.map((element) => {
      const geometry = geometryById.get(element.id);
      return geometry
        ? newElementWith(element, {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width,
            height: geometry.height,
          })
        : element;
    });
    api.updateScene({
      elements,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
    snapshot = {
      ...snapshot,
      pending: null,
      ledger: [
        ...snapshot.ledger,
        {
          sequence: ++sequence,
          tool: "human_commit",
          changedIds,
          outcome: "committed",
        },
      ],
    };
    emit();
    return { ok: true as const, appliedIds: changedIds };
  };

  const discardFromHuman = (gesture: HumanGesture) => {
    if (!gesture.isTrusted) {
      return { ok: false as const, reason: "human_gesture_required" as const };
    }
    if (!snapshot.pending) {
      return { ok: false as const, reason: "no_pending" as const };
    }
    const changedIds = snapshot.pending.elements.map(({ id }) => id);
    snapshot = {
      ...snapshot,
      pending: null,
      ledger: [
        ...snapshot.ledger,
        {
          sequence: ++sequence,
          tool: "human_discard",
          changedIds,
          outcome: "discarded",
        },
      ],
    };
    emit();
    return { ok: true as const, discardedIds: changedIds };
  };

  return {
    listTools: (): PublicToolDescriptor[] => registry.listTools(),
    executeTool: (name: string, args: unknown, context: ToolExecutionContext) =>
      registry.execute(name, args, context),
    getSnapshot: () => cloneSnapshot(snapshot),
    subscribe: (listener: Listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    commitFromHuman,
    discardFromHuman,
    dispose: registry.dispose,
  };
};

export type RetrofitController = ReturnType<typeof createRetrofitController>;
