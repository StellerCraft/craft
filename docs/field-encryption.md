# Field-Level Encryption

## Encrypted fields

| Table | Column | Encryption module |
|-------|--------|-------------------|
| `profiles` | `github_token_encrypted` | `lib/github/token-encryption.ts` (key: `GITHUB_TOKEN_ENCRYPTION_KEY`) |
| `profiles` | `stripe_customer_id_encrypted` | `lib/crypto/field-encryption.ts` (key: `FIELD_ENCRYPTION_KEY`) |
| `profiles` | `stripe_subscription_id_encrypted` | `lib/crypto/field-encryption.ts` (key: `FIELD_ENCRYPTION_KEY`) |

All other sensitive values (`STRIPE_SECRET_KEY`, `VERCEL_TOKEN`, etc.) are used only at runtime from environment variables and are never persisted to the database.

## Setting FIELD_ENCRYPTION_KEY

Generate a 32-byte key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add to your environment:

```env
FIELD_ENCRYPTION_KEY=<64-char hex string>
```

## Blob format

Encrypted values are stored as:

```
v<version>.<iv_base64url>.<ciphertext_base64url>.<tag_base64url>
```

- `version` — key version number (used for rotation)
- `iv` — 12-byte random initialisation vector (unique per encryption call)
- `ciphertext` — AES-256-GCM encrypted UTF-8 plaintext
- `tag` — 16-byte GCM authentication tag (detects tampering)

## Key rotation procedure

### Automated rotation (recommended)

Profile encryption keys are rotated automatically every Sunday at 04:00 UTC via a scheduled cron job (`/api/cron/rotate-encryption-keys`). The job uses the active `FIELD_ENCRYPTION_KEY` (or `FIELD_ENCRYPTION_KEY_<N>` if `KEY_VERSION > 1`) to re-encrypt all rows in the `profiles` table that have encrypted Stripe fields.

**To trigger a rotation:**

1. Generate a new key: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
2. Set it as `FIELD_ENCRYPTION_KEY_<N>` in production (e.g. `FIELD_ENCRYPTION_KEY_2`).
3. Update `KEY_VERSION` in `lib/crypto/field-encryption.ts` to `N`.
4. Deploy — the next scheduled rotation will automatically re-encrypt all rows with the new key.
5. Once all rows are confirmed re-encrypted, remove the old key env var from production.

The cron job is idempotent and safe to run multiple times: rows already encrypted with the current `KEY_VERSION` are skipped.

### Manual rotation

To manually rotate keys (e.g., for testing or in development):

```bash
FIELD_ENCRYPTION_KEY=<old-key> \
FIELD_ENCRYPTION_KEY_2=<new-key> \
NEXT_PUBLIC_SUPABASE_URL=<url> \
SUPABASE_SERVICE_ROLE_KEY=<key> \
npx tsx apps/backend/src/lib/crypto/key-rotation.ts
```

## Assumptions

- HSM / KMS integration is out of scope. Keys are environment-variable sourced.
- The `github_token_encrypted` column uses a separate key (`GITHUB_TOKEN_ENCRYPTION_KEY`) for historical reasons. Both use AES-256-GCM with the same blob format.
- Multi-key versioning beyond a single active key is supported by the version prefix but not automated.
