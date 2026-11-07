<script setup lang="ts">
  import type { PageProps } from '../pages.gen';

  // Vue's compiler needs the prop names written out, so each one takes its
  // type from the route that renders this page
  type Properties = PageProps<'Home'>;

  defineProps<{ framework: Properties['framework'] }>();
</script>

<template>
  <h1>Hello from {{ framework }}</h1>
</template>
