import { GoogleGenAI } from "@google/genai";

// --- CONFIGURATION & KEY MANAGEMENT ---
const apiKey = process.env.GEMINI_API_KEY || ""; 

// Default Keys mapping to your Google AI Studio Secrets
const DEFAULT_FINNHUB_KEYS = [
  process.env.Finnhub_API_Key1,
  process.env.Finnhub_API_Key2,
  process.env.Finnhub_API_Key3,
  process.env.Finnhub_API_Key4,
  process.env.Finnhub_API_Key5
].filter(Boolean) as string[];

const DEFAULT_LOGO_DEV_KEY = process.env['Logo.Dev_API_Key'] || "";

const DEFAULT_TIINGO_KEYS = [
  process.env.Tiingo_API_Key1,
  process.env.Tiingo_API_Key2,
  process.env.Tiingo_API_Key3,
  process.env.Tiingo_API_Key4,
  process.env.Tiingo_API_Key5
].filter(Boolean) as string[];

// Dynamic Key Getters
export const getFinnhubKeys = () => {
    const userKeys = localStorage.getItem('user_finnhub_key');
    if (userKeys) return userKeys.split(',').map(k => k.trim()).filter(k => k);
    return DEFAULT_FINNHUB_KEYS;
};

export const getLogoDevKey = () => localStorage.getItem('user_logo_dev_key') || DEFAULT_LOGO_DEV_KEY;

export const getTiingoKeys = () => {
    const userKeys = localStorage.getItem('user_tiingo_key');
    if (userKeys) return userKeys.split(',').map(k => k.trim()).filter(k => k);
    return DEFAULT_TIINGO_KEYS;
};

export const getGeminiKeys = () => {
    const userKeys = localStorage.getItem('user_gemini_key');
    if (userKeys) return userKeys.split(',').map(k => k.trim()).filter(k => k);
    return apiKey ? [apiKey] : [];
};

export const markKeyAsDead = (key: string) => {
    if (!key) return;
    try {
        const deadKeys = JSON.parse(localStorage.getItem('dead_api_keys') || '{}');
        deadKeys[key] = Date.now();
        localStorage.setItem('dead_api_keys', JSON.stringify(deadKeys));
    } catch (e) {}
};

// Finnhub Rotation Logic
let finnhubKeyIndex = 0;
export const fetchFinnhub = async (endpoint: string) => {
    const keys = getFinnhubKeys();
    if (!keys || keys.length === 0) {
        console.warn("No Finnhub keys available");
        return {};
    }

    let attempts = 0;
    const maxAttempts = keys.length * 2; // Allow some retries across keys
    
    while (attempts < maxAttempts) {
        const currentKey = keys[finnhubKeyIndex % keys.length];
        finnhubKeyIndex++; // Rotate to next key for next request
        
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `https://finnhub.io/api/v1/${endpoint}${separator}token=${currentKey}`;
        
        try {
            const res = await fetch(url);
            if (res.status === 429 || res.status === 403 || res.status === 401) {
                // Rate limited or Forbidden - wait briefly then retry with next key
                markKeyAsDead(currentKey);
                attempts++;
                await new Promise(r => setTimeout(r, 500 + (attempts * 500)));
                continue;
            }
            if (!res.ok) throw new Error(`Finnhub error: ${res.status}`);
            return await res.json();
        } catch (e) {
            attempts++;
            if (attempts >= maxAttempts) throw e;
            await new Promise(r => setTimeout(r, 200));
        }
    }
    return {};
};

let geminiKeyIndex = 0;
export async function callGemini(prompt: string, systemInstruction = "", isJson = false) {
  const keys = getGeminiKeys();
  
  if (!keys || keys.length === 0) {
      console.warn("No Gemini API Key found. AI features may fail.");
      throw new Error("Gemini API Key is missing. Please check your settings.");
  }

  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
      const currentKey = keys[geminiKeyIndex % keys.length];
      
      try {
          const ai = new GoogleGenAI({ apiKey: currentKey });
          const response = await ai.models.generateContent({
              model: "gemini-3-flash-preview",
              contents: prompt,
              config: {
                  systemInstruction: systemInstruction,
                  responseMimeType: isJson ? "application/json" : "text/plain",
              }
          });
          return response.text;
      } catch (error: any) {
          console.error(`Gemini API Error (Attempt ${attempt + 1}):`, error);
          
          // Check for rate limit (429) or service unavailable (503)
          const isRateLimit = error.message?.includes('429') || error.status === 429 || error.code === 429 || error.message?.includes('RESOURCE_EXHAUSTED') || (error.error && error.error.code === 429);
          const isServiceUnavailable = error.message?.includes('503') || error.status === 503 || error.code === 503;

          if (isRateLimit) {
              markKeyAsDead(currentKey);
              geminiKeyIndex++; // Rotate to next key immediately
              console.warn(`Rate limited on key ending in ...${currentKey.slice(-4)}. Rotating to next key.`);
          }

          if ((isRateLimit || isServiceUnavailable) && attempt < maxRetries - 1) {
              const delay = Math.pow(2, attempt) * 4000 + Math.random() * 2000; // Exponential backoff + jitter
              console.warn(`Retrying in ${Math.round(delay)}ms...`);
              await new Promise(resolve => setTimeout(resolve, delay));
              attempt++;
              continue;
          }
          
          throw error;
      }
  }
}

export const safeSetItem = (key: string, value: string) => {
    try {
        localStorage.setItem(key, value);
    } catch (e: any) {
        if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            Object.keys(localStorage).forEach(k => {
                if(k.startsWith('tiingo_')) localStorage.removeItem(k);
            });
            try { localStorage.setItem(key, value); } catch (retryE) {}
        }
    }
};

export const trackApiUsage = (key: string) => {
  try {
    const history = JSON.parse(localStorage.getItem('tiingo_usage_log') || '{}');
    if (!history[key]) history[key] = [];
    history[key].push(Date.now());
    const oneDay = 24 * 60 * 60 * 1000;
    const now = Date.now();
    history[key] = history[key].filter((t: any) => now - t < oneDay);
    safeSetItem('tiingo_usage_log', JSON.stringify(history));
  } catch (e) {}
};

let firmTiingoKeyIndex = 0;
export const fetchTiingoGlobal = async (symbol: string, startTimestamp: number, dataCache: any = {}, inFlightRequests: Map<string, any> = new Map()) => {
    const cleanSymbol = symbol.toUpperCase().replace(/[\.\/]/g, '-');
    const cacheKey = `tiingo_${cleanSymbol}_5Y`; 
    if (dataCache[cleanSymbol]) return dataCache[cleanSymbol];
    if (inFlightRequests.has(cacheKey)) return inFlightRequests.get(cacheKey);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                dataCache[cleanSymbol] = parsed.data;
                return parsed.data;
            }
        } catch (e) {}
    }

    const fetchPromise = (async () => {
        let attempts = 0;
        const keys = getTiingoKeys();
        if (keys.length === 0) throw new Error("No API keys");
        const maxAttempts = keys.length * 2;
        while (attempts < maxAttempts) {
            const currentKey = keys[firmTiingoKeyIndex++ % keys.length];
            const startDate = new Date(startTimestamp * 1000).toISOString().split('T')[0];
            const directUrl = `https://api.tiingo.com/tiingo/daily/${cleanSymbol}/prices?startDate=${startDate}&resampleFreq=daily&token=${currentKey}`;
            const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(directUrl)}`;
            
            try {
                let res;
                let corsFailed = false;

                // 1. Try Direct Fetch Safely
                try {
                    res = await fetch(directUrl);
                } catch (e) {
                    // CORS errors throw a TypeError here. Catch it so we can use the proxy.
                    corsFailed = true;
                }
                
                // 2. Fail Fast for Real 404s
                if (!corsFailed && (res?.status === 404 || res?.status === 400)) return null;

                 // 3. Proxy Routing (If CORS failed, or Rate Limited, or Not OK)
                if (corsFailed || !res?.ok || res?.status === 429) {
                     const proxyRes = await fetch(proxyUrl);
                     if (proxyRes.ok) {
                         const proxyJson = await proxyRes.json();
                         const data = JSON.parse(proxyJson.contents);
                         if (data.detail && data.detail.includes("throttle")) { markKeyAsDead(currentKey); throw new Error("429"); }
                         if (Array.isArray(data)) {
                             const normalized = { t: data.map((d: any) => new Date(d.date).getTime() / 1000), c: data.map((d: any) => d.adjClose || d.close) };
                             safeSetItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: normalized }));
                             dataCache[cleanSymbol] = normalized;
                             trackApiUsage(currentKey);
                             return normalized;
                         }
                     }
                     if (res?.status === 429) { markKeyAsDead(currentKey); throw new Error("429"); }
                     throw new Error("Proxy failed");
                }

                // 4. If Direct Fetch Succeeded
                const jsonResponse = await res.json();
                if (Array.isArray(jsonResponse)) {
                    if (jsonResponse.length === 0) return null;
                    const normalized = { t: jsonResponse.map((d: any) => new Date(d.date).getTime() / 1000), c: jsonResponse.map((d: any) => d.adjClose || d.close) };
                    safeSetItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: normalized }));
                    dataCache[cleanSymbol] = normalized;
                    trackApiUsage(currentKey); 
                    return normalized;
                }
                
                throw new Error("Fetch failed");

            } catch (err: any) {
                if (err.message !== "429") return null;
                attempts++;
                await new Promise(r => setTimeout(r, 1000 + (attempts * 500)));
            }
        }
        return null;
    })();

    inFlightRequests.set(cacheKey, fetchPromise);
    try { return await fetchPromise; } finally { inFlightRequests.delete(cacheKey); }
};

export const fetchTiingoIEX = async (symbol: string) => {
    const keys = getTiingoKeys();
    if (keys.length === 0) throw new Error("No API keys");
    const cleanSymbol = symbol.toUpperCase().replace(/[\.\/]/g, '-');
    
    let attempts = 0;
    const maxAttempts = keys.length;
    
    while (attempts < maxAttempts) {
        const currentKey = keys[firmTiingoKeyIndex++ % keys.length];
        const url = `https://api.tiingo.com/iex/${cleanSymbol}?token=${currentKey}`;
        
        try {
            const res = await fetch(url);
            if (res.status === 429) {
                markKeyAsDead(currentKey);
                attempts++;
                continue;
            }
            if (!res.ok) return null;
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
                trackApiUsage(currentKey);
                return data[0]; // Returns { lastPrice, volume, etc }
            }
            return null;
        } catch (e) {
            attempts++;
        }
    }
    return null;
};
