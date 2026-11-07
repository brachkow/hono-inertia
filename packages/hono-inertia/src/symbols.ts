// Tags a prop wrapper with its type. Symbol.for, so two copies of the package
// in one bundle still recognize each other's props.
export const PROP_TYPE: unique symbol = Symbol.for('hono-inertia.prop-type');
