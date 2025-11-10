# OpenRouter Integration with Tongyi DeepResearch 30B

## Overview

The site monitoring worker now supports **Tongyi DeepResearch 30B** through OpenRouter, which is available for **free**. This provides advanced AI-powered compliance analysis and content assessment capabilities.

## Setup Instructions

### 1. Create OpenRouter Account
- Visit https://openrouter.ai
- Sign up with your email or GitHub account
- Free accounts get access to multiple models including Tongyi DeepResearch 30B

### 2. Get Your API Key
- Go to https://openrouter.ai/keys
- Create a new API key
- Copy the key (starts with `sk-or-...`)

### 3. Configure Environment Variables
Add to your `.env` file:

```bash
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=deepseek/deepseek-r1
```

### 4. Verify Setup
The worker will automatically:
- Use the OpenRouter model if `OPENROUTER_API_KEY` is configured
- Fall back to Alibaba Tongyi if no OpenRouter key is present
- Use rule-based analysis if both providers fail

## Usage

The AI assistance module will automatically use the configured OpenRouter model for:

- **Compliance Analysis**: Evaluate sites for policy violations
- **MFA Detection**: Identify Made-For-Advertising patterns
- **Content Assessment**: Analyze content quality and authenticity
- **Ad Behavior Analysis**: Detect problematic ad placement patterns

## Model Details

**Model**: Tongyi DeepResearch 30B (via deepseek/deepseek-r1 on OpenRouter)
- **Cost**: Free tier available
- **Performance**: High-quality compliance analysis
- **Speed**: ~2-10 seconds per analysis
- **Max Tokens**: 2048 (configurable)
- **Temperature**: 0.3 (deterministic responses)

## Provider Priority

The worker uses this priority order:

1. **Alibaba** - If `AI_MODEL_API_KEY` and `AI_MODEL_PROVIDER=alibaba` set
2. **OpenRouter** - If `OPENROUTER_API_KEY` set
3. **Fallback** - Rule-based analysis if no API keys configured

To use OpenRouter exclusively:
```bash
unset AI_MODEL_API_KEY
export OPENROUTER_API_KEY=your_key_here
```

## Error Handling

The worker includes robust error handling:

- **401 Errors**: Invalid API key (check your key configuration)
- **429 Errors**: Rate limit exceeded (automatic fallback to rule-based analysis)
- **Network Errors**: Automatic fallback to rule-based analysis
- **Timeout**: 30-second timeout with fallback analysis

## Rate Limits

Free tier on OpenRouter:
- Requests per minute: ~20-30
- Daily usage limits apply

For production use, consider:
- OpenRouter paid tier for higher limits
- Alibaba Tongyi for dedicated quota
- Combining multiple providers for failover

## Logging

Enable detailed logging to monitor API calls:

```bash
LOG_LEVEL=DEBUG
```

Check logs for:
- `Calling OpenRouter LLM` - API call initiated
- `OpenRouter response successful` - Successful response
- `OpenRouter API error` - API errors with status code
- `Using fallback analysis` - Fallback activated

## Troubleshooting

### "Invalid OpenRouter API key"
- Verify key is correct at https://openrouter.ai/keys
- Check key starts with `sk-or-`
- Ensure `OPENROUTER_API_KEY` env var is set

### "Rate limit exceeded"
- Worker automatically falls back to rule-based analysis
- Wait a few minutes before retrying
- Consider upgrading to paid tier

### "No response from OpenRouter"
- Check internet connectivity
- Verify OpenRouter status at https://openrouter.io
- Worker will use fallback analysis

## Advanced Configuration

Edit `config/tongyi-config.json` to customize:

```json
{
  "parameters": {
    "temperature": 0.3,
    "top_p": 0.9,
    "max_tokens": 2048
  }
}
```

## Support

- OpenRouter API Docs: https://openrouter.ai/docs
- OpenRouter Status: https://openrouter.io
- Issue Tracking: Check worker logs with `LOG_LEVEL=DEBUG`
