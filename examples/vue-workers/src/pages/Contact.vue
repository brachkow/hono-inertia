<script setup lang="ts">
  import { useForm } from '@inertiajs/vue3';

  // withPrecognition lets validate() check a field against the server's
  // schema while the user fills in the form
  const form = useForm({ name: '', email: '' }).withPrecognition(
    'post',
    '/contact',
  );
  const submit = () => form.post('/contact');
</script>

<template>
  <h1>Contact</h1>
  <form @submit.prevent="submit">
    <label>
      Name
      <input v-model="form.name" name="name" @blur="form.validate('name')" />
    </label>
    <p v-if="form.errors.name" data-testid="name-error">
      {{ form.errors.name }}
    </p>
    <label>
      Email
      <input v-model="form.email" name="email" @blur="form.validate('email')" />
    </label>
    <p v-if="form.errors.email" data-testid="email-error">
      {{ form.errors.email }}
    </p>
    <button type="submit" :disabled="form.processing">Send</button>
  </form>
</template>
