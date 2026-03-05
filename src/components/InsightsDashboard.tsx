import React, { useMemo, useState, useEffect } from 'react';
import { AlertTriangle, TrendingDown, PieChart, DollarSign, ArrowRight, Lightbulb, Wallet, TrendingUp, Clock, Calendar, Activity, ArrowUp, ArrowDown, Layers, RefreshCw, Loader2, Landmark, Banknote, X } from 'lucide-react';

const CASH_TICKERS = ["FDRXX", "FCASH", "SPAXX", "CASH", "MMDA", "USD", "CORE", "FZFXX", "SWVXX"];

// --- TIINGO CONFIG ---
const DEFAULT_TIINGO_KEYS = [
  process.env.Tiingo_API_Key1,
  process.env.Tiingo_API_Key2,
  process.env.Tiingo_API_Key3,
  process.env.Tiingo_API_Key4,
  process.env.Tiingo_API_Key5
].filter(Boolean);

const getTiingoKeys = () => {
    const userKeys = localStorage.getItem('user_tiingo_key');
    if (userKeys) return userKeys.split(',').map(k => k.trim()).filter(k => k);
    return DEFAULT_TIINGO_KEYS;
};

const safeSetItem = (key: string, value: string) => {
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

const trackApiUsage = (key: string) => {
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
const fetchTiingo = async (symbol: string, startTimestamp: number) => {
    const cleanSymbol = symbol.toUpperCase().replace(/[\.\/]/g, '-');
    const cacheKey = `tiingo_${cleanSymbol}_5Y`; 
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                return parsed.data;
            }
        } catch (e) {}
    }

    let attempts = 0;
    const keys = getTiingoKeys();
    if (keys.length === 0) return null;
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
                     if (data.detail && data.detail.includes("throttle")) throw new Error("429");
                     if (Array.isArray(data)) {
                         if (data.length === 0) return null;
                         const normalized = { t: data.map((d: any) => new Date(d.date).getTime() / 1000), c: data.map((d: any) => d.adjClose || d.close) };
                         safeSetItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: normalized }));
                         trackApiUsage(currentKey);
                         return normalized;
                     }
                 }
                 if (res?.status === 429) throw new Error("429");
                 throw new Error("Proxy failed");
            }

            // 4. If Direct Fetch Succeeded
            const jsonResponse = await res.json();
            if (Array.isArray(jsonResponse)) {
                if (jsonResponse.length === 0) return null;
                const normalized = { t: jsonResponse.map((d: any) => new Date(d.date).getTime() / 1000), c: jsonResponse.map((d: any) => d.adjClose || d.close) };
                safeSetItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: normalized }));
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
};

// --- FINNHUB CONFIG ---
const DEFAULT_FINNHUB_KEYS = [
  process.env.Finnhub_API_Key1,
  process.env.Finnhub_API_Key2,
  process.env.Finnhub_API_Key3,
  process.env.Finnhub_API_Key4,
  process.env.Finnhub_API_Key5
].filter(Boolean);

const getFinnhubKeys = () => {
    const userKeys = localStorage.getItem('user_finnhub_key');
    if (userKeys) return userKeys.split(',').map(k => k.trim()).filter(k => k);
    return DEFAULT_FINNHUB_KEYS;
};

let finnhubKeyIndex = 0;
const fetchFinnhub = async (endpoint: string) => {
    const keys = getFinnhubKeys();
    if (keys.length === 0) return null;
    
    let attempts = 0;
    const maxAttempts = keys.length * 2;
    
    while (attempts < maxAttempts) {
        const currentKey = keys[finnhubKeyIndex % keys.length];
        finnhubKeyIndex++;
        
        const separator = endpoint.includes('?') ? '&' : '?';
        const url = `https://finnhub.io/api/v1/${endpoint}${separator}token=${currentKey}`;
        
        try {
            const res = await fetch(url);
            if (res.status === 429) {
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
    return null;
};

const isBond = (symbol: string, description: string) => {
    if (!description) return false;
    const bondPattern = /\d+\.?\d*%\s+\d{2}\/\d{2}\/\d{4}/;
    const isCusip = symbol && symbol.length === 9 && /^[0-9A-Z]+$/.test(symbol);
    const hasBondKeywords = description.includes(" BDS ") || description.includes(" NOTE ") || description.includes(" CORP ") || description.includes(" MUNI ");
    return bondPattern.test(description) || (isCusip && hasBondKeywords);
};

const formatCurrency = (val: number) => {
  const num = Number(val);
  if (isNaN(num) || num === 0) return '$0.00';
  const str = Math.abs(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (num < 0 ? '-$' : '$') + str;
};

const formatPercent = (val: number) => (Number(val)).toFixed(2) + '%';

const Card = ({ title, icon: Icon, children, className = "" }: any) => (
  <div className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col ${className}`}>
    <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-3">
      {Icon && <div className="p-2 bg-zinc-800 rounded-lg text-zinc-400"><Icon className="h-4 w-4" /></div>}
      <span className="text-xs font-black uppercase tracking-widest text-zinc-400">{title}</span>
    </div>
    <div className="p-6 flex-1">{children}</div>
  </div>
);

const InsightsDashboard = ({ clients }: { clients: any[] }) => {
  const [indexQuotes, setIndexQuotes] = useState<any>({
    SPY: { price: 0, change: 0, pct: 0 },
    QQQ: { price: 0, change: 0, pct: 0 },
    DIA: { price: 0, change: 0, pct: 0 }
  });
  const [loadingIndices, setLoadingIndices] = useState(true);
  
  // Leaderboard State
  const [timeframe, setTimeframe] = useState('YTD');
  const [leaderboardData, setLeaderboardData] = useState<any>({ topStocks: [], bottomStocks: [], topFunds: [], bottomFunds: [] });
  const [loadingLeaderboard, setLoadingLeaderboard] = useState(false);
  const [rawMarketData, setRawMarketData] = useState<any>({});
  const [refreshingAssets, setRefreshingAssets] = useState(new Set());
  const [showFcashModal, setShowFcashModal] = useState(false);

  const handleRefreshAsset = async (symbol: string) => {
      setRefreshingAssets(prev => new Set(prev).add(symbol));
      
      try {
          // 1. Purge Cache
          const cleanSymbol = symbol.toUpperCase().replace(/[\.\/]/g, '-');
          localStorage.removeItem(`tiingo_${cleanSymbol}_5Y`);
          
          // 2. Re-Fetch Data
          const newData: any = {};
          
          // Fetch 1D Quote
          try {
              const quoteData = await fetchFinnhub(`quote?symbol=${symbol}`);
              if (quoteData && quoteData.dp !== null) newData[`${symbol}_1D`] = quoteData.dp;
          } catch (e) { console.warn("Refresh quote failed", e); }

          // Fetch 5Y History
          try {
              const end = Math.floor(Date.now() / 1000);
              const start = end - (5 * 365 * 24 * 60 * 60);
              const historyData = await fetchTiingo(symbol, start);
              if (historyData) newData[`${symbol}_5Y`] = historyData;
          } catch (e) { console.warn("Refresh history failed", e); }

          // 3. Update State (Triggers Recalculation)
          setRawMarketData((prev: any) => ({ ...prev, ...newData }));

      } catch (e) {
          console.error("Manual refresh failed", e);
      } finally {
          setRefreshingAssets(prev => {
              const next = new Set(prev);
              next.delete(symbol);
              return next;
          });
      }
  };

  // --- EFFECT A: THE FETCHER (Runs once on mount/clients change) ---
  useEffect(() => {
      const fetchMarketData = async () => {
          setLoadingLeaderboard(true);
          const newData: any = {};
          
          try {
              // 1. Extract Unique Assets
              const assetMap = new Map();
              clients.forEach(client => {
                  const accounts = client.accounts || (client.positions ? [{ positions: client.positions }] : []);
                  accounts.forEach((acc: any) => {
                      (acc.positions || []).forEach((p: any) => {
                          const sym = p.symbol.toUpperCase();
                          if (CASH_TICKERS.some(t => sym.includes(t)) || (p.description && p.description.toUpperCase().includes('CASH')) || p.metadata?.assetClass === 'Cash') return;
                          if (!assetMap.has(sym)) {
                              let type = 'Stock';
                              const isFund = (sym.length === 5 && sym.endsWith('X')) || 
                                             (p.description && /\b(ETF|FUND|TRUST|LP)\b/i.test(p.description)) ||
                                             p.metadata?.assetClass === 'Fixed Income' ||
                                             p.metadata?.assetClass === 'Municipal Bond';
                              if (isFund) type = 'Fund';
                              if (isBond(sym, p.description)) type = 'Bond'; // Exclude bonds from leaderboards
                              
                              if (type !== 'Bond') {
                                  assetMap.set(sym, { symbol: sym, description: p.description, type });
                              }
                          }
                      });
                  });
              });

              const assets = Array.from(assetMap.values());
              
              // 2. Fetch Finnhub 1D Quotes (Batch Size 3)
              const finnhubBatchSize = 3;
              for (let i = 0; i < assets.length; i += finnhubBatchSize) {
                  const batch = assets.slice(i, i + finnhubBatchSize);
                  await Promise.all(batch.map(async (a: any) => {
                      try {
                          const data = await fetchFinnhub(`quote?symbol=${a.symbol}`);
                          if (data && data.dp !== null) newData[`${a.symbol}_1D`] = data.dp;
                      } catch (e) {
                          console.warn(`Failed to fetch quote for ${a.symbol}`, e);
                      }
                  }));
                  if (i + finnhubBatchSize < assets.length) await new Promise(r => setTimeout(r, 200));
              }

              // 3. Fetch Tiingo 5Y History (Batch Size 15)
              const tiingoBatchSize = 15;
              const end = Math.floor(Date.now() / 1000);
              const start = end - (5 * 365 * 24 * 60 * 60);

              for (let i = 0; i < assets.length; i += tiingoBatchSize) {
                  const batch = assets.slice(i, i + tiingoBatchSize);
                  await Promise.all(batch.map(async (a: any) => {
                      try {
                          const data = await fetchTiingo(a.symbol, start);
                          if (data) newData[`${a.symbol}_5Y`] = data;
                      } catch (e) {
                          console.warn(`Failed to fetch history for ${a.symbol}`, e);
                      }
                  }));
              }

              setRawMarketData(newData);

          } catch (error) {
              console.error("Market data fetch failed:", error);
          }
      };

      fetchMarketData();
  }, [clients]);

  // --- EFFECT B: THE CALCULATOR (Runs on timeframe/data change) ---
  useEffect(() => {
      const calculateLeaderboards = () => {
          setLoadingLeaderboard(true);
          try {
              const results: any[] = [];
              
              // Re-extract assets to map back to descriptions/types
              const assetMap = new Map();
              clients.forEach(client => {
                  const accounts = client.accounts || (client.positions ? [{ positions: client.positions }] : []);
                  accounts.forEach((acc: any) => {
                      (acc.positions || []).forEach((p: any) => {
                          const sym = p.symbol.toUpperCase();
                          if (CASH_TICKERS.some(t => sym.includes(t)) || (p.description && p.description.toUpperCase().includes('CASH')) || p.metadata?.assetClass === 'Cash') return;
                          if (!assetMap.has(sym)) {
                              let type = 'Stock';
                              const isFund = (sym.length === 5 && sym.endsWith('X')) || 
                                             (p.description && /\b(ETF|FUND|TRUST|LP)\b/i.test(p.description)) ||
                                             p.metadata?.assetClass === 'Fixed Income' ||
                                             p.metadata?.assetClass === 'Municipal Bond';
                              if (isFund) type = 'Fund';
                              if (isBond(sym, p.description)) type = 'Bond';
                              if (type !== 'Bond') assetMap.set(sym, { symbol: sym, description: p.description, type });
                          }
                      });
                  });
              });

              const assets = Array.from(assetMap.values());

              assets.forEach((a: any) => {
                  let pct = null;

                  if (timeframe === '1D') {
                      pct = rawMarketData[`${a.symbol}_1D`];
                  } else {
                      const data = rawMarketData[`${a.symbol}_5Y`];
                      if (data && data.c && data.c.length > 1) {
                          const latestTimeSec = data.t[data.t.length - 1];
                          const latestDate = new Date(latestTimeSec * 1000);
                          let targetTimeSec = latestTimeSec;

                          if (timeframe === '1M') targetTimeSec -= (30 * 24 * 60 * 60);
                          if (timeframe === '3M') targetTimeSec -= (90 * 24 * 60 * 60);
                          if (timeframe === '6M') targetTimeSec -= (180 * 24 * 60 * 60);
                          if (timeframe === 'YTD') targetTimeSec = new Date(latestDate.getFullYear(), 0, 1).getTime() / 1000;
                          if (timeframe === '1Y') targetTimeSec -= (365 * 24 * 60 * 60);
                          if (timeframe === '3Y') targetTimeSec -= (3 * 365 * 24 * 60 * 60);
                          if (timeframe === '5Y') targetTimeSec -= (5 * 365 * 24 * 60 * 60);

                          let closestIdx = -1;
                          let minDiff = Infinity;
                          for (let j = 0; j < data.t.length; j++) {
                              const diff = Math.abs(data.t[j] - targetTimeSec);
                              if (diff < minDiff) { minDiff = diff; closestIdx = j; }
                          }

                          if (closestIdx !== -1 && minDiff < 7 * 24 * 60 * 60) {
                              const currentClose = data.c[data.c.length - 1];
                              const histClose = data.c[closestIdx];
                              pct = ((currentClose / histClose) - 1) * 100;
                          }
                      }
                  }

                  if (pct !== null && pct !== undefined && !Number.isNaN(pct) && Number.isFinite(pct)) {
                      results.push({ ...a, pct });
                  }
              });

              const stocks = results.filter(r => r.type === 'Stock').sort((a, b) => b.pct - a.pct);
              const funds = results.filter(r => r.type === 'Fund').sort((a, b) => b.pct - a.pct);
              
              const topStocks = stocks.slice(0, 5);
              const bottomStocks = stocks.length > 5 ? stocks.slice(-5).reverse() : [];
              const topFunds = funds.slice(0, 10);
              const bottomFunds = funds.length > 10 ? funds.slice(-10).reverse() : [];

              setLeaderboardData({ topStocks, bottomStocks, topFunds, bottomFunds });

          } catch (e) {
              console.error("Calculation failed", e);
          } finally {
              setLoadingLeaderboard(false);
          }
      };

      if (Object.keys(rawMarketData).length > 0) {
          calculateLeaderboards();
      } else {
          setLoadingLeaderboard(false);
      }
  }, [rawMarketData, timeframe, clients]);

  // --- WIDGET 1: CASH DRAG & MARGIN ---
  const cashAlerts = useMemo(() => {
    const alerts: any[] = [];
    clients.forEach(client => {
      const accounts = client.accounts || (client.positions ? [{ id: 'default', name: 'Primary', positions: client.positions }] : []);
      
      accounts.forEach((acc: any) => {
        if (acc.isMoneyMarket || acc.accountType === 'Money Market') return; 

        let totalVal = 0;
        let cashVal = 0;

        (acc.positions || []).forEach((p: any) => {
          const val = Number(p.currentValue) || 0;
          totalVal += val;
          const isCash = CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)) || 
                         (p.description && p.description.toUpperCase().includes('CASH')) ||
                         p.metadata?.assetClass === 'Cash';
          if (isCash) cashVal += val;
        });

        const cashPct = totalVal > 0 ? (cashVal / totalVal) * 100 : 0;

        if (cashPct > 10 || cashVal < 0) {
          alerts.push({
            clientId: client.id,
            clientName: client.name,
            accountName: acc.name,
            cashPct,
            cashVal,
            type: cashVal < 0 ? 'margin' : 'drag'
          });
        }
      });
    });
    return alerts;
  }, [clients]);

  // --- WIDGET 1.5: FCASH HOLDINGS ---
  const fcashHolders = useMemo(() => {
      const holders: any[] = [];
      clients.forEach(client => {
          let totalAUM = 0;
          let fcashValue = 0;
          
          const accounts = client.accounts || (client.positions ? [{ positions: client.positions }] : []);
          accounts.forEach((acc: any) => {
              (acc.positions || []).forEach((p: any) => {
                  const val = Number(p.currentValue) || 0;
                  totalAUM += val;
                  if (p.symbol.toUpperCase() === 'FCASH') {
                      fcashValue += val;
                  }
              });
          });

          if (fcashValue > 0) {
              holders.push({
                  clientId: client.id,
                  clientName: client.name,
                  fcashValue,
                  fcashPct: totalAUM > 0 ? (fcashValue / totalAUM) * 100 : 0
              });
          }
      });
      return holders.sort((a, b) => b.fcashValue - a.fcashValue);
  }, [clients]);

  // --- WIDGET 2: TAX LOSS HARVESTING ---
  const tlhOpportunities = useMemo(() => {
    const opps: any[] = [];
    clients.forEach(client => {
      const accounts = client.accounts || (client.positions ? [{ positions: client.positions }] : []);
      accounts.forEach((acc: any) => {
        (acc.positions || []).forEach((p: any) => {
            const costBasis = Number(p.costBasis) || 0;
            const currentVal = Number(p.currentValue) || 0;
            let glPct = 0;
            let unrealizedGL = 0;
            
            if (p.unrealizedGLPct !== undefined) {
                glPct = p.unrealizedGLPct * 100; 
                unrealizedGL = p.unrealizedGL;
            } else if (costBasis > 0) {
                unrealizedGL = currentVal - costBasis;
                glPct = (unrealizedGL / costBasis) * 100;
            }

            if (glPct <= -10) {
                opps.push({
                    clientName: client.name,
                    symbol: p.symbol,
                    glDollar: unrealizedGL,
                    glPct: glPct
                });
            }
        });
      });
    });
    return opps.sort((a, b) => a.glPct - b.glPct); 
  }, [clients]);

  // --- WIDGET 3: CONCENTRATION RISK ---
  const concentrationRisks = useMemo(() => {
    const risks: any[] = [];
    clients.forEach(client => {
        let clientAUM = 0;
        const allPositions: any[] = [];

        const accounts = client.accounts || (client.positions ? [{ positions: client.positions }] : []);
        accounts.forEach((acc: any) => {
            (acc.positions || []).forEach((p: any) => {
                const val = Number(p.currentValue) || 0;
                clientAUM += val;
                allPositions.push(p);
            });
        });

        if (clientAUM === 0) return;

        const symbolMap = new Map();
        allPositions.forEach(p => {
            const sym = p.symbol.toUpperCase();
            const val = Number(p.currentValue) || 0;
            
            if (CASH_TICKERS.some(t => sym.includes(t)) || (p.description && p.description.toUpperCase().includes('CASH')) || p.metadata?.assetClass === 'Cash') return;
            
            const isFund = (sym.length === 5 && sym.endsWith('X')) || 
                           (p.description && /\b(ETF|FUND|TRUST|LP)\b/i.test(p.description)) ||
                           p.metadata?.assetClass === 'Fixed Income' || 
                           p.metadata?.assetClass === 'Municipal Bond';
            
            if (isFund) return;

            symbolMap.set(sym, (symbolMap.get(sym) || 0) + val);
        });

        symbolMap.forEach((val, sym) => {
            const pct = (val / clientAUM) * 100;
            if (pct > 20) {
                risks.push({
                    clientName: client.name,
                    symbol: sym,
                    pct
                });
            }
        });
    });
    return risks.sort((a, b) => b.pct - a.pct);
  }, [clients]);

  // --- WIDGET 4: STALE BESPOKE PORTFOLIOS ---
  const stalePortfolios = useMemo(() => {
      const staleAccounts: any[] = [];
      
      clients.forEach(client => {
          const accounts = client.accounts || (client.positions ? [{ id: 'default', name: 'Primary', positions: client.positions, accountType: client.accountType }] : []);
          
          accounts.forEach((acc: any) => {
              if (acc.accountType === 'Bespoke Portfolio') {
                  let totalVal = 0;
                  (acc.positions || []).forEach((p: any) => totalVal += (Number(p.currentValue) || 0));
                  
                  staleAccounts.push({
                      name: `${client.name} (${acc.name})`,
                      totalValue: totalVal,
                      lastUpdated: acc.lastUpdated || client.lastUpdated
                  });
              }
          });
      });

      return staleAccounts
          .sort((a, b) => {
              const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
              const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
              return dateA - dateB;
          })
          .slice(0, 20);
  }, [clients]);

  // --- WIDGET 5: UPCOMING BOND MATURITIES ---
  const bondMaturities = useMemo(() => {
      const maturing: any[] = [];
      const today = new Date();
      
      clients.forEach(client => {
          const accounts = client.accounts || (client.positions ? [{ positions: client.positions }] : []);
          accounts.forEach((acc: any) => {
              (acc.positions || []).forEach((p: any) => {
                  if (isBond(p.symbol, p.description)) {
                      const match = p.description.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
                      if (match) {
                          let year = parseInt(match[3]);
                          if (year < 100) year += 2000; // Handle 2-digit year
                          const maturityDate = new Date(year, parseInt(match[1]) - 1, parseInt(match[2]));
                          
                          const diffTime = maturityDate.getTime() - today.getTime();
                          const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                          
                          if (diffDays >= 0 && diffDays <= 90) {
                              maturing.push({
                                  clientName: client.name,
                                  symbol: p.symbol,
                                  description: p.description,
                                  days: diffDays,
                                  date: maturityDate.toLocaleDateString()
                              });
                          }
                      }
                  }
              });
          });
      });
      return maturing.sort((a, b) => a.days - b.days);
  }, [clients]);

  // --- WIDGET 6: REAL-TIME INDEX QUOTES ---
  useEffect(() => {
      const fetchIndices = async () => {
          const symbols = ['SPY', 'QQQ', 'DIA'];
          const results: any = { ...indexQuotes };
          
          await Promise.all(symbols.map(async (sym) => {
              try {
                  const data = await fetchFinnhub(`quote?symbol=${sym}`);
                  if (data && data.c) {
                      results[sym] = {
                          price: data.c,
                          change: data.d,
                          pct: data.dp
                      };
                  }
              } catch (e) {
                  console.error(`Failed to fetch index quote for ${sym}`, e);
              }
          }));
          
          setIndexQuotes(results);
          setLoadingIndices(false);
      };

      fetchIndices();
      const interval = setInterval(fetchIndices, 15000); // 15s Refresh
      return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-[1600px] mx-auto p-8 md:p-12 space-y-8 pb-24">
      <div className="flex justify-between items-end">
        <div>
            <h1 className="text-4xl font-black text-white tracking-tighter">Insights</h1>
            <p className="text-zinc-500 text-lg mt-2 font-medium">Automated risk detection and portfolio opportunities.</p>
        </div>
      </div>

      {/* INDEX PERFORMANCE MODULES */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          {[
              { id: 'QQQ', name: 'Nasdaq', icon: Activity },
              { id: 'SPY', name: 'S&P 500', icon: TrendingUp },
              { id: 'DIA', name: 'Dow Jones', icon: Landmark }
          ].map((index) => {
              const data = indexQuotes[index.id];
              const isPositive = data.change >= 0;
              const Icon = index.icon;

              return (
                  <div key={index.id} className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between group hover:border-zinc-700 transition-all duration-300 shadow-xl">
                      <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                              <div className={`p-2 rounded-lg ${isPositive ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                  <Icon className="h-4 w-4" />
                              </div>
                              <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-zinc-300 transition-colors">{index.name}</span>
                          </div>
                          {loadingIndices && <Loader2 className="h-3 w-3 text-zinc-700 animate-spin" />}
                      </div>
                      
                      <div className="space-y-1">
                          <div className="text-2xl font-black text-white font-mono tracking-tighter">
                              {data.price > 0 ? formatCurrency(data.price) : '---'}
                          </div>
                          <div className={`text-xs font-bold flex items-center gap-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                              {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                              {isPositive ? '+' : ''}{data.change.toFixed(2)} ({isPositive ? '+' : ''}{data.pct.toFixed(2)}%)
                          </div>
                      </div>
                  </div>
              );
          })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
        
        {/* WIDGET 1: CASH & MARGIN */}
        <Card title="Cash & Margin Alerts" icon={Wallet} className="h-96">
            <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-3">
                {cashAlerts.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                        <Wallet className="h-8 w-8 mb-2 opacity-20" />
                        <span className="text-xs font-bold">No alerts found</span>
                    </div>
                ) : (
                    cashAlerts.map((alert, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-zinc-950/50 border border-zinc-800/50 rounded-xl">
                            <div>
                                <div className="font-bold text-zinc-200 text-sm">{alert.clientName}</div>
                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{alert.accountName}</div>
                            </div>
                            <div className={`text-right ${alert.type === 'margin' ? 'text-red-400' : 'text-orange-400'}`}>
                                <div className="font-mono font-black text-lg">{alert.cashPct.toFixed(1)}%</div>
                                <div className="text-[9px] font-bold uppercase">{alert.type === 'margin' ? 'Margin Usage' : 'Cash Drag'}</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Card>

        {/* WIDGET 1.5: FCASH EXPOSURE */}
        <Card title="FCASH Exposure" icon={Banknote} className="h-96 flex flex-col">
            <div className="overflow-y-auto custom-scrollbar flex-1 pr-2 space-y-3">
                {fcashHolders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                        <Banknote className="h-8 w-8 mb-2 opacity-20" />
                        <span className="text-xs font-bold">No FCASH holdings</span>
                    </div>
                ) : (
                    fcashHolders.slice(0, 5).map((holder, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-zinc-950/50 border border-zinc-800/50 rounded-xl">
                            <div>
                                <div className="font-bold text-zinc-200 text-sm">{holder.clientName}</div>
                                {holder.fcashPct > 5 && (
                                    <span className="inline-block mt-1 px-1.5 py-0.5 bg-red-500/20 text-red-400 text-[9px] font-black uppercase tracking-widest rounded">
                                        &gt;5% Exposure
                                    </span>
                                )}
                            </div>
                            <div className="text-right">
                                <div className="font-mono font-black text-lg text-blue-400">{formatCurrency(holder.fcashValue)}</div>
                                <div className="text-[9px] font-bold text-zinc-600 uppercase">{holder.fcashPct.toFixed(1)}% of Port</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
            {fcashHolders.length > 0 && (
                <div className="pt-4 mt-2 border-t border-zinc-800">
                    <button 
                        onClick={() => setShowFcashModal(true)}
                        className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors"
                    >
                        View All ({fcashHolders.length})
                    </button>
                </div>
            )}
        </Card>

        {/* WIDGET 2: TAX LOSS HARVESTING */}
        <Card title="Tax-Loss Opportunities" icon={TrendingDown} className="h-96">
             <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-3">
                {tlhOpportunities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                        <TrendingDown className="h-8 w-8 mb-2 opacity-20" />
                        <span className="text-xs font-bold">No opportunities found</span>
                    </div>
                ) : (
                    tlhOpportunities.map((opp, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-zinc-950/50 border border-zinc-800/50 rounded-xl group hover:border-red-500/20 transition-colors">
                            <div>
                                <div className="flex items-center gap-2">
                                    <span className="font-black text-white bg-zinc-800 px-1.5 py-0.5 rounded text-xs">{opp.symbol}</span>
                                    <span className="text-xs text-zinc-400 font-medium">{opp.clientName}</span>
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono font-bold text-red-400">{formatCurrency(opp.glDollar)}</div>
                                <div className="text-[10px] font-mono text-red-500/70">{opp.glPct.toFixed(2)}%</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Card>

        {/* WIDGET 3: CONCENTRATION RISK */}
        <Card title="Concentration Risk (>20%)" icon={PieChart} className="h-96">
            <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-3">
                {concentrationRisks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                        <PieChart className="h-8 w-8 mb-2 opacity-20" />
                        <span className="text-xs font-bold">Portfolio diversified</span>
                    </div>
                ) : (
                    concentrationRisks.map((risk, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-zinc-950/50 border border-zinc-800/50 rounded-xl">
                             <div>
                                <div className="font-bold text-zinc-200 text-sm">{risk.clientName}</div>
                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider flex items-center gap-1">
                                    <AlertTriangle className="h-3 w-3 text-orange-500" />
                                    {risk.symbol} Exposure
                                </div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono font-black text-lg text-orange-400">{risk.pct.toFixed(1)}%</div>
                                <div className="text-[9px] font-bold text-zinc-600 uppercase">of Portfolio</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Card>

        {/* WIDGET 4: STALE BESPOKE PORTFOLIOS */}
        <Card title="Stale Bespoke Portfolios" icon={Clock} className="h-96">
            <div className="overflow-y-auto custom-scrollbar h-full pr-2">
                <table className="w-full text-left text-xs">
                    <thead className="text-[9px] font-black uppercase tracking-widest text-zinc-500 sticky top-0 bg-zinc-900/90 backdrop-blur-sm z-10">
                        <tr>
                            <th className="pb-2">Client</th>
                            <th className="pb-2 text-right">Value</th>
                            <th className="pb-2 text-right">Last Updated</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                        {stalePortfolios.map((p, i) => (
                            <tr key={i} className="group hover:bg-zinc-800/30 transition-colors">
                                <td className="py-2 font-medium text-zinc-300 group-hover:text-white">{p.name}</td>
                                <td className="py-2 text-right font-mono text-zinc-400">{formatCurrency(p.totalValue)}</td>
                                <td className="py-2 text-right text-zinc-500 font-mono">
                                    {p.lastUpdated ? new Date(p.lastUpdated).toLocaleDateString() : 'Never'}
                                </td>
                            </tr>
                        ))}
                        {stalePortfolios.length === 0 && (
                            <tr><td colSpan={3} className="py-8 text-center text-zinc-500">No stale portfolios found.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </Card>

        {/* WIDGET 5: UPCOMING BOND MATURITIES */}
        <Card title="Bond Maturities (<90 Days)" icon={Calendar} className="h-96">
            <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-3">
                {bondMaturities.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                        <Calendar className="h-8 w-8 mb-2 opacity-20" />
                        <span className="text-xs font-bold">No upcoming maturities</span>
                    </div>
                ) : (
                    bondMaturities.map((bond, i) => (
                        <div key={i} className="flex items-center justify-between p-3 bg-zinc-950/50 border border-zinc-800/50 rounded-xl">
                            <div className="max-w-[60%]">
                                <div className="font-bold text-zinc-200 text-sm truncate">{bond.clientName}</div>
                                <div className="text-[10px] text-zinc-500 uppercase tracking-wider truncate" title={bond.description}>{bond.symbol}</div>
                            </div>
                            <div className="text-right">
                                <div className="font-mono font-black text-lg text-blue-400">{bond.days}d</div>
                                <div className="text-[9px] font-bold text-zinc-600 uppercase">{bond.date}</div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Card>

        {/* WIDGET 7: LEADERBOARDS */}
        <div className="col-span-1 md:col-span-2 xl:col-span-3 space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
                    <Layers className="h-6 w-6 text-blue-500" /> Performance Leaders
                </h2>
                <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1">
                    {['1D', '1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y'].map(tf => (
                        <button 
                            key={tf}
                            onClick={() => setTimeframe(tf)}
                            className={`px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${timeframe === tf ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                        >
                            {tf}
                        </button>
                    ))}
                </div>
            </div>

            {loadingLeaderboard ? (
                <div className="h-64 flex flex-col items-center justify-center text-zinc-500 gap-4 bg-zinc-900/30 border border-zinc-800/50 rounded-2xl">
                    <Activity className="h-8 w-8 animate-spin text-blue-500" />
                    <span className="text-xs font-black uppercase tracking-widest">Analyzing Market Data...</span>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    {/* Top Funds */}
                    <Card title="Top Funds & ETFs" icon={TrendingUp} className="h-96 border-green-500/20">
                        <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-1">
                            {leaderboardData.topFunds.map((a: any, i: number) => (
                                <div key={i} className="group flex justify-between items-center text-xs py-2 border-b border-zinc-800/50 last:border-0">
                                    <div className="flex flex-col truncate pr-2">
                                        <span className="font-bold text-white">{a.symbol}</span>
                                        <span className="text-[9px] text-zinc-500 truncate" title={a.description}>{a.description}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`font-mono font-bold ${a.pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{a.pct > 0 ? '+' : ''}{a.pct.toFixed(2)}%</span>
                                        <button 
                                            onClick={() => handleRefreshAsset(a.symbol)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-zinc-800 rounded"
                                            disabled={refreshingAssets.has(a.symbol)}
                                        >
                                            {refreshingAssets.has(a.symbol) ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" /> : <RefreshCw className="h-3 w-3 text-zinc-500 hover:text-white" />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* Bottom Funds */}
                    <Card title="Lagging Funds & ETFs" icon={TrendingDown} className="h-96 border-red-500/20">
                        <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-1">
                            {leaderboardData.bottomFunds.map((a: any, i: number) => (
                                <div key={i} className="group flex justify-between items-center text-xs py-2 border-b border-zinc-800/50 last:border-0">
                                    <div className="flex flex-col truncate pr-2">
                                        <span className="font-bold text-white">{a.symbol}</span>
                                        <span className="text-[9px] text-zinc-500 truncate" title={a.description}>{a.description}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`font-mono font-bold ${a.pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{a.pct > 0 ? '+' : ''}{a.pct.toFixed(2)}%</span>
                                        <button 
                                            onClick={() => handleRefreshAsset(a.symbol)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-zinc-800 rounded"
                                            disabled={refreshingAssets.has(a.symbol)}
                                        >
                                            {refreshingAssets.has(a.symbol) ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" /> : <RefreshCw className="h-3 w-3 text-zinc-500 hover:text-white" />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* Top Stocks */}
                    <Card title="Top Stocks" icon={ArrowUp} className="h-96 border-green-500/20">
                        <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-1">
                            {leaderboardData.topStocks.map((a: any, i: number) => (
                                <div key={i} className="group flex justify-between items-center text-xs py-2 border-b border-zinc-800/50 last:border-0">
                                    <div className="flex flex-col truncate pr-2">
                                        <span className="font-bold text-white">{a.symbol}</span>
                                        <span className="text-[9px] text-zinc-500 truncate" title={a.description}>{a.description}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`font-mono font-bold ${a.pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{a.pct > 0 ? '+' : ''}{a.pct.toFixed(2)}%</span>
                                        <button 
                                            onClick={() => handleRefreshAsset(a.symbol)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-zinc-800 rounded"
                                            disabled={refreshingAssets.has(a.symbol)}
                                        >
                                            {refreshingAssets.has(a.symbol) ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" /> : <RefreshCw className="h-3 w-3 text-zinc-500 hover:text-white" />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>

                    {/* Bottom Stocks */}
                    <Card title="Bottom Stocks" icon={ArrowDown} className="h-96 border-red-500/20">
                        <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-1">
                            {leaderboardData.bottomStocks.map((a: any, i: number) => (
                                <div key={i} className="group flex justify-between items-center text-xs py-2 border-b border-zinc-800/50 last:border-0">
                                    <div className="flex flex-col truncate pr-2">
                                        <span className="font-bold text-white">{a.symbol}</span>
                                        <span className="text-[9px] text-zinc-500 truncate" title={a.description}>{a.description}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className={`font-mono font-bold ${a.pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{a.pct > 0 ? '+' : ''}{a.pct.toFixed(2)}%</span>
                                        <button 
                                            onClick={() => handleRefreshAsset(a.symbol)}
                                            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-zinc-800 rounded"
                                            disabled={refreshingAssets.has(a.symbol)}
                                        >
                                            {refreshingAssets.has(a.symbol) ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" /> : <RefreshCw className="h-3 w-3 text-zinc-500 hover:text-white" />}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </Card>
                </div>
            )}
        </div>

      </div>
      
      {/* FCASH MODAL */}
      {showFcashModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
                  <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                      <div className="flex items-center gap-3">
                          <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
                              <Banknote className="h-5 w-5" />
                          </div>
                          <div>
                              <h2 className="text-xl font-black text-white tracking-tight">FCASH Holdings</h2>
                              <p className="text-xs text-zinc-500 font-medium">All clients with FCASH exposure</p>
                          </div>
                      </div>
                      <button onClick={() => setShowFcashModal(false)} className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors">
                          <X className="h-5 w-5" />
                      </button>
                  </div>
                  <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                      <table className="w-full text-left text-sm">
                          <thead className="text-[10px] font-black uppercase tracking-widest text-zinc-500 sticky top-0 bg-zinc-950 pb-2">
                              <tr>
                                  <th className="pb-3">Client Name</th>
                                  <th className="pb-3 text-right">FCASH Value</th>
                                  <th className="pb-3 text-right">% of Portfolio</th>
                              </tr>
                          </thead>
                          <tbody className="divide-y divide-zinc-800/50">
                              {fcashHolders.map((holder, i) => (
                                  <tr key={i} className="group hover:bg-zinc-900/50 transition-colors">
                                      <td className="py-3 font-medium text-zinc-300 group-hover:text-white">
                                          {holder.clientName}
                                          {holder.fcashPct > 5 && (
                                              <span className="ml-2 inline-block px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[9px] font-black uppercase tracking-widest rounded">
                                                  High
                                              </span>
                                          )}
                                      </td>
                                      <td className="py-3 text-right font-mono font-bold text-blue-400">{formatCurrency(holder.fcashValue)}</td>
                                      <td className="py-3 text-right font-mono text-zinc-500">{holder.fcashPct.toFixed(2)}%</td>
                                  </tr>
                              ))}
                          </tbody>
                      </table>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};

export default InsightsDashboard;
