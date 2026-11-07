import { Deferred, router } from '@inertiajs/react';
import type { PageProps } from '../../pages.gen';

// From the /users route in src/server.ts: optional() and deferred() props are
// possibly undefined, merge() gives the users array
const Index = ({
  users,
  page,
  hasMore,
  stats,
  activity,
}: PageProps<'Users/Index'>) => {
  // Partial reloads fetch only the named props; `users` is a merge prop, so
  // the next page is appended to the list instead of replacing it
  const loadMore = () =>
    router.reload({
      data: { page: page + 1 },
      only: ['users', 'page', 'hasMore'],
    });
  const loadStats = () => router.reload({ only: ['stats'] });

  return (
    <>
      <h1>Users</h1>
      <ul data-testid="users">
        {users.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
      {hasMore && (
        <button type="button" onClick={loadMore}>
          Load more
        </button>
      )}

      <button type="button" onClick={loadStats}>
        Load stats
      </button>
      {stats && <p data-testid="stats">{stats.total} users in total</p>}

      <Deferred
        data="activity"
        fallback={<p data-testid="activity-loading">Loading activity…</p>}>
        <ul data-testid="activity">
          {activity?.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      </Deferred>
    </>
  );
};

export default Index;
