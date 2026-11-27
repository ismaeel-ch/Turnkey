import type { ReactNode } from 'react';
import '@copilotkit/react-core/v2/styles.css';
import './spike/spike.css';

export const metadata = {
  title: 'Turnkey',
  description: 'Describe an app; agents build it on a shared canvas.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
