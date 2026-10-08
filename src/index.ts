// Middleware factory
export { inertia, CLEAR_HISTORY_COOKIE } from './middleware.js'

// Serialization helpers
export { serializePage, escapeHtml } from './serialize.js'

// DevTools
export { createMemoryDevtoolsStore } from './devtools.js'

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
  DevtoolsBodyCapture,
  DevtoolsConfig,
  DevtoolsEntry,
  DevtoolsPropMeta,
  DevtoolsRequestType,
  DevtoolsStore,
  InertiaConfig,
  InertiaContext,
  InertiaEnv,
  PageObject,
  RenderFunction,
  ScrollMetadata,
  SsrConfig,
  SsrHttpConfig,
  SsrRenderConfig,
  SsrRenderResult,
  SsrResult,
} from './types.js'
