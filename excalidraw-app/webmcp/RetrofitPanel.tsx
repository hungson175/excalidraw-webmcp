import { sceneCoordsToViewportCoords } from "@excalidraw/common";
import { useEffect, useMemo, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { createRetrofitController } from "./retrofit_controller";
import { createWebMCPRegistration } from "./webmcp_adapter";
import { RegistryPalette } from "./RegistryPalette";
import "./RetrofitPanel.scss";

import type {
  RetrofitController,
  RetrofitSnapshot,
} from "./retrofit_controller";

type RetrofitPanelProps = {
  api: ExcalidrawImperativeAPI;
  controller?: RetrofitController;
};

export const RetrofitPanel = ({
  api,
  controller: supplied,
}: RetrofitPanelProps) => {
  const controller = useMemo(
    () => supplied ?? createRetrofitController(api),
    [api, supplied],
  );
  const [snapshot, setSnapshot] = useState<RetrofitSnapshot>(
    controller.getSnapshot(),
  );
  const [, refreshViewport] = useState(0);
  const [message, setMessage] = useState(
    "Agent changes stay staged until you commit.",
  );
  const [webmcpStatus, setWebmcpStatus] = useState("WEBMCP …");

  useEffect(() => controller.subscribe(setSnapshot), [controller]);

  useEffect(() => {
    const registration = createWebMCPRegistration(controller);
    let active = true;
    void registration.ready.then((receipt) => {
      if (!active) {
        return;
      }
      setWebmcpStatus(
        receipt.supported
          ? receipt.registered.length === controller.listTools().length
            ? `WEBMCP ${receipt.registered.length}`
            : "WEBMCP ERROR"
          : "LOCAL ONLY",
      );
    });
    return () => {
      active = false;
      registration.dispose();
    };
  }, [controller]);

  useEffect(() => {
    const refresh = () => refreshViewport((value) => value + 1);
    const unsubscribeChange = api.onChange(refresh);
    const unsubscribeScroll = api.onScrollChange(refresh);
    return () => {
      unsubscribeChange();
      unsubscribeScroll();
      if (!supplied) {
        controller.dispose();
      }
    };
  }, [api, controller, supplied]);

  const appState = api.getAppState();
  const zoom = appState.zoom.value;

  const humanAction = (
    event: React.MouseEvent<HTMLButtonElement>,
    action: "commit" | "discard",
  ) => {
    const gesture = { isTrusted: event.nativeEvent.isTrusted };
    const result =
      action === "commit"
        ? controller.commitFromHuman(gesture)
        : controller.discardFromHuman(gesture);
    if (!result.ok) {
      setMessage(
        result.reason === "human_gesture_required"
          ? "Human click required"
          : result.reason === "unsafe_retry"
          ? "Drawing changed. Review and stage again."
          : "Nothing is waiting for review.",
      );
      return;
    }
    setMessage(action === "commit" ? "Layout committed" : "Preview discarded");
  };

  return (
    <>
      <svg
        className="webmcp-retrofit__ghosts"
        data-ghost-overlay="true"
        aria-hidden="true"
        style={{ pointerEvents: "none" }}
      >
        <defs>
          <marker
            id="webmcp-arrowhead"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <path d="M 0 0 L 8 4 L 0 8 z" />
          </marker>
        </defs>
        {snapshot.pending?.elements.map((element) => {
          if (element.type === "arrow" && element.points.length >= 2) {
            const start = element.points[0];
            const end = element.points[element.points.length - 1];
            const startPoint = sceneCoordsToViewportCoords(
              {
                sceneX: element.x + start[0],
                sceneY: element.y + start[1],
              },
              appState,
            );
            const endPoint = sceneCoordsToViewportCoords(
              {
                sceneX: element.x + end[0],
                sceneY: element.y + end[1],
              },
              appState,
            );
            return (
              <line
                key={element.id}
                data-ghost="true"
                data-ghost-connector="true"
                x1={startPoint.x}
                y1={startPoint.y}
                x2={endPoint.x}
                y2={endPoint.y}
                markerEnd="url(#webmcp-arrowhead)"
              />
            );
          }
          const point = sceneCoordsToViewportCoords(
            { sceneX: element.x, sceneY: element.y },
            appState,
          );
          const width = element.width * zoom;
          const height = element.height * zoom;
          const centerX = point.x + width / 2;
          const centerY = point.y + height / 2;
          return (
            <rect
              key={element.id}
              data-ghost="true"
              x={point.x}
              y={point.y}
              width={width}
              height={height}
              rx={8}
              transform={
                element.angle
                  ? `rotate(${
                      element.angle * (180 / Math.PI)
                    } ${centerX} ${centerY})`
                  : undefined
              }
            />
          );
        })}
      </svg>

      <aside className="webmcp-retrofit" aria-label="Agent layout preview">
        <header>
          <strong>Agent layout</strong>
          <div className="webmcp-retrofit__status" aria-live="polite">
            <span className="is-idle">{webmcpStatus}</span>
            <span className={snapshot.pending ? "is-pending" : "is-idle"}>
              {snapshot.pending ? "UNCOMMITTED" : "READY"}
            </span>
          </div>
        </header>
        <p>
          {snapshot.pending
            ? `${
                snapshot.pending.elements.length
              } shapes · ${snapshot.pending.operations.join(" → ")}`
            : `${snapshot.selectedIds.length} shapes selected`}
        </p>
        <RegistryPalette controller={controller} snapshot={snapshot} />
        <div className="webmcp-retrofit__actions">
          <button
            id="commit-layout"
            type="button"
            disabled={!snapshot.pending}
            onClick={(event) => humanAction(event, "commit")}
          >
            Commit layout
          </button>
          <button
            id="discard-layout"
            type="button"
            disabled={!snapshot.pending}
            onClick={(event) => humanAction(event, "discard")}
          >
            Discard
          </button>
        </div>
        <small aria-live="polite">{message}</small>
      </aside>
    </>
  );
};
