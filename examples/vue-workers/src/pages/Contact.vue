<script setup lang="ts">
  import { useForm } from '@inertiajs/vue3';

  const form = useForm({ name: '' });
  const submit = () => form.post('/contact');
</script>

<template>
  <h1>Contact</h1>
  <form @submit.prevent="submit">
    <label>
      Name
      <input v-model="form.name" name="name" />
    </label>
    <p v-if="form.errors.name" data-testid="error">{{ form.errors.name }}</p>
    <button type="submit" :disabled="form.processing">Send</button>
  </form>
</template>
