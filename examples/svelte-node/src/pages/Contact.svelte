<script lang="ts">
  import { useForm } from '@inertiajs/svelte';

  // withPrecognition lets validate() check a field against the server's
  // schema while the user fills in the form
  const form = useForm({ name: '', email: '' }).withPrecognition(
    'post',
    '/contact',
  );
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    form.post('/contact');
  };
</script>

<h1>Contact</h1>
<form onsubmit={submit}>
  <label>
    Name
    <input
      bind:value={form.name}
      name="name"
      onblur={() => form.validate('name')} />
  </label>
  {#if form.errors.name}
    <p data-testid="name-error">{form.errors.name}</p>
  {/if}
  <label>
    Email
    <input
      bind:value={form.email}
      name="email"
      onblur={() => form.validate('email')} />
  </label>
  {#if form.errors.email}
    <p data-testid="email-error">{form.errors.email}</p>
  {/if}
  <button type="submit" disabled={form.processing}>Send</button>
</form>
