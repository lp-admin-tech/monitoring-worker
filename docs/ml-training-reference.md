# ML Training Reference - MFA Detection Features

## Feature Extraction Overview

All features are stored as JSONB in `site_audits` table columns:
- `technical_check` - Technical analysis including trackers
- `ad_analysis` - Ad behavior and commercial intent
- `content_analysis` - Content quality metrics

---

## Available Features (65+ total)

### Behavioral Signals (20)
| Feature | Path | Type | MFA Signal |
|---------|------|------|------------|
| adDensity | ad_analysis.density.metrics.adDensity | float | > 0.3 |
| adsAboveFold | ad_analysis.density.metrics.adsAboveFold | int | > 5 |
| contentToAdRatio | ad_analysis.density.metrics.contentToAdRatio | float | < 2 |
| autoRefreshRate | ad_analysis.autoRefresh.summary.criticalRefreshCount | int | > 0 |
| videoStuffingDetected | ad_analysis.video.summary.videoStuffingDetected | bool | true |
| scrollAdInjectionScore | ad_analysis.scrollInjection.summary.riskScore | float | > 0.5 |
| totalTrackerCount | technical_check.trackers.totalTrackers | int | > 15 |
| adNetworkCount | technical_check.trackers.metrics.advertisingCount | int | > 5 |
| contentRecCount | technical_check.trackers.metrics.contentRecCount | int | > 2 |
| commercialIntentScore | commercial_intent.summary.commercialScore | float | > 0.6 |
| affiliateLinkCount | commercial_intent.affiliateLinks.totalAffiliateLinks | int | > 10 |
| hasPopupAds | commercial_intent.aggressiveMonetization.hasPopups | bool | true |

### Content Quality (12)
| Feature | Path | Type | MFA Signal |
|---------|------|------|------------|
| wordCount | content_analysis.thinContent.wordCount | int | < 300 |
| isThinContent | content_analysis.thinContent.isThin | bool | true |
| typeTokenRatio | content_analysis.wordDiversity.typeTokenRatio | float | < 0.3 |
| vocabularyRichness | content_analysis.wordDiversity.vocabularyRichness | float | < 0.25 |
| entropyScore | content_analysis.entropy.entropyScore | float | < 0.35 |
| aiLikelihood | content_analysis.ai.aiScore | float | > 0.6 |
| clickbaitScore | content_analysis.clickbait.clickbaitScore | float | > 0.4 |
| contentQualityScore | content_analysis.contentQualityScore.overall | float | < 0.35 |

### Technical (8)
| Feature | Path | Type | MFA Signal |
|---------|------|------|------------|
| domainAgeMonths | technical_check.domainIntel.domainAge.days/30 | int | < 6 |
| whoisPrivate | technical_check.domainIntel.whoisPrivate | bool | true |
| adsTxtMissing | technical_check.adsTxt.missing | bool | true |
| sslValid | technical_check.ssl.valid | bool | false |
| performanceScore | technical_check.performance.performanceScore | int | < 50 |

---

## Target Labels

For ML training, add to `site_audits`:
```sql
ALTER TABLE site_audits ADD COLUMN human_verified_mfa boolean;
ALTER TABLE site_audits ADD COLUMN verified_by uuid;
ALTER TABLE site_audits ADD COLUMN verified_at timestamptz;
```

---

## Feature Engineering Ideas

1. **Composite Scores**
   - `mfa_signal_count` = count of true MFA signals
   - `risk_density` = (adDensity * trackerCount) / contentQualityScore

2. **Temporal Features**
   - Days since domain registration
   - Score change velocity between audits

3. **Categorical Encoding**
   - TLD type (generic vs country-specific)
   - Primary ad network

---

## Data Export Query

```sql
SELECT 
  sa.id,
  sa.site_url,
  sa.mfa_probability,
  sa.risk_score,
  sa.technical_check->'components'->'trackers'->'totalTrackers' as tracker_count,
  sa.ad_analysis->'analysis'->'density'->'metrics'->'adDensity' as ad_density,
  sa.content_analysis->'thinContent'->'wordCount' as word_count,
  sa.content_analysis->'contentQualityScore'->'overall' as quality_score
FROM site_audits sa
WHERE sa.status = 'completed'
ORDER BY sa.created_at DESC;
```
