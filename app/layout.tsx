import type { ReactNode } from 'react';

export const metadata = {
  title: 'Commute Copilot',
  description: 'Marysville to Bellevue commute traffic dashboard',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fafafa', color: '#111' }}>{children}</body>
    </html>
  );
}
