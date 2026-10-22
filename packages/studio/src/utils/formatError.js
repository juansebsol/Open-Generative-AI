/**
 * Format API and studio error messages into clean, user-friendly strings.
 */
export function formatErrorMessage(err, fallback = "Generation failed") {
  if (!err) return fallback;
  let message = typeof err === 'string' ? err : (err.message || fallback);

  // If message contains JSON payload (e.g. `API Request Failed: 402 Payment Required - {...}`)
  if (message.includes('{') && message.includes('}')) {
    try {
      const jsonStart = message.indexOf('{');
      const jsonStr = message.slice(jsonStart);
      const data = JSON.parse(jsonStr);
      if (data.detail && typeof data.detail === 'string') {
        return data.detail;
      }
      if (data.error?.message && typeof data.error.message === 'string') {
        return data.error.message;
      }
      if (data.message && typeof data.message === 'string') {
        return data.message;
      }
    } catch {
      // Ignore JSON parse error
    }
  }

  // Handle common provider HTTP errors
  if (/\b402\b|insufficient (credits|balance|funds)|exhausted balance/i.test(message)) {
    return "The provider says your account is out of credits. Top up with that provider, or switch providers in Settings → Providers.";
  }
  if (/\b(401|403)\b|unauthori[sz]ed|invalid api key|authentication/i.test(message)) {
    return "The provider rejected your API key. Check it in Settings → Providers.";
  }
  if (message.includes('429')) {
    return "Too many requests. Please wait a moment and try again.";
  }

  // Strip technical prefix like "API Request Failed: 500 Internal Server Error -"
  message = message.replace(/^API Request Failed: \d+ [^-]+ - /, '');

  return message.length > 150 ? message.slice(0, 147) + '...' : message;
}
