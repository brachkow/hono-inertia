<script setup lang="ts">
  import type { PageProps } from '../pages.gen';

  type Properties = PageProps<'Live'>;

  defineProps<{ token: Properties['token'] }>();
</script>

<template>
  <p data-testid="live-token">{{ token }}</p>
</template>
