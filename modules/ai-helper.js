import crypto from 'crypto';

const GEMINI_API_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent';
const CACHE_TTL_HOURS = 24;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 5000];

export class AIHelper {
  constructor(supabaseClient, apiKey) {
    this.supabase = supabaseClient;
    this.apiKey = apiKey;
    this.requestQueue = [];
    this.isProcessing = false;
  }

  generateCacheKey(type, context, metrics, htmlHash) {
    const data = JSON.stringify({ type, context, metrics, htmlHash });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  generateHtmlHash(html) {
    if (!html) return null;
    const truncated = html.substring(0, 10000);
    return crypto.createHash('md5').update(truncated).digest('hex');
  }

  async getCachedResponse(cacheKey) {
    try {
      const { data, error } = await this.supabase
        .from('ai_analysis_cache')
        .select('ai_response, hit_count, expires_at')
        .eq('cache_key', cacheKey)
        .gt('expires_at', new Date().toISOString())
        .maybeSingle();

      if (error) {
        console.error('[AI-HELPER] ✗ Cache lookup error:', error);
        return null;
      }

      if (data) {
        await this.supabase
          .from('ai_analysis_cache')
          .update({ hit_count: data.hit_count + 1 })
          .eq('cache_key', cacheKey);

        console.log(`[AI-HELPER] ✓ Cache hit for key: ${cacheKey.substring(0, 12)}... (Hits: ${data.hit_count + 1})`);
        return data.ai_response;
      }

      console.log(`[AI-HELPER] Cache miss for key: ${cacheKey.substring(0, 12)}...`);
      return null;
    } catch (err) {
      console.error('[AI-HELPER] ✗ Cache retrieval error:', err);
      return null;
    }
  }

  async setCachedResponse(cacheKey, type, context, metrics, htmlHash, aiResponse) {
    try {
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + CACHE_TTL_HOURS);

      console.log(`[AI-HELPER] Storing cache for type: ${type} (expires in ${CACHE_TTL_HOURS}h)`);
      const { error } = await this.supabase
        .from('ai_analysis_cache')
        .upsert({
          cache_key: cacheKey,
          type,
          context,
          metrics,
          html_hash: htmlHash,
          ai_response: aiResponse,
          model_used: 'gemini-1.5-flash',
          expires_at: expiresAt.toISOString(),
          hit_count: 0
        }, {
          onConflict: 'cache_key',
          ignoreDuplicates: false
        });

      if (error) {
        console.error(`[AI-HELPER] ✗ Cache storage error: ${error}`);
      } else {
        console.log(`[AI-HELPER] ✓ Cached response for key: ${cacheKey.substring(0, 12)}...`);
      }
    } catch (err) {
      console.error(`[AI-HELPER] ✗ Cache storage exception: ${err}`);
    }
  }

  buildPrompt(type, context, metrics, html) {
    const htmlSnippet = html ? html.substring(0, 2000) : 'N/A';

    return `You are an expert web auditor. Review the provided data, extracted metrics, and snapshots from a website analysis module.
Analyze the site's structure, content, ads, layout, technical setup, and SEO performance.

**Analysis Type:** ${type}
**Context:** ${context}
**Metrics:** ${JSON.stringify(metrics, null, 2)}
**HTML Sample:** ${htmlSnippet}

Give your response strictly in JSON format with the following fields:

{
  "score": <0–100>,
  "cause": "Brief explanation of what reduced the score",
  "suggestion": "One clear recommendation to improve this metric or section"
}

Be concise, objective, and technically correct.
Focus only on the key issue found in the given data and how to fix it.
If no problem is found, say "cause": "Healthy and compliant setup" and "suggestion": "No major changes required".`;
  }

  async callGeminiAPI(prompt, retryCount = 0) {
    if (!this.apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const url = `${GEMINI_API_ENDPOINT}?key=${this.apiKey}`;

    const requestBody = {
      contents: [{
        parts: [{
          text: prompt
        }]
      }],
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 512,
      }
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody)
      });

      if (response.status === 429) {
        if (retryCount < MAX_RETRIES) {
          const delay = RETRY_DELAYS[retryCount];
          console.warn(`[AI-HELPER] ⚠ Rate limited, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
          await new Promise(resolve => setTimeout(resolve, delay));
          return this.callGeminiAPI(prompt, retryCount + 1);
        }
        throw new Error('Rate limit exceeded after max retries');
      }

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
      }

      const data = await response.json();

      if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {
        throw new Error('Invalid response structure from Gemini API');
      }

      const textContent = data.candidates[0].content.parts[0].text;
      console.log(`[AI-HELPER] ✓ Gemini API response parsed successfully`);
      return this.parseAIResponse(textContent);

    } catch (error) {
      if (retryCount < MAX_RETRIES && error.message.includes('fetch')) {
        const delay = RETRY_DELAYS[retryCount];
        console.warn(`[AI-HELPER] ⚠ Network error, retrying in ${delay}ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.callGeminiAPI(prompt, retryCount + 1);
      }
      throw error;
    }
  }

  parseAIResponse(textContent) {
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      const response = {
        score: typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 50,
        cause: (parsed.cause || 'Analysis completed').substring(0, 200),
        suggestion: (parsed.suggestion || 'Review metrics for improvements').substring(0, 200)
      };

      return response;

    } catch (error) {
      console.error('Failed to parse AI response:', error);
      return {
        score: 50,
        cause: 'Unable to parse AI analysis',
        suggestion: 'Review raw metrics manually'
      };
    }
  }

  async analyze({ context, metrics, html, type }) {
    if (!type || !context) {
      throw new Error('type and context are required parameters');
    }

    console.log(`[AI-HELPER] Starting analysis for type: ${type}`);
    const htmlHash = this.generateHtmlHash(html);
    const cacheKey = this.generateCacheKey(type, context, metrics, htmlHash);

    const cached = await this.getCachedResponse(cacheKey);
    if (cached) {
      return cached;
    }

    console.log(`[AI-HELPER] Cache miss - calling Gemini API for ${type}`);
    await this.waitForRateLimit();

    try {
      const prompt = this.buildPrompt(type, context, metrics, html);
      console.log(`[AI-HELPER] Calling Gemini API (${prompt.length} chars prompt)`);
      const aiResponse = await this.callGeminiAPI(prompt);

      console.log(`[AI-HELPER] ✓ API response received - Score: ${aiResponse.score}, Cause: ${aiResponse.cause}`);
      await this.setCachedResponse(cacheKey, type, context, metrics, htmlHash, aiResponse);

      return aiResponse;

    } catch (error) {
      console.error(`[AI-HELPER] ✗ AI analysis error for type "${type}": ${error.message}`);

      return {
        score: 50,
        cause: `Analysis failed: ${error.message.substring(0, 100)}`,
        suggestion: 'Manual review recommended due to automated analysis failure'
      };
    }
  }

  async waitForRateLimit() {
    const now = Date.now();
    const minDelay = 1000;

    if (this.lastRequestTime) {
      const elapsed = now - this.lastRequestTime;
      if (elapsed < minDelay) {
        await new Promise(resolve => setTimeout(resolve, minDelay - elapsed));
      }
    }

    this.lastRequestTime = Date.now();
  }

  async batchAnalyze(requests) {
    const results = [];

    for (const request of requests) {
      try {
        const result = await this.analyze(request);
        results.push({ success: true, data: result, request });
      } catch (error) {
        results.push({
          success: false,
          error: error.message,
          request
        });
      }
    }

    return results;
  }

  async cleanupExpiredCache() {
    try {
      const { error } = await this.supabase
        .from('ai_analysis_cache')
        .delete()
        .lt('expires_at', new Date().toISOString());

      if (error) {
        console.error('Cache cleanup error:', error);
      } else {
        console.log('✓ Expired cache entries cleaned up');
      }
    } catch (err) {
      console.error('Cache cleanup exception:', err);
    }
  }

  async getCacheStats() {
    try {
      const { data, error } = await this.supabase
        .from('ai_analysis_cache')
        .select('type, hit_count, created_at');

      if (error) {
        return { error: error.message };
      }

      const stats = {
        total_entries: data.length,
        total_hits: data.reduce((sum, entry) => sum + entry.hit_count, 0),
        by_type: {}
      };

      data.forEach(entry => {
        if (!stats.by_type[entry.type]) {
          stats.by_type[entry.type] = { count: 0, hits: 0 };
        }
        stats.by_type[entry.type].count++;
        stats.by_type[entry.type].hits += entry.hit_count;
      });

      return stats;

    } catch (err) {
      return { error: err.message };
    }
  }
}

export function createAIHelper(supabaseClient, apiKey) {
  return new AIHelper(supabaseClient, apiKey);
}

export default AIHelper;
