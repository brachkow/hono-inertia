import { useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';

const Contact = () => {
  const form = useForm({ name: '' });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    form.post('/contact');
  };

  return (
    <>
      <h1>Contact</h1>
      <form onSubmit={submit}>
        <label>
          Name
          <input
            name="name"
            value={form.data.name}
            onChange={(event) => form.setData('name', event.target.value)}
          />
        </label>
        {form.errors.name && <p data-testid="error">{form.errors.name}</p>}
        <button type="submit" disabled={form.processing}>
          Send
        </button>
      </form>
    </>
  );
};

export default Contact;
