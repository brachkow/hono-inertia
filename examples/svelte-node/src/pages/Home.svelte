<script lang="ts">
  import type { PageProps } from '../pages.gen';

  const { framework }: PageProps<'Home'> = $props();
</script>

<h1>Hello from {framework}</h1>
