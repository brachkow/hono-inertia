<script setup lang="ts">
  import { Link, usePage } from '@inertiajs/vue3';
  import { computed } from 'vue';

  const page = usePage<{ appName: string }>();
  const flash = computed(() => page.flash as { message?: string });
</script>

<template>
  <header>
    <strong data-testid="app-name">{{ page.props.appName }}</strong>
    <nav>
      <Link href="/">Home</Link>
      <Link href="/users">Users</Link>
      <Link href="/contact">Contact</Link>
    </nav>
  </header>
  <p v-if="flash.message" data-testid="flash">{{ flash.message }}</p>
  <main>
    <slot />
  </main>
</template>
