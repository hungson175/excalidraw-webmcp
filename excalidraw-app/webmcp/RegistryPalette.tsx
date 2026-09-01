import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { FormEvent } from "react";

import type {
  RetrofitController,
  RetrofitSnapshot,
} from "./retrofit_controller";

type RegistryPaletteProps = {
  controller: RetrofitController;
  snapshot: RetrofitSnapshot;
};

type SchemaProperty = {
  type?: string;
  enum?: unknown[];
};

type ObjectSchema = {
  properties?: Record<string, SchemaProperty>;
  required?: string[];
};

const MAX_RESULT_CHARACTERS = 1536;
const MAX_VISIBLE_LEDGER = 10;

const isWritable = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
  );
};

const boundedResult = (value: unknown) => {
  const serialized = JSON.stringify(value);
  return serialized.length <= MAX_RESULT_CHARACTERS
    ? serialized
    : `${serialized.slice(0, MAX_RESULT_CHARACTERS - 1)}…`;
};

const buildArgs = (
  schema: ObjectSchema,
  values: Record<string, string>,
):
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; message: string } => {
  const args: Record<string, unknown> = {};
  const required = new Set(schema.required ?? []);

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const raw = values[name]?.trim() ?? "";
    if (!raw) {
      if (required.has(name)) {
        return { ok: false, message: `${name} is required` };
      }
      continue;
    }
    if (property.type === "array") {
      const items = raw.split(/[\n,]/).map((item) => item.trim());
      if (items.some((item) => !item)) {
        return { ok: false, message: `Invalid ${name} list` };
      }
      args[name] = items;
    } else {
      args[name] = raw;
    }
  }
  return { ok: true, args };
};

export const RegistryPalette = ({
  controller,
  snapshot,
}: RegistryPaletteProps) => {
  const tools = useMemo(() => controller.listTools(), [controller]);
  const [open, setOpen] = useState(false);
  const [activeName, setActiveName] = useState(tools[0]?.name ?? "");
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState(
    "Choose a tool and review its arguments.",
  );
  const openerRef = useRef<HTMLElement | null>(null);
  const firstToolRef = useRef<HTMLButtonElement | null>(null);
  const invocationRef = useRef<AbortController | null>(null);

  const activeTool =
    tools.find((descriptor) => descriptor.name === activeName) ?? tools[0];
  const schema = (activeTool?.inputSchema ?? {}) as ObjectSchema;
  const required = new Set(schema.required ?? []);

  const close = useCallback(() => {
    invocationRef.current?.abort();
    invocationRef.current = null;
    setOpen(false);
    const opener = openerRef.current;
    window.setTimeout(() => opener?.focus(), 0);
  }, []);

  const show = useCallback((opener: HTMLElement | null) => {
    openerRef.current = opener;
    setOpen(true);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && open) {
        event.preventDefault();
        close();
        return;
      }
      if (
        event.key.toLowerCase() !== "k" ||
        (!event.ctrlKey && !event.metaKey) ||
        event.altKey ||
        event.shiftKey ||
        isWritable(event.target)
      ) {
        return;
      }
      event.preventDefault();
      if (open) {
        close();
      } else {
        show(document.activeElement as HTMLElement | null);
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [close, open, show]);

  useEffect(() => {
    if (open) {
      firstToolRef.current?.focus();
    }
  }, [open]);

  useEffect(
    () => () => {
      invocationRef.current?.abort();
    },
    [],
  );

  const chooseTool = (name: string) => {
    invocationRef.current?.abort();
    invocationRef.current = null;
    setActiveName(name);
    setValues({});
    setMessage("Choose arguments, then run the reviewed registry tool.");
  };

  const runTool = async (event: FormEvent) => {
    event.preventDefault();
    if (!activeTool) {
      setMessage("No registry tool is available.");
      return;
    }
    const built = buildArgs(schema, values);
    if (!built.ok) {
      setMessage(built.message);
      return;
    }

    invocationRef.current?.abort();
    const invocation = new AbortController();
    invocationRef.current = invocation;
    setMessage("Running…");
    try {
      const result = await controller.executeTool(activeTool.name, built.args, {
        signal: invocation.signal,
      });
      if (!invocation.signal.aborted && invocationRef.current === invocation) {
        setMessage(boundedResult(result));
      }
    } catch (error) {
      if (!invocation.signal.aborted && invocationRef.current === invocation) {
        setMessage(
          error instanceof DOMException && error.name === "AbortError"
            ? "Cancelled"
            : "Tool failed safely",
        );
      }
    } finally {
      if (invocationRef.current === invocation) {
        invocationRef.current = null;
      }
    }
  };

  const ledger = snapshot.ledger.slice(-MAX_VISIBLE_LEDGER);

  return (
    <>
      <div className="webmcp-retrofit__command-row">
        <button
          type="button"
          onClick={(event) => show(event.currentTarget)}
          aria-haspopup="dialog"
        >
          Commands · ⌘K
        </button>
      </div>

      <section
        className="webmcp-retrofit__ledger"
        aria-label="Operation ledger"
      >
        <strong>Operation ledger</strong>
        {ledger.length ? (
          <ol aria-live="polite">
            {ledger.map((entry) => {
              const count = entry.changedIds.length;
              return (
                <li key={entry.sequence} data-ledger-entry="true">
                  #{entry.sequence} · {entry.tool} · {count}{" "}
                  {count === 1 ? "shape" : "shapes"} · {entry.outcome}
                </li>
              );
            })}
          </ol>
        ) : (
          <small>No operations yet</small>
        )}
      </section>

      {open && (
        <div
          className="webmcp-registry-palette__backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              close();
            }
          }}
        >
          <section
            className="webmcp-registry-palette"
            role="dialog"
            aria-modal="true"
            aria-labelledby="webmcp-command-title"
          >
            <header>
              <div>
                <strong id="webmcp-command-title">WebMCP commands</strong>
                <small>Same registry used by the browser agent</small>
              </div>
              <button type="button" onClick={close} aria-label="Close commands">
                ×
              </button>
            </header>

            <div className="webmcp-registry-palette__body">
              <nav aria-label="Registered tools">
                {tools.map((tool, index) => (
                  <button
                    ref={index === 0 ? firstToolRef : undefined}
                    key={tool.name}
                    type="button"
                    data-tool-name={tool.name}
                    aria-pressed={tool.name === activeTool?.name}
                    onClick={() => chooseTool(tool.name)}
                  >
                    {tool.name}
                  </button>
                ))}
              </nav>

              <form onSubmit={runTool}>
                <p>{activeTool?.description}</p>
                {Object.entries(schema.properties ?? {}).map(
                  ([name, property]) => (
                    <label key={name}>
                      <span>
                        {name}
                        {required.has(name) ? " *" : ""}
                      </span>
                      {property.enum ? (
                        <select
                          aria-label={name}
                          value={values[name] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [name]: event.target.value,
                            }))
                          }
                        >
                          <option value="">Choose…</option>
                          {property.enum.map((value) => (
                            <option key={String(value)} value={String(value)}>
                              {String(value)}
                            </option>
                          ))}
                        </select>
                      ) : property.type === "array" ? (
                        <textarea
                          aria-label={name}
                          value={values[name] ?? ""}
                          placeholder="Comma or newline separated"
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [name]: event.target.value,
                            }))
                          }
                        />
                      ) : (
                        <input
                          aria-label={name}
                          value={values[name] ?? ""}
                          onChange={(event) =>
                            setValues((current) => ({
                              ...current,
                              [name]: event.target.value,
                            }))
                          }
                        />
                      )}
                    </label>
                  ),
                )}
                <button type="submit">Run tool</button>
                <output aria-live="polite">{message}</output>
              </form>
            </div>
          </section>
        </div>
      )}
    </>
  );
};
