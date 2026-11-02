import { notFound } from 'next/navigation';

// Unknown paths under a locale get the localized 404.
export default function CatchAll() {
  notFound();
}
