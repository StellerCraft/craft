-- Migration 014: Email Notification Delivery Tracking
--
-- Stores an audit trail of every transactional email dispatched by the
-- EmailDeliveryService, plus the latest delivery status reported by the
-- email provider via webhook (sent → delivered / bounced / opened).
--
-- Issue: #769 — Email Notification Delivery Service with Template Rendering
--               and Delivery Tracking

-- ── Email Deliveries Table ───────────────────────────────────────────────────

/**
 * One row per dispatched email.
 *
 * user_id:             Recipient user (nullable for system/unauthenticated sends)
 * email_type:          One of the supported notification types
 * recipient:           Destination email address
 * subject:             Rendered subject line
 * provider_message_id: ID returned by the email provider; the join key used by
 *                      the delivery-status webhook to update this row
 * status:              Lifecycle status, advanced by the provider webhook
 * error:               Provider error / bounce reason, if any
 * sent_at:             When the message was handed to the provider
 */
CREATE TABLE IF NOT EXISTS email_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email_type TEXT NOT NULL CHECK (
        email_type IN (
            'deployment_complete',
            'subscription_changed',
            'security_alert',
            'invoice_ready'
        )
    ),
    recipient TEXT NOT NULL,
    subject TEXT NOT NULL,
    provider_message_id TEXT UNIQUE,
    status TEXT NOT NULL DEFAULT 'sent' CHECK (
        status IN ('sent', 'delivered', 'bounced', 'opened')
    ),
    error TEXT,
    sent_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_email_deliveries_user_id
    ON email_deliveries(user_id);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_provider_message_id
    ON email_deliveries(provider_message_id);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_status
    ON email_deliveries(status);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_email_type
    ON email_deliveries(email_type);

CREATE INDEX IF NOT EXISTS idx_email_deliveries_sent_at
    ON email_deliveries(sent_at DESC);

-- Keep updated_at fresh on status transitions (function defined in migration 001)
CREATE TRIGGER update_email_deliveries_updated_at
    BEFORE UPDATE ON email_deliveries
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ── Row Level Security ───────────────────────────────────────────────────────

ALTER TABLE email_deliveries ENABLE ROW LEVEL SECURITY;

-- Users may read their own delivery records (audit trail visibility).
CREATE POLICY email_deliveries_select_own
    ON email_deliveries
    FOR SELECT
    USING (auth.uid() = user_id);

-- Inserts/updates are performed by the service role only (server-side service
-- and provider webhook); no client-side write policy is granted.
