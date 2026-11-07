import type {
  InertiaAssets,
  RenderFunction,
  SsrResult,
  TemplateOptions,
} from './types.js';
import { escapeHtml, serializePage } from './serialize.js';

const TITLE_TAG = /<title[\s>]/i;

// The <title> from options, unless SSR rendered one from the page's <Head>
const titleTag = (title: string | undefined, ssr: SsrResult | undefined) =>
  title === undefined || (ssr && TITLE_TAG.test(ssr.head))
    ? ''
    : `<title>${escapeHtml(title)}</title>`;

// The root template an app gets without its own `render`: the page in a
// data-page script and an empty root element, or the SSR head and body, plus
// the asset tags the Vite plugin provides
export const createTemplate =
  (options: TemplateOptions = {}, assets?: InertiaAssets): RenderFunction =>
  async (page, _viewData, ssr, c) => {
    const id = options.id ?? 'app';
    const lang =
      options.lang === undefined ? '' : ` lang="${escapeHtml(options.lang)}"`;
    const head = [
      '<meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      titleTag(options.title, ssr),
      ssr?.head ?? '',
      typeof options.head === 'function'
        ? await options.head(page, c)
        : (options.head ?? ''),
      assets?.assetTagsFor(page.component) ?? '',
    ].join('');
    const body =
      ssr?.body ??
      `<script data-page="${escapeHtml(id)}" type="application/json">${serializePage(page)}</script><div id="${escapeHtml(id)}"></div>`;
    return `<!DOCTYPE html><html${lang}><head>${head}</head><body>${body}</body></html>`;
  };
