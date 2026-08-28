import { config } from '@/lib/config';

export default function Home() {
    return (
        <main className="min-h-screen p-8">
            <div className="max-w-4xl mx-auto">
                <h1 className="text-4xl font-bold mb-4" style={{ color: 'var(--primary-color)' }}>
                    {config.branding.appName}
                </h1>
                <p className="text-lg text-gray-600 mb-8">
                    Decentralized exchange powered by Stellar
                </p>

                <div className="bg-white rounded-lg shadow-lg p-6">
                    <h2 className="text-2xl font-semibold mb-4">Swap Tokens</h2>
                    <p className="text-gray-600">
                        Connect your wallet to start trading on the Stellar network.
                    </p>

                    <div className="mt-6 p-4 rounded" style={{ backgroundColor: config.branding.secondaryColor + '20' }}>
                        <p className="text-sm" style={{ color: config.branding.secondaryColor }}>
                            Network: <strong>{config.stellar.network}</strong>
                        </p>
                        <p className="text-sm" style={{ color: config.branding.secondaryColor }}>
                            Horizon: <strong>{config.stellar.horizonUrl}</strong>
                        </p>
                    </div>
                </div>
            </div>
        </main>
    );
}
