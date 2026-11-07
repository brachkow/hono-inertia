<script lang="ts">
  import { Deferred, router } from '@inertiajs/svelte';
  import type { PageProps } from '../../pages.gen';

  const { users, page, hasMore, stats, activity }: PageProps<'Users/Index'> =
    $props();

  // Partial reloads fetch only the named props; `users` is a merge prop, so
  // the next page is appended to the list instead of replacing it
  const loadMore = () =>
    router.reload({
      data: { page: page + 1 },
      only: ['users', 'page', 'hasMore'],
    });
  const loadStats = () => router.reload({ only: ['stats'] });
</script>

<h1>Users</h1>
<ul data-testid="users">
  {#each users as user (user.id)}
    <li>{user.name}</li>
  {/each}
</ul>
{#if hasMore}
  <button type="button" onclick={loadMore}>Load more</button>
{/if}

<button type="button" onclick={loadStats}>Load stats</button>
{#if stats}
  <p data-testid="stats">{stats.total} users in total</p>
{/if}

<Deferred data="activity">
  {#snippet fallback()}
    <p data-testid="activity-loading">Loading activity…</p>
  {/snippet}
  <ul data-testid="activity">
    {#each activity ?? [] as entry (entry)}
      <li>{entry}</li>
    {/each}
  </ul>
</Deferred>
