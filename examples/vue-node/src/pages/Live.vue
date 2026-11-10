<script setup lang="ts">
  import { usePageProps } from '@brachkow/hono-inertia/vue';

  const page = usePageProps<'Live'>();
</script>

<template>
  <p data-testid="live-token">{{ page.token }}</p>
</template>
