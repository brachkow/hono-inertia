export interface ViteManifestChunk {
  file: string;
  css?: string[];
  imports?: string[];
}

export type ViteManifest = Record<string, ViteManifestChunk>;

export const VERSION_LENGTH = 16;

const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
};

// Hash the sorted set of emitted filenames, not the raw JSON: filenames are
// already content-hashed by Vite, and sorting makes the result immune to
// manifest key-order and metadata churn.
export const manifestFingerprint = (manifest: ViteManifest): string =>
  Object.values(manifest)
    .map((chunk) => chunk.file)
    .toSorted()
    .join('\n');

// The thunk is lazy and memoized: crypto.subtle must not run at module top
// level on Workers, and the hash only needs to be computed once per isolate.
export const manifestVersion = (
  manifest: ViteManifest,
  salt = '',
): (() => Promise<string>) => {
  const fingerprint = manifestFingerprint(manifest);

  let cache: Promise<string> | undefined;

  return () => {
    cache ??= sha256Hex(`${salt}:${fingerprint}`).then((hex) =>
      hex.slice(0, VERSION_LENGTH),
    );
    return cache;
  };
};
