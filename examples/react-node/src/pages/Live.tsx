import type { PageProps } from '../pages.gen';

const Live = ({ token }: PageProps<'Live'>) => (
  <p data-testid="live-token">{token}</p>
);

export default Live;
