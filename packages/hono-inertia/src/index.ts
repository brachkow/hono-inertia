// Middleware factory
export { inertia, CLEAR_HISTORY_COOKIE } from './middleware.js';

// Serialization helpers
export { serializePage, escapeHtml } from './serialize.js';

// DevTools
export { createMemoryDevtoolsStore } from './devtools.js';

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
  isTaggedProperty,
} from './properties.js';

// Types
export type {
  DevtoolsBodyCapture,
  DevtoolsConfig,
  DevtoolsEntry,
  DevtoolsPropertyMeta,
  DevtoolsRequestType,
  DevtoolsStore,
  InertiaConfig,
  InertiaContext,
  InertiaEnvironment,
  PageObject,
  RenderFunction,
  ScrollMetadata,
  SsrConfig,
  SsrHttpConfig,
  SsrRenderConfig,
  SsrRenderResult,
  SsrResult,
} from './types.js';
