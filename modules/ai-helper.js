import crypto from 'crypto';

// --- FIX [1]: Made API version configurable and defaulted to 'v1beta' ---
// This is the primary fix. Newer models like 'gemini-1.5-flash' and 'gemini-1.5-pro'
// are available on the 'v1beta' endpoint. Using 'v1' was causing the 404 errors.
// You can override this by setting the GEMINI_API_VERSION environment variable.
const GEMINI_API_VERSION = process.env.GEMINI_API_VERSION || 'v1beta';
const GEMINI_API_BASE = `https://generativelanguage.googleapis.com/${GEMINI_API_VERSION}`;

const GEMINI_MODELS = [
  'gemini-1.5-flash-latest', // Updated to use the 'latest' tag for stability
  'gemini-1.5-pro-latest'
];

const CACHE_TTL_HOURS = 24;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 5000];

export class AIHelper {
  constructor(supabaseClient, apiKey) {
    this.supabase = supabaseClient;
    this.apiKey = apiKey;
    this.lastRequestTime = 0;
    console.log(`[AI-HELPER] Initialized with Gemini API endpoint: ${GEMINI_API_BASE}`);
  }

  generateCacheKey(type, context, metrics, htmlHash) {
    const data = JSON.stringify({ type, context, metrics, htmlHash });
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  generateHtmlHash(html) {
    if (!html) return null;
    return crypto.createHash('md5').update(html.slice(0, 10000)).digest('hex');
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
        console.error('[AI-HELPER] ✗ Cache lookup error:', error.message);
        return null;
      }

      if (data) {
        await this.supabase
          .from('ai_analysis_cache')
          .update({ hit_count: data.hit_count + 1 })
          .eq('cache_key', cacheKey);

        console.log(`[AI-HELPER] ✓ Cache hit: ${cacheKey.slice(0, 12)}...`);
        return data.ai_response;
      }

      return null;
    } catch (err) {
      console.error('[AI-HELPER] ✗ Cache retrieval error:', err.message);
      return null;
    }
  }

  async setCachedResponse(cacheKey, type, context, metrics, htmlHash, aiResponse) {
    try {
      const expiresAt = new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000);

      const { error } = await this.supabase
        .from('ai_analysis_cache')
        .upsert({
          cache_key: cacheKey,
          type,
          context,
          metrics,
          html_hash: htmlHash,
          ai_response: aiResponse,
          model_used: aiResponse.model_used || GEMINI_MODELS[0],
          expires_at: expiresAt.toISOString(),
          hit_count: 0
        });

      if (error) {
        console.error('[AI-HELPER] ✗ Cache storage error:', error.message);
      } else {
        console.log(`[AI-HELPER] ✓ Cached response: ${cacheKey.slice(0, 12)}...`);
      }
    } catch (err) {
      console.error('[AI-HELPER] ✗ Cache storage exception:', err.message);
    }
  }

  buildPrompt(type, context, metrics, html) {
    const htmlSnippet = html ? html.slice(0, 2000) : 'N/A';
    return `You are an expert web auditor. Review this snapshot and metric data.
Type: ${type}
Context: ${context}
Metrics: ${JSON.stringify(metrics, null, 2)}
HTML Sample: ${htmlSnippet}

Return ONLY valid JSON:
{
  "score": <0-100>,
  "cause": "brief cause",
  "suggestion": "one specific recommendation"
}`;
  }

  async callGeminiAPI(prompt, retryCount = 0, modelIndex = 0) {
    if (!this.apiKey) throw new Error('GEMINI_API_KEY not configured');

    const model = GEMINI_MODELS[modelIndex] || GEMINI_MODELS[0];
    const url = `${GEMINI_API_BASE}/models/${model}:generateContent?key=${this.apiKey}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 512
      }
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (res.status === 404 && modelIndex < GEMINI_MODELS.length - 1) {
        console.warn(`[AI-HELPER] ⚠ Model ${model} not found, retrying with ${GEMINI_MODELS[modelIndex + 1]}`);
        return this.callGeminiAPI(prompt, retryCount, modelIndex + 1);
      }

      if (res.status === 429 && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount];
        console.warn(`[AI-HELPER] ⚠ Rate limited, retry ${retryCount + 1} in ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        return this.callGeminiAPI(prompt, retryCount + 1, modelIndex);
      }

      if (!res.ok) {
        // --- FIX [2]: Enhanced Error Parsing & Logging ---
        // Instead of throwing raw text, we try to parse the JSON error from the API
        // for cleaner, more informative error messages.
        let errorBody;
        try {
          errorBody = await res.json();
        } catch {
          errorBody = await res.text();
        }
        const errorMessage = errorBody?.error?.message || JSON.stringify(errorBody);
        throw new Error(`Gemini API error (${res.status}): ${errorMessage}`);
      }

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { ...this.parseAIResponse(text), model_used: model };

    } catch (err) {
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAYS[retryCount];
        // --- FIX [3]: Quieter Retry Logging ---
        // Reduced the verbosity of retry logs to make the console output cleaner.
        console.warn(`[AI-HELPER] ⚠ API call failed, retry ${retryCount + 1}/${MAX_RETRIES} in ${delay}ms. Reason: ${err.message}`);
        await new Promise(r => setTimeout(r, delay));
        return this.callGeminiAPI(prompt, retryCount + 1, modelIndex);
      }
      // --- FIX [4]: Final Error Logging ---
      // Log a definitive error message after all retries have failed.
      console.error(`[AI-HELPER] ✗ AI analysis failed for model ${model} after ${MAX_RETRIES} retries.`);
      throw err;
    }
  }

  parseAIResponse(textContent) {
    try {
      const json = textContent.match(/\{[\s\S]*\}/);
      if (!json) throw new Error('No JSON found in AI response');
      const parsed = JSON.parse(json[0]);
      return {
        score: Math.max(0, Math.min(100, Number(parsed.score) || 50)),
        cause: parsed.cause?.slice(0, 200) || 'Unknown cause',
        suggestion: parsed.suggestion?.slice(0, 200) || 'Review manually'
      };
    } catch (err) {
      console.error('[AI-HELPER] ✗ AI response parse error:', err.message);
      return { score: 50, cause: 'Parse error', suggestion: 'Manual review required' };
    }
  }

  async analyze({ context, metrics, html, type }) {
    if (!type || !context) throw new Error('type and context required');

    const htmlHash = this.generateHtmlHash(html);
    const cacheKey = this.generateCacheKey(type, context, metrics, htmlHash);
    const cached = await this.getCachedResponse(cacheKey);
    if (cached) return cached;

    await this.waitForRateLimit();

    try {
      const prompt = this.buildPrompt(type, context, metrics, html);
      const aiResponse = await this.callGeminiAPI(prompt);
      await this.setCachedResponse(cacheKey, type, context, metrics, htmlHash, aiResponse);
      console.log(`[AI-HELPER] ✓ AI analysis complete for type "${type}" using model "${aiResponse.model_used}"`);
      return aiResponse;
    } catch (err) {
      console.error(`[AI-HELPER] ✗ AI analysis error for type "${type}": ${err.message}`);
      return { score: 50, cause: err.message, suggestion: 'Manual review required' };
    }
  }

  async waitForRateLimit() {
    const delay = 1000;
    const elapsed = Date.now() - this.lastRequestTime;
    if (elapsed < delay) await new Promise(r => setTimeout(r, delay - elapsed));
    this.lastRequestTime = Date.now();
  }
}

export function createAIHelper(supabaseClient, apiKey) {
  return new AIHelper(supabaseClient, apiKey);
}
export default AIHelper;
