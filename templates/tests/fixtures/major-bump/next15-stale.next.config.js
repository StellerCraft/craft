/**
 * Fixture (Issue #1319): an INTENTIONALLY INCONSISTENT next.config.js.
 * The template's package.json has been bumped to Next.js 15, but this config
 * still uses the Next.js 14 shape. The major-bump check must flag it.
 */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  experimental: {
    serverComponentsExternalPackages: ['@stellar/stellar-sdk'],
  },
};

module.exports = nextConfig;
