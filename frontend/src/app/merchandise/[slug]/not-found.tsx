import Link from 'next/link';

export default function MerchandiseNotFound() {
  return (
    <div className="container merch-not-found">
      <h1>Merchandise not found</h1>
      <Link href="/">← Back to shop</Link>
    </div>
  );
}
