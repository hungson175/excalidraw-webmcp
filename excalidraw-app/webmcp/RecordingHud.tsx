import { useEffect, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import "./RecordingHud.scss";

import type {
  RetrofitController,
  RetrofitSnapshot,
} from "./retrofit_controller";

type RecordingHudProps = {
  api: Pick<ExcalidrawImperativeAPI, "getSceneElements">;
  controller: Pick<RetrofitController, "listTools">;
  snapshot: RetrofitSnapshot;
  webmcpLabel: string;
};

const formatElapsed = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(
    2,
    "0",
  )}`;
};

export const RecordingHud = ({
  api,
  controller,
  snapshot,
  webmcpLabel,
}: RecordingHudProps) => {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const metrics = [
    [
      "live",
      "Live",
      api.getSceneElements().filter((item) => !item.isDeleted).length,
    ],
    ["selected", "Selected", snapshot.selectedIds.length],
    ["preview", "Preview", snapshot.pending?.elements.length ?? 0],
    ["ledger", "Ledger", snapshot.ledger.length],
    ["tools", "Tools", controller.listTools().length],
  ] as const;

  return (
    <section
      className="webmcp-film-hud"
      data-film-hud="true"
      data-testid="film-hud"
      aria-label="Recording evidence HUD"
    >
      <div className="webmcp-film-copy">
        <p>KEYLESS REPLAY · NOT A NATIVE AGENT</p>
        <strong>
          {webmcpLabel} ·{" "}
          {snapshot.pending ? "STAGED — Human commit required" : "READY"}
        </strong>
        <span>native_agent_invocation=UNPROVEN</span>
      </div>
      <time
        className="webmcp-film-clock"
        data-testid="film-clock"
        aria-live="off"
      >
        {formatElapsed(elapsed)}
      </time>
      <div className="webmcp-film-cards">
        {metrics.map(([key, label, value]) => (
          <div className="webmcp-film-card" key={key}>
            <span>{label}</span>
            <strong data-testid={`film-metric-${key}`}>{value}</strong>
          </div>
        ))}
      </div>
    </section>
  );
};
