export const WEBMCP_TOOL_ACTIVITY_EVENT = "webmcp:tool-activity";

export type WebMCPToolActivity = {
  state: "running";
  tool: string;
};

type ActivityDocument = {
  defaultView?: {
    CustomEvent: typeof CustomEvent;
  } | null;
  dispatchEvent?: (event: Event) => boolean;
};

export const announceWebMCPToolActivity = (
  documentObject: ActivityDocument,
  detail: WebMCPToolActivity,
) => {
  const CustomEventConstructor = documentObject.defaultView?.CustomEvent;
  if (
    !CustomEventConstructor ||
    typeof documentObject.dispatchEvent !== "function"
  ) {
    return;
  }
  documentObject.dispatchEvent(
    new CustomEventConstructor(WEBMCP_TOOL_ACTIVITY_EVENT, { detail }),
  );
};
