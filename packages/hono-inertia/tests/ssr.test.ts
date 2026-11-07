import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { renderSsr } from '../src/ssr.js';
import type { PageObject } from '../src/types.js';

const SSR_502_MESSAGE = /^SSR server responded with 502$/;

const mockPage: PageObject = {
  component: 'Test',
  props: { data: 'value' },
  url: '/test',
  version: '1.0',
};

// renderSsr only hands the context to a custom fetch. Hono 4.8 doesn't
// export the Context class, so a request provides one.
let context: Context | undefined;
const c = (): Context => {
  if (!context) throw new Error('no context yet');
  return context;
};

beforeAll(async () => {
  await new Hono()
    .get('/', (honoContext) => {
      context = honoContext;
      return honoContext.body(null);
    })
    .request('/');
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('renderSsr over HTTP', () => {
  it('sends POST to SSR server and returns result', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () =>
        Promise.resolve({
          head: ['<title>Test</title>', '<meta name="desc" content="x">'],
          body: '<div id="app">rendered</div>',
        }),
    });
    vi.stubGlobal('fetch', mockFetch);

    const result = await renderSsr(
      { url: 'http://localhost:13714' },
      mockPage,
      c(),
    );

    expect(mockFetch).toHaveBeenCalledWith('http://localhost:13714/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mockPage),
      signal: expect.any(AbortSignal),
    });
    expect(result).toEqual({
      head: '<title>Test</title>\n<meta name="desc" content="x">',
      body: '<div id="app">rendered</div>',
    });
  });

  it('rejects with the SSR server error message and details on HTTP error', async () => {
    const details = {
      error: 'window is not defined',
      type: 'browser-api',
      hint: 'Use onMounted',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        json: () => Promise.resolve(details),
      }),
    );

    const result = renderSsr({ url: 'http://localhost:13714' }, mockPage, c());

    await expect(result).rejects.toThrow(
      'SSR server responded with 500: window is not defined',
    );
    await expect(result).rejects.toMatchObject({ cause: details });
  });

  it('rejects on HTTP error without a JSON body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 502,
        headers: new Headers(),
        json: () =>
          Promise.reject(new SyntaxError('Unexpected end of JSON input')),
      }),
    );

    await expect(
      renderSsr({ url: 'http://localhost:13714' }, mockPage, c()),
    ).rejects.toThrow(SSR_502_MESSAGE);
  });

  it('rejects on network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    await expect(
      renderSsr({ url: 'http://localhost:13714' }, mockPage, c()),
    ).rejects.toThrow('ECONNREFUSED');
  });

  it('uses default URL when none provided', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: () => Promise.resolve({ head: [], body: '' }),
    });
    vi.stubGlobal('fetch', mockFetch);

    await renderSsr({}, mockPage, c());

    expect(mockFetch).toHaveBeenCalledWith(
      'http://127.0.0.1:13714/render',
      expect.any(Object),
    );
  });

  it('rejects when the SSR response shape is invalid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers(),
        json: () => Promise.resolve({ head: 'not-an-array', body: 42 }),
      }),
    );

    await expect(
      renderSsr({ url: 'http://localhost:13714' }, mockPage, c()),
    ).rejects.toThrow(
      'SSR render must return { head: string[], body: string }',
    );
  });

  it('rejects when the response exceeds maxResponseBytes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({ 'Content-Length': '5000000' }),
        json: () => Promise.resolve({ head: [], body: '' }),
      }),
    );

    await expect(
      renderSsr(
        { url: 'http://localhost:13714', maxResponseBytes: 1000 },
        mockPage,
        c(),
      ),
    ).rejects.toThrow('SSR response exceeds maxResponseBytes (1000)');
  });
});

describe('renderSsr over HTTP with an oversized error response', () => {
  it('rejects without reading the body', async () => {
    const json = vi.fn().mockResolvedValue({ error: 'x'.repeat(10) });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers({ 'Content-Length': '5000000' }),
        json,
      }),
    );

    await expect(
      renderSsr(
        { url: 'http://localhost:13714', maxResponseBytes: 1000 },
        mockPage,
        c(),
      ),
    ).rejects.toThrow('SSR response exceeds maxResponseBytes (1000)');
    expect(json).not.toHaveBeenCalled();
  });
});

describe('renderSsr in process', () => {
  it('passes the page to the render function and joins head', async () => {
    const render = vi.fn().mockResolvedValue({
      head: ['<title>Test</title>', '<meta name="desc" content="x">'],
      body: '<div id="app">rendered</div>',
    });

    const result = await renderSsr({ render }, mockPage, c());

    expect(render).toHaveBeenCalledWith(mockPage);
    expect(result).toEqual({
      head: '<title>Test</title>\n<meta name="desc" content="x">',
      body: '<div id="app">rendered</div>',
    });
  });

  it('accepts a synchronous render function', async () => {
    const result = await renderSsr(
      { render: () => ({ head: [], body: '<div></div>' }) },
      mockPage,
      c(),
    );

    expect(result).toEqual({ head: '', body: '<div></div>' });
  });

  it('does not call fetch', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    await renderSsr({ render: () => ({ head: [], body: '' }) }, mockPage, c());

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('rejects with the error the render function throws', async () => {
    const error = new Error('Page not found: Missing');

    await expect(
      renderSsr({ render: () => Promise.reject(error) }, mockPage, c()),
    ).rejects.toBe(error);
  });

  it('rejects when head contains a non-string', async () => {
    await expect(
      renderSsr(
        {
          render: () => ({
            head: ['<title>x</title>', 42] as unknown as string[],
            body: '',
          }),
        },
        mockPage,
        c(),
      ),
    ).rejects.toThrow(
      'SSR render must return { head: string[], body: string }',
    );
  });

  it('rejects when the render function returns nothing', async () => {
    await expect(
      renderSsr(
        {
          render: () =>
            undefined as unknown as { head: string[]; body: string },
        },
        mockPage,
        c(),
      ),
    ).rejects.toThrow(
      'SSR render must return { head: string[], body: string }',
    );
  });
});
