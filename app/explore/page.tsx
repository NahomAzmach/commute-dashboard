import { redirect } from 'next/navigation';

// Explore is now the site's home page - this just catches anyone who
// bookmarked the old path.
export default function ExploreRedirect() {
  redirect('/');
}
