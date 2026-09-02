import { announceWebMCPToolActivity } from "./tool_activity";

import type {
  PublicToolDescriptor,
  ToolExecutionContext,
  ToolResult,
} from "./tool_registry";

export type WebMCPToolController = {
  listTools: () => PublicToolDescriptor[];
  executeTool: (
    name: string,
    args: unknown,
    context: ToolExecutionContext,
  ) => Promise<ToolResult>;
};

type BrowserToolDefinition = PublicToolDescriptor & {
  execute: (
    args: unknown,
    context?: Partial<ToolExecutionContext>,
  ) => Promise<ToolResult>;
};

type ModelContextLike = {
  registerTool: (
    definition: BrowserToolDefinition,
    options: { signal: AbortSignal },
  ) => Promise<void> | void;
};

type DocumentLike = {
  modelContext?: Partial<ModelContextLike>;
  defaultView?: {
    CustomEvent: typeof CustomEvent;
  } | null;
  dispatchEvent?: (event: Event) => boolean;
};

type RegistrationReceipt =
  | { supported: false; registered: [] }
  | {
      supported: true;
      registered: string[];
      failed?: string;
      rolledBack?: true;
    };

const fallbackInvocationSignal = () => new AbortController().signal;

const browserDefinition = (
  descriptor: PublicToolDescriptor,
  controller: WebMCPToolController,
  documentObject: DocumentLike,
): BrowserToolDefinition => ({
  ...descriptor,
  execute: async (args, context = {}) => {
    announceWebMCPToolActivity(documentObject, {
      state: "running",
      tool: descriptor.name,
    });
    return controller.executeTool(descriptor.name, args, {
      signal: context.signal ?? fallbackInvocationSignal(),
    });
  },
});

export const createWebMCPRegistration = (
  controller: WebMCPToolController,
  documentObject: DocumentLike = globalThis.document as DocumentLike,
) => {
  let modelContext: Partial<ModelContextLike> | undefined;
  try {
    modelContext = documentObject.modelContext;
  } catch {
    modelContext = undefined;
  }
  const registerTool =
    typeof modelContext?.registerTool === "function"
      ? modelContext.registerTool.bind(modelContext)
      : null;
  const supported = registerTool !== null;
  const registrations = new Map<string, AbortController>();
  let disposed = false;

  const dispose = () => {
    disposed = true;
    registrations.forEach((registration) => registration.abort());
    registrations.clear();
  };

  const ready: Promise<RegistrationReceipt> = supported
    ? (async () => {
        const registered: string[] = [];
        for (const descriptor of controller.listTools()) {
          if (disposed) {
            dispose();
            return { supported: true, registered: [], rolledBack: true };
          }
          const registration = new AbortController();
          registrations.set(descriptor.name, registration);
          try {
            await registerTool!(
              browserDefinition(descriptor, controller, documentObject),
              {
                signal: registration.signal,
              },
            );
            registered.push(descriptor.name);
          } catch {
            dispose();
            return {
              supported: true,
              registered: [],
              failed: descriptor.name,
              rolledBack: true,
            };
          }
        }
        return { supported: true, registered };
      })()
    : Promise.resolve({ supported: false, registered: [] });

  return { supported, ready, dispose };
};
