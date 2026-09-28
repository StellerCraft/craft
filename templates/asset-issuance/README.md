# Stellar Asset Issuance Template

A platform for creating and managing Stellar assets.

## Features

- Issue custom assets
- Manage asset distribution
- Set trustlines
- Asset analytics
- Customizable branding

## Getting Started

```bash
npm install
npm run dev
```

## Environment Variables

Copy `.env.example` to `.env.local` and fill in the values. The optional
`COMPLIANCE_BLOCKLIST_JSON` / `COMPLIANCE_JURISDICTION_JSON` variables configure
the issuer blocklist and jurisdiction rules used by `@craft/stellar`'s asset
compliance checks — see the comments in `.env.example` for the expected JSON format.
