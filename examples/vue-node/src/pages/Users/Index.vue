<script setup lang="ts">
  import { Deferred, router } from '@inertiajs/vue3';

  const properties = defineProps<{
    users: Array<{ id: number; name: string }>;
    page: number;
    hasMore: boolean;
    stats?: { total: number };
    activity?: string[];
  }>();

  // Partial reloads fetch only the named props; `users` is a merge prop, so
  // the next page is appended to the list instead of replacing it
  const loadMore = () =>
    router.reload({
      data: { page: properties.page + 1 },
      only: ['users', 'page', 'hasMore'],
    });
  const loadStats = () => router.reload({ only: ['stats'] });
</script>

<template>
  <h1>Users</h1>
  <ul data-testid="users">
    <li v-for="user in users" :key="user.id">{{ user.name }}</li>
  </ul>
  <button v-if="hasMore" type="button" @click="loadMore">Load more</button>

  <button type="button" @click="loadStats">Load stats</button>
  <p v-if="stats" data-testid="stats">{{ stats.total }} users in total</p>

  <Deferred data="activity">
    <template #fallback>
      <p data-testid="activity-loading">Loading activity…</p>
    </template>
    <ul data-testid="activity">
      <li v-for="entry in activity" :key="entry">{{ entry }}</li>
    </ul>
  </Deferred>
</template>
