import type { ExcalidrawElementSkeleton } from "@excalidraw/element";

const CREATE_TYPES = ["rectangle", "ellipse", "diamond"] as const;
const CREATE_TYPE_SET = new Set<string>(CREATE_TYPES);
const SAFE_CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const UNSAFE_IDS = new Set(["__proto__", "constructor", "prototype"]);

export const MAX_CREATE_SHAPES = 12;
export const MAX_CREATE_LABEL = 80;

export type CreateShapeInput = {
  clientId?: string;
  type: typeof CREATE_TYPES[number];
  label?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
};

type ParseResult =
  | { ok: true; shapes: CreateShapeInput[] }
  | { ok: false; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isFiniteWithin = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  value >= minimum &&
  value <= maximum;

export const parseCreateShapesArgs = (args: unknown): ParseResult => {
  if (
    !isRecord(args) ||
    Object.keys(args).some((key) => key !== "shapes") ||
    !Array.isArray(args.shapes) ||
    args.shapes.length < 1 ||
    args.shapes.length > MAX_CREATE_SHAPES
  ) {
    return {
      ok: false,
      message: `shapes must contain 1 to ${MAX_CREATE_SHAPES} items`,
    };
  }

  const clientIds = new Set<string>();
  const shapes: CreateShapeInput[] = [];
  for (const candidate of args.shapes) {
    if (
      !isRecord(candidate) ||
      Object.keys(candidate).some(
        (key) =>
          !["clientId", "type", "label", "x", "y", "width", "height"].includes(
            key,
          ),
      ) ||
      typeof candidate.type !== "string" ||
      !CREATE_TYPE_SET.has(candidate.type)
    ) {
      return { ok: false, message: "Each shape must use a supported type" };
    }

    if (
      typeof candidate.clientId !== "undefined" &&
      (typeof candidate.clientId !== "string" ||
        !SAFE_CLIENT_ID_RE.test(candidate.clientId) ||
        UNSAFE_IDS.has(candidate.clientId) ||
        clientIds.has(candidate.clientId))
    ) {
      return {
        ok: false,
        message: "clientId must be unique and contain only safe characters",
      };
    }
    if (typeof candidate.clientId === "string") {
      clientIds.add(candidate.clientId);
    }
    if (
      typeof candidate.label !== "undefined" &&
      (typeof candidate.label !== "string" ||
        candidate.label.length > MAX_CREATE_LABEL)
    ) {
      return {
        ok: false,
        message: `label must contain at most ${MAX_CREATE_LABEL} characters`,
      };
    }

    const bounded: Array<[keyof CreateShapeInput, number, number]> = [
      ["x", -10000, 10000],
      ["y", -10000, 10000],
      ["width", 40, 800],
      ["height", 30, 600],
    ];
    if (
      bounded.some(
        ([key, minimum, maximum]) =>
          typeof candidate[key] !== "undefined" &&
          !isFiniteWithin(candidate[key], minimum, maximum),
      )
    ) {
      return { ok: false, message: "Shape geometry is outside safe bounds" };
    }

    shapes.push(candidate as CreateShapeInput);
  }
  return { ok: true, shapes };
};

export const buildCreateSkeletons = (
  shapes: CreateShapeInput[],
  nextId: () => string,
) => {
  const createdIds: string[] = [];
  const idMap: Record<string, string> = {};
  const skeletons = shapes.map((shape, index) => {
    const id = nextId();
    createdIds.push(id);
    if (shape.clientId) {
      idMap[shape.clientId] = id;
    }
    const label = shape.label?.trim();
    return {
      id,
      type: shape.type,
      x: shape.x ?? 100 + index * 180,
      y: shape.y ?? 100,
      width: shape.width ?? 140,
      height: shape.height ?? 64,
      ...(label ? { label: { text: label } } : {}),
    } as ExcalidrawElementSkeleton;
  });
  return { skeletons, createdIds, idMap };
};

export const CREATE_SHAPE_TYPES = [...CREATE_TYPES];
