import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Account | NetworkBase' };

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
