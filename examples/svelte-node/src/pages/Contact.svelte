<script lang="ts">
  import { useForm } from '@inertiajs/svelte';

  const form = useForm({ name: '' });
  const submit = (event: SubmitEvent) => {
    event.preventDefault();
    form.post('/contact');
  };
</script>

<h1>Contact</h1>
<form onsubmit={submit}>
  <label>
    Name
    <input bind:value={form.name} name="name" />
  </label>
  {#if form.errors.name}
    <p data-testid="error">{form.errors.name}</p>
  {/if}
  <button type="submit" disabled={form.processing}>Send</button>
</form>
