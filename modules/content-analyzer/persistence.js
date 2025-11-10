const supabase = require('../supabase-client');
const logger = require('../logger');

class ContentAnalysisPersistence {
  async saveAnalysisResults(publisherId, pageUrl, analysisFingerprint) {
    try {
      const { data, error } = await supabase.insert('content_analysis_results', {
        publisher_id: publisherId,
        page_url: pageUrl,
        content_hash: analysisFingerprint.similarity?.contentHash || null,
        simhash: analysisFingerprint.similarity?.simhashFingerprint || null,
        analysis_timestamp: new Date().toISOString(),
        entropy_metrics: analysisFingerprint.entropy || null,
        similarity_metrics: analysisFingerprint.similarity || null,
        readability_metrics: analysisFingerprint.readability || null,
        ai_metrics: analysisFingerprint.ai || null,
        clickbait_metrics: analysisFingerprint.clickbait || null,
        freshness_metrics: analysisFingerprint.freshness || null,
        risk_assessment: analysisFingerprint.riskAssessment || null,
        flag_status: analysisFingerprint.flagStatus || 'clean',
      });

      if (error) {
        logger.error('Failed to save analysis results', error);
        throw error;
      }

      logger.info('Analysis results saved', { publisherId, pageUrl, recordId: data[0]?.id });
      return data[0];
    } catch (error) {
      logger.error('Error saving analysis results to database', error);
      throw error;
    }
  }

  async saveSimilarityFingerprint(contentAnalysisId, publisherId, analysisFingerprint) {
    try {
      const simhash = analysisFingerprint.similarity?.simhashFingerprint;

      if (!simhash) {
        logger.debug('No simhash to save for similarity fingerprint');
        return null;
      }

      const { data, error } = await supabase.insert('similarity_fingerprints', {
        content_analysis_id: contentAnalysisId,
        publisher_id: publisherId,
        simhash: simhash,
        content_length: analysisFingerprint.textLength || 0,
        token_count: analysisFingerprint.similarity?.tokenCount || 0,
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        duplicate_count: 0,
      });

      if (error) {
        logger.error('Failed to save similarity fingerprint', error);
        throw error;
      }

      logger.info('Similarity fingerprint saved', { publisherId, simhash: simhash.substring(0, 10) });
      return data[0];
    } catch (error) {
      logger.error('Error saving similarity fingerprint', error);
      throw error;
    }
  }

  async retrievePreviousAnalysis(publisherId, pageUrl) {
    try {
      const { data, error } = await supabase.query('content_analysis_results', {
        publisher_id: publisherId,
        page_url: pageUrl,
      });

      if (error) {
        logger.error('Failed to retrieve previous analysis', error);
        return null;
      }

      if (data && data.length > 0) {
        return data[0];
      }

      return null;
    } catch (error) {
      logger.error('Error retrieving previous analysis', error);
      return null;
    }
  }

  async findSimilarContent(simhash, publisherId = null) {
    try {
      let query = supabase
        .from('similarity_fingerprints')
        .select('*')
        .eq('simhash', simhash);

      if (publisherId) {
        query = query.eq('publisher_id', publisherId);
      }

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to find similar content', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error finding similar content', error);
      return [];
    }
  }

  async updateAnalysisMetrics(contentAnalysisId, updates) {
    try {
      const { data, error } = await supabase.update(
        'content_analysis_results',
        contentAnalysisId,
        {
          ...updates,
          updated_at: new Date().toISOString(),
        }
      );

      if (error) {
        logger.error('Failed to update analysis metrics', error);
        throw error;
      }

      logger.info('Analysis metrics updated', { contentAnalysisId });
      return data[0];
    } catch (error) {
      logger.error('Error updating analysis metrics', error);
      throw error;
    }
  }

  async saveAnalysisHistory(contentAnalysisId, publisherId, currentAnalysis, previousAnalysis) {
    try {
      const changes = [];
      let riskScoreChange = 0;

      if (previousAnalysis) {
        if (currentAnalysis.flagStatus !== previousAnalysis.flag_status) {
          changes.push('flag_status_changed');
        }

        if (currentAnalysis.similarity?.simhashFingerprint !== previousAnalysis.simhash) {
          changes.push('content_changed');
        }

        if (currentAnalysis.readability?.readabilityScore !== previousAnalysis.readability_metrics?.readabilityScore) {
          changes.push('readability_changed');
        }

        if (currentAnalysis.freshness?.daysOld !== previousAnalysis.freshness_metrics?.daysOld) {
          changes.push('staleness_changed');
        }

        const currentRisk = currentAnalysis.riskAssessment?.totalRiskScore || 0;
        const previousRisk = previousAnalysis.risk_assessment?.totalRiskScore || 0;
        riskScoreChange = currentRisk - previousRisk;

        if (Math.abs(riskScoreChange) > 0.05) {
          changes.push('risk_score_changed');
        }
      }

      if (changes.length === 0) {
        logger.debug('No changes detected in analysis');
        return null;
      }

      const { data, error } = await supabase.insert('content_analysis_history', {
        content_analysis_id: contentAnalysisId,
        publisher_id: publisherId,
        previous_flag_status: previousAnalysis?.flag_status || null,
        current_flag_status: currentAnalysis.flagStatus,
        detected_changes: changes,
        risk_score_change: riskScoreChange,
        comparison_timestamp: new Date().toISOString(),
      });

      if (error) {
        logger.error('Failed to save analysis history', error);
        throw error;
      }

      logger.info('Analysis history saved', { publisherId, changes });
      return data[0];
    } catch (error) {
      logger.error('Error saving analysis history', error);
      throw error;
    }
  }

  async getRiskTrends(publisherId, daysBack = 30) {
    try {
      const fromDate = new Date();
      fromDate.setDate(fromDate.getDate() - daysBack);

      let query = supabase
        .from('content_risk_trends')
        .select('*')
        .eq('publisher_id', publisherId)
        .gte('analysis_date', fromDate.toISOString().split('T')[0]);

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to retrieve risk trends', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error retrieving risk trends', error);
      return [];
    }
  }

  async updateRiskTrends(publisherId, analysisDate, trendData) {
    try {
      const { data, error } = await supabase
        .from('content_risk_trends')
        .upsert(
          {
            publisher_id: publisherId,
            analysis_date: analysisDate,
            ...trendData,
          },
          { onConflict: 'publisher_id,analysis_date' }
        );

      if (error) {
        logger.error('Failed to update risk trends', error);
        throw error;
      }

      logger.info('Risk trends updated', { publisherId, analysisDate });
      return data[0];
    } catch (error) {
      logger.error('Error updating risk trends', error);
      throw error;
    }
  }

  async getAnalysisHistory(publisherId, limit = 50) {
    try {
      let query = supabase
        .from('content_analysis_history')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('created_at', { ascending: false })
        .limit(limit);

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to retrieve analysis history', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error retrieving analysis history', error);
      return [];
    }
  }

  async getContentAnalysis(publisherId, limit = 100, offset = 0) {
    try {
      let query = supabase
        .from('content_analysis_results')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('analysis_timestamp', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to retrieve content analysis', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error retrieving content analysis', error);
      return [];
    }
  }

  async getContentAnalysisByFlagStatus(publisherId, flagStatus, limit = 50) {
    try {
      let query = supabase
        .from('content_analysis_results')
        .select('*')
        .eq('publisher_id', publisherId)
        .eq('flag_status', flagStatus)
        .order('analysis_timestamp', { ascending: false })
        .limit(limit);

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to retrieve flagged content', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error retrieving flagged content', error);
      return [];
    }
  }

  async getDuplicatesBySimhash(simhash, limit = 10) {
    try {
      let query = supabase
        .from('similarity_fingerprints')
        .select('*')
        .eq('simhash', simhash)
        .limit(limit);

      const { data, error } = await query;

      if (error) {
        logger.error('Failed to find duplicates', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error finding duplicates', error);
      return [];
    }
  }
}

module.exports = new ContentAnalysisPersistence();
