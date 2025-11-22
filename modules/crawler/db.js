const { createClient } = require('@supabase/supabase-js');
const zlib = require('zlib');
const { promisify } = require('util');
const logger = require('../logger');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Missing Supabase environment variables for crawler DB');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

class CrawlerDB {
  async saveCrawlSession(publisherId, siteAuditId, crawlData) {
    const startTime = Date.now();
    try {
      logger.info('Saving crawl session', {
        publisherId,
        siteAuditId,
        url: crawlData.url,
      });

      const sessionRecord = {
        publisher_id: publisherId,
        site_audit_id: siteAuditId || null,
        url: crawlData.url,
        viewport_name: crawlData.viewport || 'desktop',
        viewport_width: crawlData.viewportWidth || 1920,
        viewport_height: crawlData.viewportHeight || 1080,
        user_agent: crawlData.userAgent || null,
        session_duration_ms: crawlData.sessionDuration || 0,
        total_requests: crawlData.metrics?.resourceCount || 0,
        ad_elements_count: crawlData.adElements?.length || 0,
        iframes_count: crawlData.iframes?.length || 0,
        mutations_count: crawlData.mutationLog?.length || 0,
        screenshot_path: crawlData.screenshotPath || null,
      };

      const { data, error } = await supabase
        .from('crawler_sessions')
        .insert(sessionRecord)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'crawler_sessions', 'failure', duration, 1, error, {
          publisherId,
          url: crawlData.url,
        });
        throw new Error(`Crawl session insert failed: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'crawler_sessions', 'success', duration, 1, null, {
        publisherId,
        sessionId: data[0]?.id,
      });

      logger.info('Crawl session saved successfully', { id: data[0]?.id });
      return { success: true, sessionId: data[0]?.id, data: data[0] };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'crawler_sessions', 'failure', duration, 1, error, {
        publisherId,
      });
      logger.error('Error saving crawl session', error);
      return { success: false, error: error.message };
    }
  }

  async saveHARFile(publisherId, sessionId, harData) {
    const startTime = Date.now();
    try {
      logger.info('Saving HAR file', {
        publisherId,
        sessionId,
        entriesCount: harData.log?.entries?.length || 0,
      });

      const harJson = JSON.stringify(harData);
      const uncompressedSize = Buffer.byteLength(harJson, 'utf8');

      let finalHarData = harJson;
      let isCompressed = false;
      let compressedSize = uncompressedSize;

      if (uncompressedSize > 100 * 1024) {
        try {
          const compressed = await gzip(Buffer.from(harJson));
          compressedSize = compressed.length;
          if (compressedSize < uncompressedSize * 0.8) {
            isCompressed = true;
            finalHarData = compressed.toString('base64');
            logger.debug('HAR file compressed', {
              originalSize: uncompressedSize,
              compressedSize,
              ratio: (compressedSize / uncompressedSize).toFixed(2),
            });
          }
        } catch (compressionError) {
          logger.warn('HAR compression failed, storing uncompressed', compressionError);
        }
      }

      const harRecord = {
        crawler_session_id: sessionId,
        publisher_id: publisherId,
        file_path: `${publisherId}/har/${sessionId}.json${isCompressed ? '.gz' : ''}`,
        storage_bucket: 'crawler-data',
        file_size_bytes: compressedSize,
        is_compressed: isCompressed,
        compression_method: isCompressed ? 'gzip' : null,
        request_count: harData.log?.entries?.filter(e => e.type === 'request')?.length || 0,
        response_count: harData.log?.entries?.filter(e => e.type === 'response')?.length || 0,
        har_data: isCompressed ? null : harData,
        total_time_ms: harData.log?.totalTime || 0,
      };

      const { data, error } = await supabase
        .from('crawler_har_files')
        .insert(harRecord)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'crawler_har_files', 'failure', duration, 1, error, {
          publisherId,
          sessionId,
        });
        throw new Error(`HAR insert failed: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'crawler_har_files', 'success', duration, 1, null, {
        publisherId,
        sessionId,
        isCompressed,
        fileSize: compressedSize,
      });

      logger.info('HAR file saved successfully', { id: data[0]?.id, isCompressed });
      return { success: true, data: data[0] };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'crawler_har_files', 'failure', duration, 1, error, {
        publisherId,
        sessionId,
      });
      logger.error('Error saving HAR file', error);
      return { success: false, error: error.message };
    }
  }

  async saveDOMSnapshot(publisherId, sessionId, domSnapshot) {
    const startTime = Date.now();
    try {
      logger.info('Saving DOM snapshot', {
        publisherId,
        sessionId,
        elementCount: domSnapshot.elementCount,
      });

      const snapshotRecord = {
        crawler_session_id: sessionId,
        publisher_id: publisherId,
        element_count: domSnapshot.elementCount || 0,
        iframe_count: domSnapshot.iframeCount || 0,
        script_count: domSnapshot.scriptCount || 0,
        ad_slot_ids: domSnapshot.adSlotIds || [],
        html_size_bytes: domSnapshot.htmlSize || 0,
        body_size_bytes: domSnapshot.bodySize || 0,
        dom_data: domSnapshot,
      };

      const { data, error } = await supabase
        .from('crawler_dom_snapshots')
        .insert(snapshotRecord)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'crawler_dom_snapshots', 'failure', duration, 1, error, {
          publisherId,
          sessionId,
        });
        throw new Error(`DOM snapshot insert failed: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'crawler_dom_snapshots', 'success', duration, 1, null, {
        publisherId,
        sessionId,
      });

      logger.info('DOM snapshot saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'crawler_dom_snapshots', 'failure', duration, 1, error, {
        publisherId,
        sessionId,
      });
      logger.error('Error saving DOM snapshot', error);
      return { success: false, error: error.message };
    }
  }

  async savePageMetrics(publisherId, sessionId, metrics) {
    const startTime = Date.now();
    try {
      logger.info('Saving page metrics', {
        publisherId,
        sessionId,
        ttfb: metrics.coreLWP?.ttfb || 0,
        lcp: metrics.coreLWP?.lcp || 0,
      });

      const metricsRecord = {
        crawler_session_id: sessionId,
        publisher_id: publisherId,
        ttfb_ms: metrics.coreLWP?.ttfb || 0,
        fcp_ms: metrics.coreLWP?.fcp || 0,
        lcp_ms: metrics.coreLWP?.lcp || 0,
        cls_value: metrics.coreLWP?.cls || 0,
        dcp_ms: metrics.coreLWP?.dcp || 0,
        js_weight_bytes: metrics.jsWeight || 0,
        resource_count: metrics.resourceCount || 0,
        image_count: metrics.resourceTiming?.images || 0,
        stylesheet_count: metrics.resourceTiming?.stylesheets || 0,
        script_count: metrics.resourceTiming?.scripts || 0,
        font_count: metrics.resourceTiming?.fonts || 0,
        navigation_timing: metrics.navigationTiming,
        timing_marks: metrics.timingMarks,
      };

      const { data, error } = await supabase
        .from('crawler_page_metrics')
        .insert(metricsRecord)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'crawler_page_metrics', 'failure', duration, 1, error, {
          publisherId,
          sessionId,
        });
        throw new Error(`Page metrics insert failed: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'crawler_page_metrics', 'success', duration, 1, null, {
        publisherId,
        sessionId,
      });

      logger.info('Page metrics saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'crawler_page_metrics', 'failure', duration, 1, error, {
        publisherId,
        sessionId,
      });
      logger.error('Error saving page metrics', error);
      return { success: false, error: error.message };
    }
  }

  async saveBatchAdElements(publisherId, sessionId, adElements) {
    const startTime = Date.now();
    try {
      if (!Array.isArray(adElements) || adElements.length === 0) {
        logger.warn('No ad elements to batch insert', { publisherId, sessionId });
        return { success: true, data: [] };
      }

      logger.info('Saving batch ad elements', {
        publisherId,
        sessionId,
        count: adElements.length,
      });

      const records = adElements.map((element, index) => ({
        crawler_session_id: sessionId,
        publisher_id: publisherId,
        element_index: index,
        element_type: element.type || null,
        element_id: element.id || null,
        element_class: element.className || null,
        tag_name: element.tag || null,
        position_x: element.position?.x || 0,
        position_y: element.position?.y || 0,
        width: element.position?.width || 0,
        height: element.position?.height || 0,
        is_visible: element.visibility?.visible || false,
        visibility_data: element.visibility,
        data_attributes: element.dataAttributes,
        element_html: element.html || null,
      }));

      const { data, error } = await supabase
        .from('crawler_ad_elements')
        .insert(records)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'crawler_ad_elements', 'failure', duration, adElements.length, error, {
          publisherId,
          sessionId,
        });
        throw new Error(`Batch insert failed: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'crawler_ad_elements', 'success', duration, adElements.length, null, {
        publisherId,
        sessionId,
        elementCount: adElements.length,
      });

      logger.info('Batch ad elements saved successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'crawler_ad_elements', 'failure', duration, adElements.length, error, {
        publisherId,
        sessionId,
      });
      logger.error('Error saving batch ad elements', error);
      return { success: false, error: error.message };
    }
  }

  async saveScreenshot(publisherId, sessionId, screenshotData) {
    const startTime = Date.now();
    try {
      if (!screenshotData) {
        logger.debug('No screenshot data to save');
        return { success: true, data: null };
      }

      logger.info('Saving screenshot', {
        publisherId,
        sessionId,
        fileName: screenshotData.fileName,
      });

      const screenshotRecord = {
        crawler_session_id: sessionId,
        publisher_id: publisherId,
        file_path: screenshotData.filePath || `${publisherId}/screenshots/${sessionId}.png`,
        storage_bucket: 'crawler-data',
        file_size_bytes: screenshotData.fileSize || 0,
        file_name: screenshotData.fileName || null,
        capture_timestamp: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('crawler_screenshots')
        .insert(screenshotRecord)
        .select();

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('INSERT', 'crawler_screenshots', 'failure', duration, 1, error, {
          publisherId,
          sessionId,
        });
        throw new Error(`Screenshot insert failed: ${error.message}`);
      }

      await this.logDbOperation('INSERT', 'crawler_screenshots', 'success', duration, 1, null, {
        publisherId,
        sessionId,
      });

      logger.info('Screenshot saved successfully', { id: data[0]?.id });
      return { success: true, data: data[0] };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('INSERT', 'crawler_screenshots', 'failure', duration, 1, error, {
        publisherId,
        sessionId,
      });
      logger.error('Error saving screenshot', error);
      return { success: false, error: error.message };
    }
  }

  async saveCrawlData(publisherId, siteAuditId, crawlData) {
    try {
      logger.info('Starting comprehensive crawl data save', {
        publisherId,
        siteAuditId,
      });

      const sessionResult = await this.saveCrawlSession(publisherId, siteAuditId, crawlData);
      if (!sessionResult.success) {
        throw new Error(`Failed to save crawl session: ${sessionResult.error}`);
      }

      const sessionId = sessionResult.sessionId;
      const results = { session: sessionResult };

      if (crawlData.har) {
        results.har = await this.saveHARFile(publisherId, sessionId, crawlData.har);
      }

      if (crawlData.domSnapshot) {
        results.dom = await this.saveDOMSnapshot(publisherId, sessionId, crawlData.domSnapshot);
      }

      if (crawlData.metrics) {
        results.metrics = await this.savePageMetrics(publisherId, sessionId, crawlData.metrics);
      }

      if (crawlData.adElements && Array.isArray(crawlData.adElements)) {
        results.adElements = await this.saveBatchAdElements(publisherId, sessionId, crawlData.adElements);
      }

      if (crawlData.screenshotPath) {
        results.screenshot = await this.saveScreenshot(publisherId, sessionId, {
          filePath: `${publisherId}/screenshots/${crawlData.screenshotPath}`,
          fileName: crawlData.screenshotPath,
        });
      }

      const allSuccess = Object.values(results).every(r => r?.success !== false);
      logger.info('Comprehensive crawl data save completed', {
        publisherId,
        sessionId,
        allSuccess,
      });

      return {
        success: allSuccess,
        sessionId,
        results,
      };
    } catch (error) {
      logger.error('Error saving comprehensive crawl data', error);
      return { success: false, error: error.message };
    }
  }

  async getCrawlHistory(publisherId, limit = 30, offset = 0) {
    const startTime = Date.now();
    try {
      logger.info('Fetching crawl history', { publisherId, limit, offset });

      const { data, error } = await supabase
        .from('crawler_sessions')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('SELECT', 'crawler_sessions', 'failure', duration, 0, error, {
          publisherId,
        });
        throw new Error(`Crawl history query failed: ${error.message}`);
      }

      await this.logDbOperation('SELECT', 'crawler_sessions', 'success', duration, data?.length || 0, null, {
        publisherId,
      });

      logger.info('Crawl history fetched successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'crawler_sessions', 'failure', duration, 0, error, { publisherId });
      logger.error('Error fetching crawl history', error);
      return { success: false, error: error.message };
    }
  }

  async getCrawlSessionById(sessionId) {
    const startTime = Date.now();
    try {
      logger.info('Fetching crawl session', { sessionId });

      const [sessionData, harData, domData, metricsData, adElementsData, screenshotData] = await Promise.all([
        supabase.from('crawler_sessions').select('*').eq('id', sessionId).maybeSingle(),
        supabase.from('crawler_har_files').select('*').eq('crawler_session_id', sessionId).maybeSingle(),
        supabase.from('crawler_dom_snapshots').select('*').eq('crawler_session_id', sessionId).maybeSingle(),
        supabase.from('crawler_page_metrics').select('*').eq('crawler_session_id', sessionId).maybeSingle(),
        supabase.from('crawler_ad_elements').select('*').eq('crawler_session_id', sessionId),
        supabase.from('crawler_screenshots').select('*').eq('crawler_session_id', sessionId),
      ]);

      const duration = Date.now() - startTime;

      if (sessionData.error) {
        await this.logDbOperation('SELECT', 'crawler_sessions', 'failure', duration, 0, sessionData.error, {
          sessionId,
        });
        throw sessionData.error;
      }

      const session = sessionData.data;
      await this.logDbOperation('SELECT', 'crawler_sessions', 'success', duration, 1, null, { sessionId });

      return {
        success: true,
        data: {
          session,
          har: harData.data,
          dom: domData.data,
          metrics: metricsData.data,
          adElements: adElementsData.data || [],
          screenshots: screenshotData.data || [],
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'crawler_sessions', 'failure', duration, 0, error, { sessionId });
      logger.error('Error fetching crawl session', error);
      return { success: false, error: error.message };
    }
  }

  async getPageMetricsHistory(publisherId, limit = 30) {
    const startTime = Date.now();
    try {
      logger.info('Fetching page metrics history', { publisherId, limit });

      const { data, error } = await supabase
        .from('crawler_page_metrics')
        .select('*')
        .eq('publisher_id', publisherId)
        .order('created_at', { ascending: false })
        .limit(limit);

      const duration = Date.now() - startTime;

      if (error) {
        await this.logDbOperation('SELECT', 'crawler_page_metrics', 'failure', duration, 0, error, {
          publisherId,
        });
        throw new Error(`Page metrics history query failed: ${error.message}`);
      }

      await this.logDbOperation('SELECT', 'crawler_page_metrics', 'success', duration, data?.length || 0, null, {
        publisherId,
      });

      logger.info('Page metrics history fetched successfully', { count: data?.length });
      return { success: true, data };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'crawler_page_metrics', 'failure', duration, 0, error, { publisherId });
      logger.error('Error fetching page metrics history', error);
      return { success: false, error: error.message };
    }
  }

  async compareSessionMetrics(sessionId1, sessionId2) {
    const startTime = Date.now();
    try {
      logger.info('Comparing session metrics', { sessionId1, sessionId2 });

      const [metrics1, metrics2] = await Promise.all([
        supabase.from('crawler_page_metrics').select('*').eq('crawler_session_id', sessionId1).maybeSingle(),
        supabase.from('crawler_page_metrics').select('*').eq('crawler_session_id', sessionId2).maybeSingle(),
      ]);

      const duration = Date.now() - startTime;

      if (metrics1.error || metrics2.error) {
        throw new Error('Failed to fetch metrics for comparison');
      }

      const comparison = {
        session1: metrics1.data,
        session2: metrics2.data,
        differences: {},
      };

      if (metrics1.data && metrics2.data) {
        comparison.differences = {
          ttfb_diff: (metrics2.data.ttfb_ms - metrics1.data.ttfb_ms),
          fcp_diff: (metrics2.data.fcp_ms - metrics1.data.fcp_ms),
          lcp_diff: (metrics2.data.lcp_ms - metrics1.data.lcp_ms),
          cls_diff: (metrics2.data.cls_value - metrics1.data.cls_value),
          js_weight_diff: (metrics2.data.js_weight_bytes - metrics1.data.js_weight_bytes),
        };
      }

      await this.logDbOperation('SELECT', 'crawler_page_metrics', 'success', duration, 2, null, {
        sessionId1,
        sessionId2,
      });

      logger.info('Session metrics compared successfully');
      return { success: true, data: comparison };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'crawler_page_metrics', 'failure', duration, 0, error, {
        sessionId1,
        sessionId2,
      });
      logger.error('Error comparing session metrics', error);
      return { success: false, error: error.message };
    }
  }

  async getCrawlStats(publisherId, days = 30) {
    const startTime = Date.now();
    try {
      logger.info('Calculating crawl statistics', { publisherId, days });

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const [sessions, metrics] = await Promise.all([
        supabase
          .from('crawler_sessions')
          .select('*')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDate.toISOString()),
        supabase
          .from('crawler_page_metrics')
          .select('ttfb_ms, fcp_ms, lcp_ms, cls_value, js_weight_bytes')
          .eq('publisher_id', publisherId)
          .gte('created_at', startDate.toISOString()),
      ]);

      const duration = Date.now() - startTime;

      if (sessions.error || metrics.error) {
        throw new Error('Failed to fetch data for statistics');
      }

      const sessionList = sessions.data || [];
      const metricsList = metrics.data || [];

      const stats = {
        totalSessions: sessionList.length,
        avgSessionDuration: sessionList.length > 0
          ? sessionList.reduce((sum, s) => sum + (s.session_duration_ms || 0), 0) / sessionList.length
          : 0,
        totalAdElementsFound: sessionList.reduce((sum, s) => sum + (s.ad_elements_count || 0), 0),
        avgAdElementsPerSession: sessionList.length > 0
          ? sessionList.reduce((sum, s) => sum + (s.ad_elements_count || 0), 0) / sessionList.length
          : 0,
        metrics: {
          avgTtfb: metricsList.length > 0
            ? metricsList.reduce((sum, m) => sum + (m.ttfb_ms || 0), 0) / metricsList.length
            : 0,
          avgFcp: metricsList.length > 0
            ? metricsList.reduce((sum, m) => sum + (m.fcp_ms || 0), 0) / metricsList.length
            : 0,
          avgLcp: metricsList.length > 0
            ? metricsList.reduce((sum, m) => sum + (m.lcp_ms || 0), 0) / metricsList.length
            : 0,
          avgCls: metricsList.length > 0
            ? metricsList.reduce((sum, m) => sum + (m.cls_value || 0), 0) / metricsList.length
            : 0,
          avgJsWeight: metricsList.length > 0
            ? metricsList.reduce((sum, m) => sum + (m.js_weight_bytes || 0), 0) / metricsList.length
            : 0,
        },
      };

      await this.logDbOperation('SELECT', 'crawler_sessions', 'success', duration, sessionList.length, null, {
        publisherId,
        days,
      });

      logger.info('Crawl statistics calculated successfully', { stats });
      return { success: true, data: stats };
    } catch (error) {
      const duration = Date.now() - startTime;
      await this.logDbOperation('SELECT', 'crawler_sessions', 'failure', duration, 0, error, { publisherId });
      logger.error('Error calculating crawl statistics', error);
      return { success: false, error: error.message };
    }
  }

  async logDbOperation(operation, table, status, duration, recordCount, error, details) {
    try {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level: status === 'success' ? 'INFO' : 'ERROR',
        operation,
        table_name: table,
        status,
        message: `${status === 'success' ? 'Successfully' : 'Failed to'} ${operation.toLowerCase()} ${recordCount || 0} record(s) in ${table}`,
        details: details || {},
        error_message: error?.message || null,
        duration_ms: duration,
        record_count: recordCount || 0,
        created_at: new Date().toISOString(),
      };

      await supabase
        .from('db_operation_logs')
        .insert(logEntry);

      if (status === 'success') {
        logger.debug(`[DB_LOG] ${operation} ${table}: ${recordCount} record(s) in ${duration}ms`, {
          table,
          operation,
          duration,
        });
      } else {
        logger.warn(`[DB_LOG] ${operation} ${table} FAILED: ${error?.message || 'Unknown error'}`, {
          table,
          operation,
          error: error?.message,
        });
      }
    } catch (err) {
      logger.error(`[DB_LOG] Failed to log database operation: ${err.message}`, {
        originalError: error?.message,
        operation,
        table,
      });
    }
  }
}

module.exports = new CrawlerDB();
