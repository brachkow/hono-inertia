<script lang="ts">
  import { Link, usePage } from '@inertiajs/svelte';
  import type { Snippet } from 'svelte';

  const { children }: { children: Snippet } = $props();

  const page = usePage<{ appName: string }>();
  const flash = $derived(page.flash as { message?: string } | undefined);
</script>

<header>
  <strong data-testid="app-name">{page.props.appName}</strong>
  <nav>
    <Link href="/">Home</Link>
    <Link href="/users">Users</Link>
    <Link href="/contact">Contact</Link>
  </nav>
</header>
{#if flash?.message}
  <p data-testid="flash">{flash.message}</p>
{/if}
<main>
  {@render children()}
</main>
