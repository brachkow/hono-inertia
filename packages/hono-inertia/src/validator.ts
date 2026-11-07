import type { Context, Env, MiddlewareHandler, ValidationTargets } from 'hono';
import { validator } from 'hono/validator';
import type { InertiaContext, InertiaEnv, ValidationErrors } from './types.js';
import { isInertiaRequest, parseHeaderList } from './utilities.js';

// ---------------------------------------------------------------------------
// Standard Schema (https://standardschema.dev). The spec asks libraries to
// copy these types instead of depending on a package, and Zod, Valibot and
// ArkType schemas all match them.
// ---------------------------------------------------------------------------

export interface StandardSchemaPathSegment {
  readonly key: PropertyKey;
}

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?:
    ReadonlyArray<PropertyKey | StandardSchemaPathSegment> | undefined;
}

export type StandardSchemaResult<Output> =
  | { readonly value: Output; readonly issues?: undefined }
  | { readonly issues: readonly StandardSchemaIssue[] };

export interface StandardSchema<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown,
    ) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
    readonly types?:
      { readonly input: Input; readonly output: Output } | undefined;
  };
}

type InferOutput<Schema extends StandardSchema> = NonNullable<
  Schema['~standard']['types']
>['output'];

// ---------------------------------------------------------------------------
// inertiaValidator(target, schema)
// ---------------------------------------------------------------------------

// Issues without a path, such as a refinement over the whole object, go under
// this key. react-hook-form uses the same name for form-level errors.
export const ROOT_ERROR_KEY = 'root';

const issueKey = (issue: StandardSchemaIssue): string =>
  issue.path && issue.path.length > 0
    ? issue.path
        .map((segment) =>
          String(typeof segment === 'object' ? segment.key : segment),
        )
        .join('.')
    : ROOT_ERROR_KEY;

// Every message per field, keyed by dotted path (`items.0.name`)
const toValidationErrors = (
  issues: readonly StandardSchemaIssue[],
): Record<string, string[]> => {
  const errors: Record<string, string[]> = {};
  for (const issue of issues) {
    const key = issueKey(issue);
    (errors[key] ??= []).push(issue.message);
  }
  return errors;
};

// null without the header, so every field is validated
const parseFieldList = (header: string | undefined): Set<string> | null =>
  header === undefined ? null : parseHeaderList(header);

const VALIDATION_FAILED = 'The given data was invalid.';

// The validator's context carries the route's Env, which need not mention the
// inertia variable, so it is read through the app-wide InertiaEnv type
const getInertia = (c: Context): InertiaContext | undefined =>
  (c as Context<InertiaEnv>).var.inertia;

// Validates one request target against a Standard Schema, the way Laravel's
// form requests behave for Inertia:
// - A precognition request (`Precognition: true`) never reaches the handler.
//   It gets 204 when the fields in Precognition-Validate-Only pass, or 422 with
//   their errors.
// - A failed Inertia or form submit redirects back with the errors in the
//   session. A non-Inertia request that accepts JSON gets a 422 instead.
// - A valid submit reaches the handler, which reads c.req.valid(target).
export const inertiaValidator = <
  Schema extends StandardSchema,
  Target extends keyof ValidationTargets,
  E extends Env = Env,
  P extends string = string,
>(
  target: Target,
  schema: Schema,
): MiddlewareHandler<
  E,
  P,
  {
    in: Record<Target, ValidationTargets[Target]>;
    out: Record<Target, InferOutput<Schema>>;
  }
> =>
  validator(target, async (value, c) => {
    const precognitive = c.req.header('Precognition') === 'true';
    // Precognition and real responses for one URL differ, so caches must too
    c.header('Vary', 'Precognition', { append: true });

    const result = await schema['~standard'].validate(value);
    const issues = result.issues ?? [];

    if (precognitive) {
      const only = parseFieldList(c.req.header('Precognition-Validate-Only'));
      const errors = toValidationErrors(
        only ? issues.filter((issue) => only.has(issueKey(issue))) : issues,
      );
      if (Object.keys(errors).length > 0) {
        return c.json({ message: VALIDATION_FAILED, errors }, 422, {
          Precognition: 'true',
        });
      }
      return c.body(null, 204, {
        Precognition: 'true',
        'Precognition-Success': 'true',
      });
    }

    if (result.issues) {
      const errors: ValidationErrors = toValidationErrors(result.issues);
      const wantsJson =
        !isInertiaRequest(c) &&
        (c.req.header('Accept') ?? '').includes('application/json');
      if (wantsJson) {
        return c.json({ message: VALIDATION_FAILED, errors }, 422);
      }

      const inertia = getInertia(c);
      if (!inertia) {
        throw new Error(
          '[hono-inertia] inertiaValidator() runs after the inertia() middleware',
        );
      }
      inertia.withErrors(errors);
      return inertia.back();
    }

    return result.value;
  });
