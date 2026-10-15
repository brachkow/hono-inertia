import { Link, usePage } from '@inertiajs/react';
import type { ReactNode } from 'react';

export const Layout = ({ children }: { children: ReactNode }) => {
  const page = usePage<{ appName: string }>();
  const flash = page.flash as { message?: string };

  return (
    <>
      <header>
        <strong data-testid="app-name">{page.props.appName}</strong>
        <nav>
          <Link href="/">Home</Link>
          <Link href="/users">Users</Link>
          <Link href="/contact">Contact</Link>
        </nav>
      </header>
      {flash.message && <p data-testid="flash">{flash.message}</p>}
      <main>{children}</main>
    </>
  );
};
