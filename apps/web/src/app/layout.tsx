import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Craft - Build & Deploy DeFi on Stellar in Minutes',
  description: 'No-code platform for building and deploying DeFi applications on Stellar blockchain',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
