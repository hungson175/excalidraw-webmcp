import type { ExcalidrawElement } from "@excalidraw/element/types";

export type DistributeAxis = "horizontal" | "vertical";
export type DistributeGeometry = Pick<
  ExcalidrawElement,
  "id" | "x" | "y" | "width" | "height"
>;

type DistributionFailure = {
  ok: false;
  reason: "overlap" | "already_even";
  message: string;
};

type DistributionSuccess = {
  gap: number;
  positioned: DistributeGeometry[];
};

const EPSILON = 1e-6;

export const computeEvenGaps = (
  sorted: DistributeGeometry[],
  axis: DistributeAxis,
): DistributionSuccess | DistributionFailure => {
  const position = axis === "horizontal" ? "x" : "y";
  const size = axis === "horizontal" ? "width" : "height";
  const first = sorted[0];
  const last = sorted.at(-1);

  if (!first || !last || sorted.length < 3) {
    return {
      ok: false,
      reason: "already_even",
      message: "Distribution needs at least three shapes",
    };
  }

  const span = last[position] + last[size] - first[position];
  const occupied = sorted.reduce((sum, geometry) => sum + geometry[size], 0);
  const available = span - occupied;
  if (available < -EPSILON) {
    return {
      ok: false,
      reason: "overlap",
      message: "Shapes overlap along the axis",
    };
  }

  const gap = available / (sorted.length - 1);
  const currentGaps = sorted.slice(1).map((geometry, index) => {
    const previous = sorted[index];
    return geometry[position] - (previous[position] + previous[size]);
  });
  if (currentGaps.every((current) => Math.abs(current - gap) <= EPSILON)) {
    return {
      ok: false,
      reason: "already_even",
      message: "Gaps are already even",
    };
  }

  let cursor = first[position];
  const positioned = sorted.map((geometry, index) => {
    if (index === 0 || index === sorted.length - 1) {
      cursor = geometry[position] + geometry[size] + gap;
      return { ...geometry };
    }
    const next = { ...geometry, [position]: cursor };
    cursor += geometry[size] + gap;
    return next;
  });

  return { gap, positioned };
};
