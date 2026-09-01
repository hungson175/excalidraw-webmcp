const SHARE_VERSION = 1;
const MAX_SHARE_ELEMENTS = 200;
const MAX_SHARE_JSON_CHARACTERS = 48_000;
const MAX_SHARE_TOKEN_CHARACTERS = 64_000;

export type SharedScene = {
  name?: string;
  elements: Record<string, unknown>[];
  files: Record<string, unknown>;
};

export type ShareDecodeResult =
  | { ok: true; scene: SharedScene }
  | { ok: false; reason: "invalid_share"; message: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const base64ToBytes = (encoded: string) => {
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};

export const encodeSharedScene = (scene: SharedScene) => {
  if (
    !Array.isArray(scene.elements) ||
    scene.elements.length > MAX_SHARE_ELEMENTS ||
    !scene.elements.every(isRecord) ||
    !isRecord(scene.files)
  ) {
    throw new Error(
      `A share link may contain at most ${MAX_SHARE_ELEMENTS} elements`,
    );
  }
  const payload = JSON.stringify({
    version: SHARE_VERSION,
    ...(scene.name?.trim() ? { name: scene.name.trim().slice(0, 80) } : {}),
    elements: scene.elements,
    files: scene.files,
  });
  if (payload.length > MAX_SHARE_JSON_CHARACTERS) {
    throw new Error("This diagram is too large for a client-only share link");
  }
  return bytesToBase64(new TextEncoder().encode(payload))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

export const decodeSharedScene = (token: string): ShareDecodeResult => {
  if (
    !token ||
    token.length > MAX_SHARE_TOKEN_CHARACTERS ||
    !/^[A-Za-z0-9_-]+$/u.test(token)
  ) {
    return {
      ok: false,
      reason: "invalid_share",
      message: "Invalid share link",
    };
  }
  try {
    const normalized = token.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const raw = new TextDecoder().decode(base64ToBytes(padded));
    if (raw.length > MAX_SHARE_JSON_CHARACTERS) {
      throw new Error("oversized");
    }
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== SHARE_VERSION ||
      !Array.isArray(parsed.elements) ||
      parsed.elements.length > MAX_SHARE_ELEMENTS ||
      !parsed.elements.every(isRecord) ||
      !isRecord(parsed.files) ||
      (typeof parsed.name !== "undefined" &&
        (typeof parsed.name !== "string" || parsed.name.length > 80))
    ) {
      throw new Error("unsupported");
    }
    return {
      ok: true,
      scene: {
        ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
        elements: parsed.elements,
        files: parsed.files,
      },
    };
  } catch {
    return {
      ok: false,
      reason: "invalid_share",
      message: "This share link is invalid or unsupported",
    };
  }
};

export const shareFragment = (token: string) =>
  `#view=workspace&share=${token}`;
