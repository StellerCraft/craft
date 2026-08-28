import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { config } from '@/lib/config';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
    title: config.branding.appName,
    description: 'Decentralized exchange powered by Stellar',
};

export default function RootLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <html lang="en">
            <head>
                <style>{`
                    :root {
                        --primary-color: ${config.branding.primaryColor};
                        --secondary-color: ${config.branding.secondaryColor};
                    }
                `}</style>
            </head>
            <body className={inter.className}>{children}</body>
        </html>
    );
}
