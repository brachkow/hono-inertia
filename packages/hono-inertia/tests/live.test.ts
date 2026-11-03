import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { inertia } from '../src/middleware.js';
import {
  always,
  broadcastProperties,
  deferred,
  live,
  once,
  optional,
} from '../src/properties.js';
import { serializePage } from '../src/serialize.js';
import type { InertiaEnv, PageObject } from '../src/types.js';

function createApp() {
  const app = new Hono<InertiaEnv>();
  app.use(
    inertia({
      version: '1.0',
      render: (page) =>
        `<script data-page="app" type="application/json">${serializePage(page)}</script>`,
    }),
  );
  return app;
}

const inertiaHeaders = (extra: Record<string, string> = {}) => ({
  'X-Inertia': 'true',
  'X-Inertia-Version': '1.0',
  ...extra,
});

const getPage = (response: Response) => response.json() as Promise<PageObject>;

const ORDER_CHANNEL = { name: 'orders.1', type: 'private' } as const;

describe('live()', () => {
  it('sends the prop and its listeners', async () => {
    const app = createApp();
    app.get('/orders/1', (c) =>
      c.var.inertia.render('Orders/Show', {
        order: live(() => ({ status: 'paid' }), {
          channel: ORDER_CHANNEL,
          on: 'OrderUpdated',
        }),
      }),
    );

    const page = await getPage(
      await app.request('/orders/1', { headers: inertiaHeaders() }),
    );

    expect(page.props.order).toEqual({ status: 'paid' });
    expect(page.liveProps).toEqual({
      order: {
        listeners: [{ channel: ORDER_CHANNEL, events: ['OrderUpdated'] }],
      },
    });
  });

  it('treats a bare channel name as a public channel', () => {
    const property = live(1, { channel: 'dashboard', on: 'MetricsChanged' });

    expect(property.liveMetadata.listeners[0].channel).toEqual({
      name: 'dashboard',
      type: 'public',
    });
  });

  it('pairs each channel only with the events passed alongside it', () => {
    const property = live(1, { channel: 'orders', on: 'OrderCreated' }).live({
      channel: ORDER_CHANNEL,
      on: 'OrderUpdated',
    });

    expect(property.liveMetadata.listeners).toEqual([
      { channel: { name: 'orders', type: 'public' }, events: ['OrderCreated'] },
      { channel: ORDER_CHANNEL, events: ['OrderUpdated'] },
    ]);
  });

  it('joins events for a channel that is already listed', () => {
    const property = live(1, { channel: 'orders', on: 'OrderCreated' }).live({
      channel: 'orders',
      on: ['OrderCreated', 'OrderDeleted'],
    });

    expect(property.liveMetadata.listeners).toEqual([
      {
        channel: { name: 'orders', type: 'public' },
        events: ['OrderCreated', 'OrderDeleted'],
      },
    ]);
  });

  it('includes the throttle when set', () => {
    const property = live(1, {
      channel: 'dashboard',
      on: 'MetricsChanged',
      throttle: 5000,
    });

    expect(property.liveMetadata.throttle).toBe(5000);
  });

  it('throws without an event', () => {
    expect(() => live(1, { channel: 'dashboard', on: [] })).toThrow(
      'at least one channel and one event',
    );
  });

  it('throws without a channel', () => {
    expect(() => live(1, { channel: [], on: 'MetricsChanged' })).toThrow(
      'at least one channel and one event',
    );
  });
});

describe('.live() on other prop types', () => {
  it('sends listeners for a deferred prop on the first visit, without its value', async () => {
    const app = createApp();
    app.get('/', (c) =>
      c.var.inertia.render('Dashboard', {
        stats: deferred(() => 1).live({ channel: 'stats', on: 'StatsChanged' }),
      }),
    );

    const page = await getPage(
      await app.request('/', { headers: inertiaHeaders() }),
    );

    expect(page.props.stats).toBeUndefined();
    expect(page.liveProps?.stats).toBeDefined();
  });

  it('works on optional, always and once props', async () => {
    const options = { channel: 'feed', on: 'FeedChanged' };
    const app = createApp();
    app.get('/', (c) =>
      c.var.inertia.render('Dashboard', {
        a: optional(() => 1).live(options),
        b: always(2).live(options),
        c: once(() => 3).live(options),
      }),
    );

    const page = await getPage(
      await app.request('/', { headers: inertiaHeaders() }),
    );

    expect(Object.keys(page.liveProps ?? {})).toEqual(['a', 'b', 'c']);
  });

  it('keeps the once settings after .live()', () => {
    const property = optional(() => 1)
      .once('feed', 60)
      .live({ channel: 'feed', on: 'FeedChanged' });

    expect(property.isOnce).toBe(true);
    expect(property.onceKey).toBe('feed');
  });

  it('refuses a deferred merge prop', () => {
    expect(() =>
      deferred(() => [])
        .merge()
        .live({ channel: 'feed', on: 'FeedChanged' }),
    ).toThrow('A merge prop cannot be live');
  });

  it('refuses .merge() after .live()', () => {
    expect(() =>
      deferred(() => [])
        .live({ channel: 'feed', on: 'FeedChanged' })
        .merge(),
    ).toThrow('A merge prop cannot be live');
  });
});

describe('Live props in partial reloads', () => {
  it('sends listeners only for the props the reload refreshed', async () => {
    const app = createApp();
    app.get('/', (c) =>
      c.var.inertia.render('Dashboard', {
        orders: live(() => [], { channel: 'orders', on: 'OrderCreated' }),
        stats: live(() => 1, { channel: 'stats', on: 'StatsChanged' }),
      }),
    );

    const page = await getPage(
      await app.request('/', {
        headers: inertiaHeaders({
          'X-Inertia-Partial-Component': 'Dashboard',
          'X-Inertia-Partial-Data': 'stats',
        }),
      }),
    );

    expect(Object.keys(page.liveProps ?? {})).toEqual(['stats']);
  });

  it('sends listeners for a deferred prop when it is fetched', async () => {
    const app = createApp();
    app.get('/', (c) =>
      c.var.inertia.render('Dashboard', {
        stats: deferred(() => 1).live({ channel: 'stats', on: 'StatsChanged' }),
      }),
    );

    const page = await getPage(
      await app.request('/', {
        headers: inertiaHeaders({
          'X-Inertia-Partial-Component': 'Dashboard',
          'X-Inertia-Partial-Data': 'stats',
        }),
      }),
    );

    expect(page.props.stats).toBe(1);
    expect(page.liveProps?.stats).toBeDefined();
  });

  it('leaves liveProps out when the page has none', async () => {
    const app = createApp();
    app.get('/', (c) => c.var.inertia.render('Home', { title: 'Hi' }));

    const page = await getPage(
      await app.request('/', { headers: inertiaHeaders() }),
    );

    expect(page.liveProps).toBeUndefined();
  });
});

describe('broadcastProperties()', () => {
  it('wraps values the way the client reads them from an event', () => {
    expect(broadcastProperties({ order: { status: 'shipped' } })).toEqual({
      __inertia: { props: { order: { status: 'shipped' } } },
    });
  });
});

describe('socketId()', () => {
  it('returns the X-Socket-Id header', async () => {
    const app = createApp();
    app.post('/orders', (c) => c.text(c.var.inertia.socketId() ?? 'none'));

    const response = await app.request('/orders', {
      method: 'POST',
      headers: inertiaHeaders({ 'X-Socket-Id': '1234.5678' }),
    });

    expect(await response.text()).toBe('1234.5678');
  });

  it('returns null without the header', async () => {
    const app = createApp();
    app.post('/orders', (c) => c.text(c.var.inertia.socketId() ?? 'none'));

    const response = await app.request('/orders', { method: 'POST' });

    expect(await response.text()).toBe('none');
  });
});
