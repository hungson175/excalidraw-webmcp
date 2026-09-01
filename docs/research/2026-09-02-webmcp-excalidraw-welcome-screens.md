# WebMCP and Excalidraw welcome-screen lifecycle

Date: 02 September 2026

## Finding

The two visible welcome screens have independent causes.

1. WebMCP invokes the registered page callback, but it does not navigate the host application or reveal the UI automatically. The page's `execute` callback owns those side effects. This follows the official [WebMCP lifecycle](https://github.com/webmachinelearning/webmcp#lifecycle-of-a-tool-call), the [current specification](https://webmachinelearning.github.io/webmcp/#dom-modelcontexttool-execute), and Chrome's guidance that tools can perform navigation and state management through application JavaScript ([Chrome imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api)). Therefore, executing a drawing tool while the product shell is on its landing route leaves that landing route visible unless the application explicitly changes it.

2. Excalidraw considers only its own scene elements when deciding whether the canvas is empty. It automatically restores `showWelcomeScreen: true` while that scene contains no elements, and renders the welcome UI only when the host mounts the opt-in `<WelcomeScreen />` child. Host-side staged/ghost elements are outside that scene, so they do not dismiss the upstream welcome UI. The supported way to suppress it is to omit the child, rather than trying to keep the app-state flag false ([Excalidraw WelcomeScreen documentation](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/children-components/welcome-screen), [render condition](https://github.com/excalidraw/excalidraw/blob/e1bb9ff8f8931e783c11d104abb8967ac6605c9a/packages/excalidraw/components/App.tsx#L2444-L2451), [empty-scene update](https://github.com/excalidraw/excalidraw/blob/e1bb9ff8f8931e783c11d104abb8967ac6605c9a/packages/excalidraw/components/App.tsx#L4166-L4179)).

## Applied design

- Every browser-mediated WebMCP execution announces its tool activity to the owning document before running the controller.
- The product shell listens on its mounted node's `ownerDocument`, enters the workspace immediately, and shows which tool is staging work.
- Agent-driven route changes use `history.replaceState()` so a multi-tool drawing does not add one browser-history entry per call.
- The host no longer mounts Excalidraw's optional welcome child. The product's own landing page remains available on the plain URL, but it is replaced by the workspace as soon as an agent begins work.

## Regression coverage

- WebMCP adapter announces activity before controller execution.
- Product landing transitions to the workspace on that activity.
- The host integration does not mount `<AppWelcomeScreen />`.
