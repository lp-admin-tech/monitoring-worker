-- Migration: Add dedicated columns for new MFA detection features
-- These columns enable direct SQL querying without JSONB traversal
-- Run against Supabase SQL Editor

-- =====================================================
-- TRACKER DETECTION COLUMNS (from technical_check JSONB)
-- =====================================================

ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS tracker_count integer DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS tracker_risk_score numeric DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS ad_network_count integer DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS content_rec_count integer DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS is_mfa_tracker_signal boolean DEFAULT false;

-- =====================================================
-- COMMERCIAL INTENT COLUMNS (from ad_analysis JSONB)
-- =====================================================

ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS commercial_intent_score numeric DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS affiliate_link_count integer DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS has_popup_ads boolean DEFAULT false;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS is_mfa_commercial_signal boolean DEFAULT false;

-- =====================================================
-- CONTENT QUALITY COLUMNS (from content_analysis JSONB)
-- =====================================================

ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS word_count integer DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS is_thin_content boolean DEFAULT false;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS type_token_ratio numeric DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS vocabulary_richness numeric DEFAULT 0;
ALTER TABLE site_audits ADD COLUMN IF NOT EXISTS content_quality_score numeric DEFAULT 0;

-- =====================================================
-- INDEXES FOR FAST QUERYING
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_site_audits_tracker_count ON site_audits(tracker_count);
CREATE INDEX IF NOT EXISTS idx_site_audits_commercial_intent ON site_audits(commercial_intent_score);
CREATE INDEX IF NOT EXISTS idx_site_audits_mfa_signals ON site_audits(is_mfa_tracker_signal, is_mfa_commercial_signal);
CREATE INDEX IF NOT EXISTS idx_site_audits_content_quality ON site_audits(content_quality_score);

-- =====================================================
-- ML TRAINING HELPER VIEW
-- =====================================================

CREATE OR REPLACE VIEW vw_ml_training_features AS
SELECT 
  sa.id,
  sa.publisher_id,
  sa.site_url,
  sa.site_name,
  sa.mfa_probability,
  sa.risk_score,
  sa.risk_level,
  -- Tracker features
  sa.tracker_count,
  sa.tracker_risk_score,
  sa.ad_network_count,
  sa.content_rec_count,
  sa.is_mfa_tracker_signal,
  -- Commercial features
  sa.commercial_intent_score,
  sa.affiliate_link_count,
  sa.has_popup_ads,
  sa.is_mfa_commercial_signal,
  -- Content features
  sa.word_count,
  sa.is_thin_content,
  sa.type_token_ratio,
  sa.vocabulary_richness,
  sa.content_quality_score,
  -- Existing features
  sa.ad_density,
  sa.content_uniqueness,
  sa.performance_score,
  sa.created_at
FROM site_audits sa
WHERE sa.status = 'completed'
ORDER BY sa.created_at DESC;

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN site_audits.tracker_count IS 'Total third-party trackers detected';
COMMENT ON COLUMN site_audits.content_rec_count IS 'Content recommendation widgets (Taboola, Outbrain etc) - strong MFA signal';
COMMENT ON COLUMN site_audits.commercial_intent_score IS 'Monetization intensity score (0-1, higher = more aggressive)';
COMMENT ON COLUMN site_audits.is_thin_content IS 'Page has < 300 words of content';
COMMENT ON COLUMN site_audits.content_quality_score IS 'Aggregate quality score (0-1, lower = more likely MFA)';
