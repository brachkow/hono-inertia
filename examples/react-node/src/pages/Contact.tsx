import { useForm } from '@inertiajs/react';
import type { FormEvent } from 'react';

const Contact = () => {
  // withPrecognition lets validate() check a field against the server's
  // schema while the user fills in the form
  const form = useForm({ name: '', email: '' }).withPrecognition(
    'post',
    '/contact',
  );
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
            onBlur={() => form.validate('name')}
          />
        </label>
        {form.errors.name && <p data-testid="name-error">{form.errors.name}</p>}
        <label>
          Email
          <input
            name="email"
            value={form.data.email}
            onChange={(event) => form.setData('email', event.target.value)}
            onBlur={() => form.validate('email')}
          />
        </label>
        {form.errors.email && (
          <p data-testid="email-error">{form.errors.email}</p>
        )}
        <button type="submit" disabled={form.processing}>
          Send
        </button>
      </form>
    </>
  );
};

export default Contact;
