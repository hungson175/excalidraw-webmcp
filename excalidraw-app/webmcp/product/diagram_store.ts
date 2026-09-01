const STORE_VERSION = 1;
const DEFAULT_KEY = "excalidraw-webmcp.diagrams.v1";
const MAX_DIAGRAMS = 50;
const MAX_ELEMENTS = 500;
const MAX_NAME_LENGTH = 80;
const MAX_SERIALIZED_CHARACTERS = 750_000;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,80}$/;

export type StoredElement = Record<string, unknown>;
export type StoredFiles = Record<string, unknown>;

export type DiagramRecord = {
  id: string;
  name: string;
  updatedAt: string;
  elements: StoredElement[];
  files: StoredFiles;
};

export type DiagramSummary = Pick<
  DiagramRecord,
  "id" | "name" | "updatedAt"
> & { elementCount: number };

export type DiagramDraft = {
  id?: string;
  name: string;
  elements: readonly StoredElement[];
  files: StoredFiles;
};

export type DiagramStore = {
  load(id: string): Promise<DiagramRecord | null>;
  save(draft: DiagramDraft): Promise<DiagramSummary>;
  list(): Promise<DiagramSummary[]>;
  rename(id: string, name: string): Promise<DiagramSummary | null>;
  delete(id: string): Promise<boolean>;
};

type StoredEnvelope = { version: 1; diagrams: DiagramRecord[] };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const cleanName = (value: string) => {
  const name = value.trim();
  if (!name || name.length > MAX_NAME_LENGTH) {
    throw new Error(
      `Diagram name must contain 1 to ${MAX_NAME_LENGTH} characters`,
    );
  }
  return name;
};

const isDiagramRecord = (value: unknown): value is DiagramRecord =>
  isRecord(value) &&
  typeof value.id === "string" &&
  SAFE_ID_RE.test(value.id) &&
  typeof value.name === "string" &&
  value.name.trim().length > 0 &&
  value.name.length <= MAX_NAME_LENGTH &&
  typeof value.updatedAt === "string" &&
  !Number.isNaN(Date.parse(value.updatedAt)) &&
  Array.isArray(value.elements) &&
  value.elements.length <= MAX_ELEMENTS &&
  value.elements.every(isRecord) &&
  isRecord(value.files);

const parseEnvelope = (raw: string | null): StoredEnvelope => {
  if (!raw || raw.length > MAX_SERIALIZED_CHARACTERS) {
    return { version: STORE_VERSION, diagrams: [] };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== STORE_VERSION ||
      !Array.isArray(parsed.diagrams) ||
      parsed.diagrams.length > MAX_DIAGRAMS ||
      !parsed.diagrams.every(isDiagramRecord)
    ) {
      return { version: STORE_VERSION, diagrams: [] };
    }
    return parsed as StoredEnvelope;
  } catch {
    return { version: STORE_VERSION, diagrams: [] };
  }
};

const summarize = (record: DiagramRecord): DiagramSummary => ({
  id: record.id,
  name: record.name,
  updatedAt: record.updatedAt,
  elementCount: record.elements.filter(({ isDeleted }) => !isDeleted).length,
});

const createId = () =>
  globalThis.crypto?.randomUUID?.().replaceAll("-", "") ??
  `diagram_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;

export const createLocalDiagramStore = (
  storage: Pick<Storage, "getItem" | "setItem">,
  key = DEFAULT_KEY,
): DiagramStore => {
  const read = () => parseEnvelope(storage.getItem(key));
  const write = (diagrams: DiagramRecord[]) => {
    const serialized = JSON.stringify({ version: STORE_VERSION, diagrams });
    if (serialized.length > MAX_SERIALIZED_CHARACTERS) {
      throw new Error("Saved diagrams exceed the local storage budget");
    }
    storage.setItem(key, serialized);
  };

  return {
    load: async (id) => {
      if (!SAFE_ID_RE.test(id)) {
        return null;
      }
      const record = read().diagrams.find((item) => item.id === id);
      return record ? structuredClone(record) : null;
    },

    save: async (draft) => {
      const name = cleanName(draft.name);
      if (
        !Array.isArray(draft.elements) ||
        draft.elements.length > MAX_ELEMENTS
      ) {
        throw new Error(
          `A diagram may contain at most ${MAX_ELEMENTS} elements`,
        );
      }
      if (!draft.elements.every(isRecord) || !isRecord(draft.files)) {
        throw new Error("Diagram data is malformed");
      }
      const envelope = read();
      const requestedId =
        draft.id && SAFE_ID_RE.test(draft.id) ? draft.id : null;
      const existingIndex = requestedId
        ? envelope.diagrams.findIndex(({ id }) => id === requestedId)
        : -1;
      if (existingIndex === -1 && envelope.diagrams.length >= MAX_DIAGRAMS) {
        throw new Error(
          `You can save at most ${MAX_DIAGRAMS} diagrams locally`,
        );
      }
      const record: DiagramRecord = {
        id:
          existingIndex >= 0 ? envelope.diagrams[existingIndex].id : createId(),
        name,
        updatedAt: new Date().toISOString(),
        elements: structuredClone([...draft.elements]),
        files: structuredClone(draft.files),
      };
      if (existingIndex >= 0) {
        envelope.diagrams[existingIndex] = record;
      } else {
        envelope.diagrams.push(record);
      }
      write(envelope.diagrams);
      return summarize(record);
    },

    list: async () =>
      read()
        .diagrams.map(summarize)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),

    rename: async (id, nextName) => {
      if (!SAFE_ID_RE.test(id)) {
        return null;
      }
      const envelope = read();
      const record = envelope.diagrams.find((item) => item.id === id);
      if (!record) {
        return null;
      }
      record.name = cleanName(nextName);
      record.updatedAt = new Date().toISOString();
      write(envelope.diagrams);
      return summarize(record);
    },

    delete: async (id) => {
      if (!SAFE_ID_RE.test(id)) {
        return false;
      }
      const envelope = read();
      const next = envelope.diagrams.filter((item) => item.id !== id);
      if (next.length === envelope.diagrams.length) {
        return false;
      }
      write(next);
      return true;
    },
  };
};

let defaultStore: DiagramStore | null = null;

export const getLocalDiagramStore = () => {
  defaultStore ??= createLocalDiagramStore(window.localStorage);
  return defaultStore;
};
