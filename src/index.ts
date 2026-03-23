// Middleware factory
export { inertia } from './middleware.js'

// Prop wrappers
export {
  optional,
  always,
  deferred,
  merge,
  prepend,
  deepMerge,
  once,
  isTaggedProp,
} from './props.js'

// Types
export type {
  InertiaConfig,
  InertiaContext,
  InertiaEnv,
  PageObject,
  RenderFunction,
  SsrConfig,
  SsrResult,
} from './types.js'
