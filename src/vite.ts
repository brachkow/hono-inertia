export interface ViteManifestChunk {
  file: string
  css?: string[]
  imports?: string[]
}

export type ViteManifest = Record<string, ViteManifestChunk>

const VERSION_LENGTH = 16

const sha256Hex = async (input: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(input),
  )
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// Hash the sorted set of emitted filenames, not the raw JSON: filenames are
// already content-hashed by Vite, and sorting makes the result immune to
// manifest key-order and metadata churn. The thunk is lazy and memoized —
// crypto.subtle must not run at module top level on Workers, and the hash
// only needs to be computed once per isolate.
export const manifestVersion = (
  manifest: ViteManifest,
  salt = '',
): (() => Promise<string>) => {
  const fingerprint = Object.values(manifest)
    .map((chunk) => chunk.file)
    .sort()
    .join('\n')

  let cache: Promise<string> | undefined

  return () => {
    cache ??= sha256Hex(`${salt}:${fingerprint}`).then((hex) =>
      hex.slice(0, VERSION_LENGTH),
    )
    return cache
  }
}
