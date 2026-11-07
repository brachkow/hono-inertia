<script setup lang="ts">
  import { usePageProps } from '@brachkow/hono-inertia/vue';

  // Reads the props from the current page, so no prop names are written out.
  // Read them as page.x: a destructured prop keeps the first page's value.
  const page = usePageProps<'Home'>();
</script>

<template>
  <h1>Hello from {{ page.framework }}</h1>
</template>
