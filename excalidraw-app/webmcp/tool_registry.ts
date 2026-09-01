export const MAX_RESULT_CHARACTERS = 1536;

const SAFE_NAME_RE = /^[A-Za-z0-9_.-]{1,128}$/;
const UNSAFE_NAMES = new Set(["__proto__", "constructor", "prototype"]);

export type ToolFailureReason =
  | "invalid_args"
  | "no_selection"
  | "not_found"
  | "result_too_large"
  | "unsafe_retry";

export type ToolFailure = {
  ok: false;
  reason: ToolFailureReason;
  message: string;
};

export type ToolResult = ToolFailure | ({ ok: true } & Record<string, unknown>);

export type ToolExecutionContext = {
  signal: AbortSignal;
};

export type ToolDescriptor = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean };
  execute: (
    args: unknown,
    context: ToolExecutionContext,
  ) => Promise<ToolResult>;
};

export type PublicToolDescriptor = Omit<ToolDescriptor, "execute">;

const abortError = () => new DOMException("Aborted", "AbortError");

const validateDescriptor = (descriptor: ToolDescriptor) => {
  if (
    !SAFE_NAME_RE.test(descriptor.name) ||
    UNSAFE_NAMES.has(descriptor.name) ||
    descriptor.name.length > 30
  ) {
    throw new Error(`Unsafe tool name: ${descriptor.name}`);
  }
  if (
    descriptor.description.length === 0 ||
    descriptor.description.length > 500
  ) {
    throw new Error(`Invalid description for ${descriptor.name}`);
  }
  if (
    descriptor.inputSchema.type !== "object" ||
    descriptor.inputSchema.additionalProperties !== false
  ) {
    throw new Error(`Invalid input schema for ${descriptor.name}`);
  }
  if (typeof descriptor.annotations.readOnlyHint !== "boolean") {
    throw new Error(`Invalid annotations for ${descriptor.name}`);
  }
};

const publicDescriptor = (
  descriptor: ToolDescriptor,
): PublicToolDescriptor => ({
  name: descriptor.name,
  description: descriptor.description,
  inputSchema: structuredClone(descriptor.inputSchema),
  annotations: { ...descriptor.annotations },
});

export const createToolRegistry = (descriptors: ToolDescriptor[]) => {
  const tools = new Map<string, ToolDescriptor>();
  const controllers = new Map<string, AbortController>();

  for (const descriptor of descriptors) {
    validateDescriptor(descriptor);
    if (tools.has(descriptor.name)) {
      throw new Error(`Duplicate tool name: ${descriptor.name}`);
    }
    tools.set(descriptor.name, descriptor);
  }

  return {
    listTools: () => Array.from(tools.values(), publicDescriptor),

    execute: async (
      name: string,
      args: unknown,
      context: ToolExecutionContext,
    ): Promise<ToolResult> => {
      const descriptor = tools.get(name);
      if (!descriptor) {
        return {
          ok: false,
          reason: "not_found",
          message: "Unknown tool",
        };
      }
      if (context.signal.aborted) {
        throw abortError();
      }

      controllers.get(name)?.abort();
      const controller = new AbortController();
      controllers.set(name, controller);
      const forwardAbort = () => controller.abort();
      context.signal.addEventListener("abort", forwardAbort, { once: true });

      try {
        const result = await descriptor.execute(structuredClone(args), {
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          throw abortError();
        }
        if (JSON.stringify(result).length > MAX_RESULT_CHARACTERS) {
          return {
            ok: false,
            reason: "result_too_large",
            message: "Result exceeded the bounded response size",
          };
        }
        return result;
      } finally {
        context.signal.removeEventListener("abort", forwardAbort);
        if (controllers.get(name) === controller) {
          controllers.delete(name);
        }
      }
    },

    dispose: () => {
      controllers.forEach((controller) => controller.abort());
      controllers.clear();
    },
  };
};
