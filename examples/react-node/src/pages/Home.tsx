import type { PageProps } from '../pages.gen';

const Home = ({ framework }: PageProps<'Home'>) => (
  <h1>Hello from {framework}</h1>
);

export default Home;
