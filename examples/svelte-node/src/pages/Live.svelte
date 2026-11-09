<script lang="ts">
  import type { PageProps } from '../pages.gen';

  const { token }: PageProps<'Live'> = $props();
</script>

<p data-testid="live-token">{token}</p>
