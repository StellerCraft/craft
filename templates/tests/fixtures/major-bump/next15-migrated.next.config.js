/**
 * Fixture (Issue #1319): a next.config.js correctly migrated for Next.js 15.
 * `experimental.serverComponentsExternalPackages` was promoted to the
 * top-level `serverExternalPackages`, and the removed `swcMinify` flag is gone.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['@stellar/stellar-sdk'],
};

module.exports = nextConfig;
