import type {
  InertiaAssets,
  RenderFunction,
  SsrResult,
  TemplateOptions,
} from './types.js';
import { escapeHtml, serializePage } from './serialize.js';

const TITLE_TAG = /<title[\s>]/i;
// The names HTML allows unquoted in a tag, so a name can't break out of it
const ATTRIBUTE_NAME = /^[:A-Z_a-z][\w.:-]*$/;

// The <title> from options, unless SSR rendered one from the page's <Head>
const titleTag = (title: string | undefined, ssr: SsrResult | undefined) =>
  title === undefined || (ssr && TITLE_TAG.test(ssr.head))
    ? ''
    : `<title>${escapeHtml(title)}</title>`;

// ' lang="en" data-theme="dark"', leaving out undefined values
const attributesOf = (attributes: Record<string, string | undefined>) =>
  Object.entries(attributes)
    .flatMap(([name, value]) => {
      if (value === undefined) return [];
      if (!ATTRIBUTE_NAME.test(name)) {
        throw new Error(
          `[hono-inertia] template.htmlAttributes has an invalid name: ${name}`,
        );
      }
      return [` ${name}="${escapeHtml(value)}"`];
    })
    .join('');

// The root template an app gets without its own `render`: the page in a
// data-page script and an empty root element, or the SSR head and body, plus
// the asset tags the Vite plugin provides. The asset tags come before the SSR
// head, so the browser starts fetching them first.
export const createTemplate =
  (options: TemplateOptions = {}, assets?: InertiaAssets): RenderFunction =>
  async (page, viewData, ssr, c) => {
    const id = options.id ?? 'app';
    const lang =
      typeof options.lang === 'function'
        ? await options.lang(page, c)
        : options.lang;
    const attributes = attributesOf({
      lang,
      ...(await options.htmlAttributes?.(page, c)),
    });
    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      titleTag(options.title, ssr),
      assets?.assetTagsFor(page.component) ?? '',
      ssr?.head ?? '',
      typeof options.head === 'function'
        ? await options.head(page, c, viewData, ssr)
        : (options.head ?? ''),
    ].join('');
    const body =
      ssr?.body ??
      `<script data-page="${escapeHtml(id)}" type="application/json">${serializePage(page)}</script><div id="${escapeHtml(id)}"></div>`;
    return `<!DOCTYPE html><html${attributes}><head>${head}</head><body>${body}</body></html>`;
  };
