// Middleware factory
export { inertia } from './middleware.js'

// Serialization helpers
export { serializePage, escapeHtml } from './serialize.js'

// Prop wrappers
export {
  optional,
  always,
  deferred,
  merge,
  prepend,
  deepMerge,
  once,
  scroll,
  isTaggedProp,
} from './props.js'

// Types
export type {
  InertiaConfig,
  InertiaContext,
  InertiaEnv,
  PageObject,
  RenderFunction,
  ScrollMetadata,
  SsrConfig,
  SsrResult,
} from './types.js'
