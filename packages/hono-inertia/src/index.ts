// Middleware factory
export { inertia, inertiaShare, CLEAR_HISTORY_COOKIE } from './middleware.js';

// Serialization helpers
export { serializePage, escapeHtml } from './serialize.js';

// Session store
export { cookieSession } from './session.js';
export type { CookieSecret, CookieSessionOptions } from './session.js';

// Validation and precognition
export { inertiaValidator, ROOT_ERROR_KEY } from './validator.js';
export type {
  StandardSchema,
  StandardSchemaIssue,
  StandardSchemaPathSegment,
  StandardSchemaResult,
} from './validator.js';

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
  live,
  broadcastProperties,
  isTaggedProp,
} from './properties.js';

// Types
export type {
  BackOptions,
  DevtoolsBodyCapture,
  DevtoolsConfig,
  DevtoolsEntry,
  DevtoolsPropMeta,
  DevtoolsRequestType,
  DevtoolsStore,
  InertiaConfig,
  InertiaContext,
  InertiaEnv,
  InertiaSession,
  LiveChannel,
  LiveChannelType,
  LiveListener,
  LiveOptions,
  LivePropertyMetadata,
  PageObject,
  RenderFunction,
  ScrollMetadata,
  SsrConfig,
  SsrHttpConfig,
  SsrRenderConfig,
  SsrRenderResult,
  SsrResult,
  SessionData,
  ValidationErrors,
} from './types.js';

// Typed page props
export type {
  AppRegistry,
  InertiaPages,
  InertiaSharedEnv,
  SharedProps,
  PageName,
  PageProps,
  PagePropsFor,
  RenderResponse,
  ResolvedProperties,
  MissingVuePagePropsFor,
  VuePage,
} from './page-properties.js';
