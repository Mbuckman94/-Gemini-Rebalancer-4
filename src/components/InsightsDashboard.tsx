import React, { useMemo, useState, useEffect, useRef } from 'react';
import { AlertTriangle, TrendingDown, PieChart, DollarSign, ArrowRight, Lightbulb, Wallet, TrendingUp, Clock, Calendar, Activity, ArrowUp, ArrowDown, Layers, RefreshCw, Loader2, Landmark, Banknote, X, ArrowUpRight, Sparkles, Settings, GripVertical, Eye, EyeOff, Maximize2 } from 'lucide-react';

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
            if (res.status === 429 || res.status === 403 || res.status === 401) {
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

const Card = ({ title, icon: Icon, children, className = "", onClick }: any) => (
  <div 
    onClick={onClick}
    className={`bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col ${onClick ? 'cursor-pointer hover:border-zinc-700 transition-colors group' : ''} ${className}`}
  >
    <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
      <div className="flex items-center gap-3">
        {Icon && <div className="p-2 bg-zinc-800 rounded-lg text-zinc-400"><Icon className="h-4 w-4" /></div>}
        <span className="text-xs font-black uppercase tracking-widest text-zinc-400">{title}</span>
      </div>
      {onClick && <ArrowUpRight className="h-4 w-4 text-zinc-600 group-hover:text-white transition-colors" />}
    </div>
    <div className="p-6 flex-1">{children}</div>
  </div>
);

const InsightDetailModal = ({ insight, onClose, sort, onSort }: any) => {
    const [search, setSearch] = useState('');

    const filteredData = useMemo(() => {
        if (!search) return insight.data;
        return insight.data.filter((row: any) => 
            Object.values(row).some(val => 
                String(val).toLowerCase().includes(search.toLowerCase())
            )
        );
    }, [insight.data, search]);

    const sortedData = useMemo(() => {
        if (!sort.key) return filteredData;
        return [...filteredData].sort((a, b) => {
            const valA = a[sort.key];
            const valB = b[sort.key];
            if (valA < valB) return sort.direction === 'asc' ? -1 : 1;
            if (valA > valB) return sort.direction === 'asc' ? 1 : -1;
            return 0;
        });
    }, [filteredData, sort]);

    return (
        <div className="fixed inset-0 bg-zinc-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-8">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[80vh] flex flex-col">
                <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                    <h2 className="text-xl font-black text-white tracking-tight">{insight.title}</h2>
                    <div className="flex items-center gap-4">
                        {insight.action && (
                            <button 
                                onClick={insight.action.onClick}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-500/20"
                            >
                                {insight.action.icon && <insight.action.icon className="h-3.5 w-3.5" />}
                                {insight.action.label}
                            </button>
                        )}
                        <button onClick={onClose} className="text-zinc-500 hover:text-white transition-colors">
                            <X className="h-6 w-6" />
                        </button>
                    </div>
                </div>
                
                <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
                    <input 
                        type="text" 
                        placeholder="Search..." 
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        onFocus={(e) => e.target.select()}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-blue-500 transition-colors"
                    />
                </div>

                <div className="overflow-auto custom-scrollbar flex-1 p-6">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr>
                                {insight.columns.map((col: any) => (
                                    <th 
                                        key={col.key} 
                                        onClick={() => onSort(col.key)}
                                        className="p-3 text-[10px] font-black uppercase tracking-widest text-zinc-500 cursor-pointer hover:text-white transition-colors border-b border-zinc-800 sticky top-0 bg-zinc-900"
                                    >
                                        <div className="flex items-center gap-1">
                                            {col.label}
                                            {sort.key === col.key && (
                                                sort.direction === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                                            )}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {sortedData.map((row: any, i: number) => (
                                <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                                    {insight.columns.map((col: any) => (
                                        <td key={col.key} className="p-3 text-sm text-zinc-300 font-medium">
                                            {col.render ? col.render(row[col.key], row) : row[col.key]}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const BillingCountdown = ({ billingInfo }: { billingInfo: any }) => {
    if (!billingInfo) return null;
    
    const { nextBillingDate, totalDays, daysElapsed, daysRemaining } = billingInfo;
    
    const dots = Array.from({ length: totalDays }).map((_, i) => {
        const isPast = i < daysElapsed;
        const isToday = i === daysElapsed;
        
        let className = "w-2 h-2 rounded-full ";
        if (isPast) className += "bg-blue-500/80";
        else if (isToday) className += "bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.8)]";
        else className += "border border-zinc-700 bg-transparent";
        
        return <div key={i} className={className} />;
    });
    
    return (
        <Card title="Days until Billing" icon={Calendar} className="h-96 flex flex-col">
            <div className="flex-1 flex flex-col items-center justify-center p-4">
                <div className="text-5xl font-black text-white mb-2">{daysRemaining}</div>
                <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-8">Days Remaining</div>
                
                <div className="flex flex-wrap gap-1.5 justify-center max-w-[280px]">
                    {dots}
                </div>
            </div>
            
            <div className="mt-auto pt-4 border-t border-zinc-800 text-center">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">
                    Next Billing: {new Date(nextBillingDate).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}
                </div>
            </div>
        </Card>
    );
};

const InsightSettingsModal = ({ isOpen, onClose, layout, setLayout, onReset, isResizingUnlocked, setIsResizingUnlocked }: { isOpen: boolean, onClose: () => void, layout: any[], setLayout: (layout: any[]) => void, onReset: () => void, isResizingUnlocked: boolean, setIsResizingUnlocked: (val: boolean) => void }) => {
    if (!isOpen) return null;

    const [tempLayout, setTempLayout] = useState(Array.isArray(layout) ? layout : []);

    const handleToggleVisibility = (id: string) => {
        setTempLayout(tempLayout.map((item: any) => item.id === id ? { ...item, visible: !item.visible } : item));
    };

    const handleDragStart = (e: React.DragEvent, id: string) => {
        e.dataTransfer.setData('text/plain', id);
    };

    const handleDrop = (e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        const draggedId = e.dataTransfer.getData('text/plain');
        if (draggedId === targetId) return;

        const newLayout = [...tempLayout];
        const draggedIndex = newLayout.findIndex(item => item.id === draggedId);
        const targetIndex = newLayout.findIndex(item => item.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        const [draggedItem] = newLayout.splice(draggedIndex, 1);
        newLayout.splice(targetIndex, 0, draggedItem);
        setTempLayout(newLayout);
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl">
                <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-zinc-800/50 text-zinc-300 rounded-lg">
                            <Settings className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white tracking-tight">Dashboard Layout</h2>
                            <p className="text-xs text-zinc-500 font-medium">Customize your insights view</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-zinc-800 rounded-full transition-colors text-zinc-400 hover:text-white">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto custom-scrollbar max-h-[60vh] space-y-6">
                    <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-bold text-white">Enable Manual Resizing</span>
                            <button 
                                onClick={() => setIsResizingUnlocked(!isResizingUnlocked)}
                                className={`w-12 h-6 rounded-full transition-colors ${isResizingUnlocked ? 'bg-blue-600' : 'bg-zinc-700'}`}
                            >
                                <div className={`w-4 h-4 rounded-full bg-white transition-transform ${isResizingUnlocked ? 'translate-x-7' : 'translate-x-1'}`} />
                            </button>
                        </div>
                        <p className="text-xs text-zinc-500">When enabled, drag the bottom-right corner of any module on the dashboard to change its size.</p>
                    </div>
                    <div className="space-y-3">
                        {tempLayout.map((item: any) => (
                            <div 
                                key={item.id} 
                                className="flex items-center justify-between p-4 bg-zinc-900/30 border border-zinc-800/50 rounded-xl cursor-move"
                                draggable
                                onDragStart={(e) => handleDragStart(e, item.id)}
                                onDragOver={(e) => e.preventDefault()}
                                onDrop={(e) => handleDrop(e, item.id)}
                            >
                                <div className="flex items-center gap-3">
                                    <GripVertical className="h-5 w-5 text-zinc-600" />
                                    <button onClick={() => handleToggleVisibility(item.id)} className="text-zinc-400 hover:text-white">
                                        {item.visible ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                                    </button>
                                    <span className="text-sm font-bold text-zinc-200">{item.label}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="p-6 border-t border-zinc-800 flex justify-between gap-4">
                    <button onClick={() => { onReset(); onClose(); }} className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-white text-xs font-black uppercase tracking-widest rounded-xl transition-colors">
                        Reset to Default
                    </button>
                    <button onClick={() => { setLayout(tempLayout); onClose(); }} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-colors shadow-lg shadow-blue-500/20">
                        Save Layout
                    </button>
                </div>
            </div>
        </div>
    );
};

const InsightsDashboard = ({ clients, insightThresholds, insightLayout, setInsightLayout, isInsightResizingUnlocked, setIsInsightResizingUnlocked, onUpdateLayout, onUpdateClient, billingInfo, defaultLayout }: { clients: any[], insightThresholds?: any, insightLayout?: any, setInsightLayout?: any, isInsightResizingUnlocked?: boolean, setIsInsightResizingUnlocked?: (val: boolean) => void, onUpdateLayout?: (layout: any) => void, onUpdateClient: (updatedClient: any) => void, billingInfo?: any, defaultLayout: any[] }) => {
  const [resizingModule, setResizingModule] = useState<{ id: string, startW: number, startH: number, startX: number, startY: number } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number>();

  const handleResizeStart = (e: React.MouseEvent, id: string, w: number, h: number) => {
      e.stopPropagation();
      setResizingModule({ id, startW: w, startH: h, startX: e.clientX, startY: e.clientY });
  };

  const handleMouseMove = (e: MouseEvent) => {
      if (!resizingModule || !Array.isArray(insightLayout) || !containerRef.current) return;
      
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
      
      animationFrameRef.current = requestAnimationFrame(() => {
          const dx = e.clientX - resizingModule.startX;
          const dy = e.clientY - resizingModule.startY;
          
          const containerWidth = containerRef.current?.offsetWidth || 1200;
          const colWidth = containerWidth / 24;
          const heightStep = 80;
          
          const dw = Math.round(dx / colWidth);
          const dh = Math.round(dy / heightStep);
          
          const newW = Math.max(1, Math.min(24, resizingModule.startW + dw));
          const newH = Math.max(1, Math.min(24, resizingModule.startH + dh));
          
          if (newW !== resizingModule.startW || newH !== resizingModule.startH) {
              const newLayout = insightLayout.map((item: any) => item.id === resizingModule.id ? { ...item, w: newW, h: newH } : item);
              if (onUpdateLayout) {
                  onUpdateLayout(newLayout);
              } else if (setInsightLayout) {
                  setInsightLayout(newLayout);
              }
          }
      });
  };

  const handleMouseUp = () => {
      setResizingModule(null);
  };

  useEffect(() => {
      if (resizingModule) {
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
      }
      return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
      };
  }, [resizingModule]);

  const safeThresholds = {
      excessCashThreshold: 10.0,
      fcashExposure: 10,
      taxLossOpportunity: -2000,
      concentrationRisk: 15,
      stalePortfolioDays: 30,
      bondMaturityDays: 60,
      insufficientCash: 0.5,
      ...insightThresholds
  };

  const [activeInsight, setActiveInsight] = useState<{ title: string, data: any[], columns: any[] } | null>(null);
  const [modalSort, setModalSort] = useState({ key: '', direction: 'asc' });

  const handleModalSort = (key: string) => {
      setModalSort(prev => ({
          key,
          direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
      }));
  };

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

  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [isLayoutModalOpen, setIsLayoutModalOpen] = useState(false);

  const handleDragStart = (e: React.DragEvent, id: string) => {
      setDraggedId(id);
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      if (!draggedId || draggedId === targetId || !Array.isArray(insightLayout)) return;

      const newLayout = [...insightLayout];
      const draggedIndex = newLayout.findIndex(item => item.id === draggedId);
      const targetIndex = newLayout.findIndex(item => item.id === targetId);

      if (draggedIndex === -1 || targetIndex === -1) return;

      const [draggedItem] = newLayout.splice(draggedIndex, 1);
      newLayout.splice(targetIndex, 0, draggedItem);

      if (onUpdateLayout) {
          onUpdateLayout(newLayout);
      } else if (setInsightLayout) {
          setInsightLayout(newLayout);
      }
      setDraggedId(null);
  };

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

  const handleConvertToFdrxx = () => {
      if (!window.confirm(`Staging FDRXX buy orders for ${fcashHolders.length} clients. Continue?`)) return;
      
      fcashHolders.forEach(holder => {
          const client = clients.find(c => c.id === holder.clientId);
          if (!client) return;
          const newTrade = {
              id: 'FDRXX-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
              symbol: 'FDRXX',
              action: 'Buy',
              shares: holder.fcashValue,
              value: holder.fcashValue,
              type: 'Market',
              limitPrice: null,
              status: 'pending',
              timestamp: Date.now()
          };
          const updatedClient = {
              ...client,
              stagedTrades: [...(client.stagedTrades || []), newTrade],
              lastUpdated: new Date().toISOString()
          };
          onUpdateClient(updatedClient);
      });
      
      setShowFcashModal(false);
      alert('FDRXX trades successfully staged in the Export Trades tab.');
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

  // --- WIDGET 1: EXCESS CASH ---
  const excessCashAlerts = useMemo(() => {
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

        if (cashPct > safeThresholds.excessCashThreshold) {
          alerts.push({
            clientId: client.id,
            clientName: client.name,
            accountName: acc.name,
            cashPct,
            cashVal,
            type: 'excess'
          });
        }
      });
    });
    return alerts;
  }, [clients, safeThresholds]);

  // --- WIDGET 1.25: INSUFFICIENT CASH LEVELS ---
  const insufficientCashAlerts = useMemo(() => {
    const alerts: any[] = [];
    clients.forEach(client => {
      let totalAUM = 0;
      let totalCash = 0;
      const accounts = client.accounts || (client.positions ? [{ positions: client.positions }] : []);
      accounts.forEach((acc: any) => {
        (acc.positions || []).forEach((p: any) => {
          const val = Number(p.currentValue) || 0;
          totalAUM += val;
          const isCash = CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)) || 
                         (p.description && p.description.toUpperCase().includes('CASH')) ||
                         p.metadata?.assetClass === 'Cash';
          if (isCash) totalCash += val;
        });
      });
      if (totalAUM > 0) {
        const cashPct = (totalCash / totalAUM) * 100;
        if (cashPct < safeThresholds.insufficientCash) {
          alerts.push({
            clientId: client.id,
            clientName: client.name,
            totalAUM,
            totalCash,
            cashPct
          });
        }
      }
    });
    return alerts.sort((a, b) => a.cashPct - b.cashPct);
  }, [clients, safeThresholds]);

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
              const fcashPct = totalAUM > 0 ? (fcashValue / totalAUM) * 100 : 0;
              if (fcashPct > safeThresholds.fcashExposure) {
                  holders.push({
                      clientId: client.id,
                      clientName: client.name,
                      fcashValue,
                      fcashPct
                  });
              }
          }
      });
      return holders.sort((a, b) => b.fcashValue - a.fcashValue);
  }, [clients, safeThresholds]);

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

            if (unrealizedGL < safeThresholds.taxLossOpportunity) {
                opps.push({
                    clientName: client.name,
                    symbol: p.symbol,
                    accountName: acc.name,
                    glDollar: unrealizedGL,
                    glPct: glPct
                });
            }
        });
      });
    });
    return opps.sort((a, b) => a.glPct - b.glPct); 
  }, [clients, safeThresholds]);

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
            if (pct > safeThresholds.concentrationRisk) {
                risks.push({
                    clientName: client.name,
                    symbol: sym,
                    pct
                });
            }
        });
    });
    return risks.sort((a, b) => b.pct - a.pct);
  }, [clients, safeThresholds]);

  // --- WIDGET 4: STALE BESPOKE PORTFOLIOS ---
  const stalePortfolios = useMemo(() => {
      const staleAccounts: any[] = [];
      
      clients.forEach(client => {
          const accounts = client.accounts || (client.positions ? [{ id: 'default', name: 'Primary', positions: client.positions, accountType: client.accountType }] : []);
          
          accounts.forEach((acc: any) => {
              if (acc.accountType === 'Bespoke Portfolio') {
                  let totalVal = 0;
                  (acc.positions || []).forEach((p: any) => totalVal += (Number(p.currentValue) || 0));
                  
                  const lastUpdated = acc.lastUpdated || client.lastUpdated;
                  const diffTime = Date.now() - new Date(lastUpdated).getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                  if (diffDays > safeThresholds.stalePortfolioDays) {
                      staleAccounts.push({
                          name: `${client.name} (${acc.name})`,
                          totalValue: totalVal,
                          lastUpdated: lastUpdated
                      });
                  }
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
  }, [clients, safeThresholds]);

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
                          
                          if (diffDays >= 0 && diffDays < safeThresholds.bondMaturityDays) {
                              maturing.push({
                                  clientName: client.name,
                                  symbol: p.symbol,
                                  description: p.description,
                                  value: Number(p.currentValue) || 0,
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
  }, [clients, safeThresholds]);

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

  const renderWidget = (id: string, w: number) => {
      switch (id) {
          case 'spy':
          case 'qqq':
          case 'dia':
              const indexMap: any = { 'spy': { name: 'S&P 500', icon: TrendingUp }, 'qqq': { name: 'Nasdaq', icon: Activity }, 'dia': { name: 'Dow Jones', icon: Landmark } };
              const index = indexMap[id];
              const data = indexQuotes[id.toUpperCase()];
              const isPositive = data?.change >= 0;
              const Icon = index.icon;
              const isSmall = w <= 2;

              return (
                  <div className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800 rounded-2xl p-4 md:p-6 flex flex-col justify-between group hover:border-zinc-700 transition-all duration-300 shadow-xl h-full">
                      <div className="flex items-center justify-between mb-2 md:mb-4">
                          <div className="flex items-center gap-2 md:gap-3">
                              <div className={`p-1.5 md:p-2 rounded-lg ${isPositive ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                  <Icon className="h-3 w-3 md:h-4 md:w-4" />
                              </div>
                              <span className="text-[9px] md:text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-zinc-300 transition-colors">{index.name}</span>
                          </div>
                          {loadingIndices && <Loader2 className="h-3 w-3 text-zinc-700 animate-spin" />}
                      </div>
                      
                      <div className="space-y-0.5 md:space-y-1">
                          <div className={`${isSmall ? 'text-lg' : 'text-xl md:text-2xl'} font-black text-white font-mono tracking-tighter`}>
                              {data?.price > 0 ? formatCurrency(data.price) : '---'}
                          </div>
                          <div className={`text-[10px] md:text-xs font-bold flex items-center gap-1 ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
                              {isPositive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                              {isPositive ? '+' : ''}{data?.change?.toFixed(2)} ({isPositive ? '+' : ''}{data?.pct?.toFixed(2)}%)
                          </div>
                      </div>
                  </div>
              );
          case 'billing':
              return <BillingCountdown billingInfo={billingInfo} />;
          case 'excessCash':
              return (
                  <Card 
                      title={`Excess Cash (>${safeThresholds.excessCashThreshold}%)`} 
                      icon={Wallet} 
                      className="h-96"
                      onClick={() => setActiveInsight({
                          title: 'Excess Cash',
                          data: excessCashAlerts,
                          columns: [
                              { key: 'clientName', label: 'Client Name' },
                              { key: 'accountName', label: 'Account' },
                              { key: 'cashPct', label: 'Actual %', render: (val: number) => <span className="font-mono">{val.toFixed(1)}%</span> },
                              { key: 'cashVal', label: 'Cash Value', render: (val: number) => <span className="font-mono">{formatCurrency(val)}</span> }
                          ]
                      })}
                  >
                      <div className="overflow-y-auto custom-scrollbar h-full pr-2 space-y-3">
                          {excessCashAlerts.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                                  <Wallet className="h-8 w-8 mb-2 opacity-20" />
                                  <span className="text-xs font-bold">No alerts found</span>
                              </div>
                          ) : (
                              excessCashAlerts.map((alert, i) => (
                                  <div key={i} className="flex items-center justify-between p-3 bg-zinc-950/50 border border-zinc-800/50 rounded-xl">
                                      <div>
                                          <div className="font-bold text-zinc-200 text-sm">{alert.clientName}</div>
                                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{alert.accountName}</div>
                                      </div>
                                      <div className="text-right text-orange-400">
                                          <div className="font-mono font-black text-lg">{alert.cashPct.toFixed(1)}%</div>
                                          <div className="text-[9px] font-bold uppercase">Excess Cash</div>
                                      </div>
                                  </div>
                              ))
                          )}
                      </div>
                  </Card>
              );
          case 'fcash':
              return (
                  <Card 
                      title={`FCASH Exposure (>${safeThresholds.fcashExposure}%)`} 
                      icon={Banknote} 
                      className="h-96 flex flex-col"
                      onClick={() => setActiveInsight({
                          title: 'FCASH Exposure',
                          data: fcashHolders,
                          action: {
                              label: 'Convert all to FDRXX',
                              icon: Sparkles,
                              onClick: handleConvertToFdrxx
                          },
                          columns: [
                              { key: 'clientName', label: 'Client Name' },
                              { key: 'fcashValue', label: 'FCASH Value', render: (val: number) => <span className="font-mono text-blue-400">{formatCurrency(val)}</span> },
                              { key: 'fcashPct', label: '% of Portfolio', render: (val: number) => <span className="font-mono">{val.toFixed(2)}%</span> }
                          ]
                      })}
                  >
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
              );
          case 'insufficientCash':
              return (
                  <Card 
                      title={`Insufficient Cash (<${safeThresholds.insufficientCash}%)`} 
                      icon={Wallet} 
                      className="h-96 flex flex-col"
                      onClick={() => setActiveInsight({
                          title: 'Insufficient Cash Levels',
                          data: insufficientCashAlerts,
                          columns: [
                              { key: 'clientName', label: 'Client Name' },
                              { key: 'totalAUM', label: 'Total AUM', render: (val: number) => <span className="font-mono">{formatCurrency(val)}</span> },
                              { key: 'totalCash', label: 'Cash Balance', render: (val: number) => <span className="font-mono text-orange-400">{formatCurrency(val)}</span> },
                              { key: 'cashPct', label: 'Actual %', render: (val: number) => <span className="font-mono text-red-400">{val.toFixed(2)}%</span> }
                          ]
                      })}
                  >
                      <div className="overflow-y-auto custom-scrollbar flex-1 pr-2 space-y-3">
                          {insufficientCashAlerts.length === 0 ? (
                              <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                                  <Wallet className="h-8 w-8 mb-2 opacity-20" />
                                  <span className="text-xs font-bold">No clients with insufficient cash</span>
                              </div>
                          ) : (
                              insufficientCashAlerts.slice(0, 5).map((alert, i) => (
                                  <div key={i} className="flex items-center justify-between p-3 bg-zinc-950/50 border border-zinc-800/50 rounded-xl">
                                      <div>
                                          <div className="font-bold text-zinc-200 text-sm">{alert.clientName}</div>
                                          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">AUM: {formatCurrency(alert.totalAUM)}</div>
                                      </div>
                                      <div className="text-right">
                                          <div className="font-mono font-black text-lg text-red-400">{alert.cashPct.toFixed(2)}%</div>
                                          <div className="text-[9px] font-bold text-zinc-600 uppercase">Cash: {formatCurrency(alert.totalCash)}</div>
                                      </div>
                                  </div>
                              ))
                          )}
                      </div>
                      {insufficientCashAlerts.length > 0 && (
                          <div className="pt-4 mt-2 border-t border-zinc-800">
                              <button 
                                  onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveInsight({
                                          title: 'Insufficient Cash Levels',
                                          data: insufficientCashAlerts,
                                          columns: [
                                              { key: 'clientName', label: 'Client Name' },
                                              { key: 'totalAUM', label: 'Total AUM', render: (val: number) => <span className="font-mono">{formatCurrency(val)}</span> },
                                              { key: 'totalCash', label: 'Cash Balance', render: (val: number) => <span className="font-mono text-orange-400">{formatCurrency(val)}</span> },
                                              { key: 'cashPct', label: 'Actual %', render: (val: number) => <span className="font-mono text-red-400">{val.toFixed(2)}%</span> }
                                          ]
                                      });
                                  }}
                                  className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-white text-xs font-bold rounded-lg transition-colors"
                              >
                                  View All ({insufficientCashAlerts.length})
                              </button>
                          </div>
                      )}
                  </Card>
              );
          case 'taxLoss':
              return (
                  <Card 
                      title={`Tax-Loss Opportunities (<${formatCurrency(safeThresholds.taxLossOpportunity)})`} 
                      icon={TrendingDown} 
                      className="h-96"
                      onClick={() => setActiveInsight({
                          title: 'Tax-Loss Opportunities',
                          data: tlhOpportunities,
                          columns: [
                              { key: 'clientName', label: 'Client Name' },
                              { key: 'symbol', label: 'Symbol', render: (val: string) => <span className="font-black bg-zinc-800 px-1.5 py-0.5 rounded text-xs">{val}</span> },
                              { key: 'accountName', label: 'Account' },
                              { key: 'glDollar', label: 'Unrealized Loss', render: (val: number) => <span className="font-mono text-red-400">{formatCurrency(val)}</span> }
                          ]
                      })}
                  >
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
              );
          case 'concentration':
              return (
                  <Card 
                      title={`Concentration Risk (>${safeThresholds.concentrationRisk}%)`} 
                      icon={PieChart} 
                      className="h-96"
                      onClick={() => setActiveInsight({
                          title: 'Concentration Risk',
                          data: concentrationRisks,
                          columns: [
                              { key: 'clientName', label: 'Client Name' },
                              { key: 'symbol', label: 'Symbol', render: (val: string) => <span className="font-black bg-zinc-800 px-1.5 py-0.5 rounded text-xs">{val}</span> },
                              { key: 'pct', label: 'Weight', render: (val: number) => <span className="font-mono text-orange-400">{val.toFixed(2)}%</span> }
                          ]
                      })}
                  >
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
              );
          case 'stalePortfolios':
              return (
                  <Card 
                      title={`Stale Bespoke Portfolios (>${safeThresholds.stalePortfolioDays} Days)`} 
                      icon={Clock} 
                      className="h-96"
                      onClick={() => setActiveInsight({
                          title: 'Stale Bespoke Portfolios',
                          data: stalePortfolios,
                          columns: [
                              { key: 'name', label: 'Client (Account)' },
                              { key: 'lastUpdated', label: 'Last Updated', render: (val: string) => val ? new Date(val).toLocaleDateString() : 'Never' },
                              { key: 'lastUpdated', label: 'Days Stale', render: (val: string) => {
                                  if (!val) return 'N/A';
                                  const days = Math.ceil((Date.now() - new Date(val).getTime()) / (1000 * 60 * 60 * 24));
                                  return <span className="font-mono text-orange-400">{days}d</span>;
                              }}
                          ]
                      })}
                  >
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
              );
          case 'bondMaturities':
              return (
                  <Card 
                      title={`Bond Maturities (<${safeThresholds.bondMaturityDays} Days)`} 
                      icon={Calendar} 
                      className="h-96"
                      onClick={() => setActiveInsight({
                          title: 'Upcoming Bond Maturities',
                          data: bondMaturities,
                          columns: [
                              { key: 'clientName', label: 'Client Name' },
                              { key: 'symbol', label: 'Symbol', render: (val: string, row: any) => <div className="flex flex-col"><span className="font-bold">{val}</span><span className="text-[9px] text-zinc-500 truncate max-w-[200px]">{row.description}</span></div> },
                              { key: 'value', label: 'Value', render: (val: number) => <span className="font-mono">{formatCurrency(val)}</span> },
                              { key: 'days', label: 'Days to Maturity', render: (val: number) => <span className="font-mono text-blue-400">{val}d</span> }
                          ]
                      })}
                  >
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
              );
          case 'leaderboard':
              return (
                  <div className="space-y-6 h-full">
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
              );
          default:
              return null;
      }
  };

  return (
    <div className="max-w-[1600px] mx-auto p-8 md:p-12 space-y-8 pb-24">
      <div className="flex justify-between items-end">
        <div>
            <h1 className="text-4xl font-black text-white tracking-tighter">Insights</h1>
            <p className="text-zinc-500 text-lg mt-2 font-medium">Automated risk detection and portfolio opportunities.</p>
        </div>
        <button onClick={() => setIsLayoutModalOpen(true)} className="bg-zinc-900 hover:bg-zinc-800 text-white p-3 rounded-full transition-colors border border-zinc-800">
            <Settings className="h-5 w-5" />
        </button>
      </div>

      <div className="grid grid-cols-24 gap-6" ref={containerRef}>
        {Array.isArray(insightLayout) && insightLayout.filter((item: any) => item.visible).map((item: any) => {
            const colSpan = `col-span-${Math.min(24, Math.max(1, item.w))}`;
            const rowSpan = `row-span-${Math.min(24, Math.max(1, item.h))}`;

            return (
                <div 
                    key={item.id} 
                    className={`relative ${colSpan} ${rowSpan} ${isInsightResizingUnlocked ? 'border-2 border-dashed border-blue-500/50' : ''} transition-[grid-column-end,grid-row-end] duration-150 ease-out`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, item.id)}
                    onDragOver={handleDragOver}
                    onDrop={(e) => handleDrop(e, item.id)}
                >
                    {renderWidget(item.id, item.w)}
                    {isInsightResizingUnlocked && (
                        <div 
                            className="absolute bottom-0 right-0 p-1 cursor-se-resize bg-blue-500 text-white rounded-tl-lg"
                            onMouseDown={(e) => handleResizeStart(e, item.id, item.w, item.h)}
                        >
                            <Maximize2 className="h-4 w-4" />
                        </div>
                    )}
                </div>
            );
        })}
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
                      <div className="flex items-center gap-4">
                          <button 
                              onClick={handleConvertToFdrxx}
                              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-black uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-blue-500/20"
                          >
                              <Sparkles className="h-3.5 w-3.5" />
                              Convert all to FDRXX
                          </button>
                          <button onClick={() => setShowFcashModal(false)} className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors">
                              <X className="h-5 w-5" />
                          </button>
                      </div>
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
      {/* LAYOUT CONFIGURATION MODAL */}
      <InsightSettingsModal 
          isOpen={isLayoutModalOpen} 
          onClose={() => setIsLayoutModalOpen(false)} 
          layout={insightLayout} 
          setLayout={setInsightLayout} 
          onReset={() => setInsightLayout(defaultLayout)} 
          isResizingUnlocked={isInsightResizingUnlocked}
          setIsResizingUnlocked={setIsInsightResizingUnlocked}
      />

      {activeInsight && (
          <InsightDetailModal 
              insight={activeInsight} 
              onClose={() => setActiveInsight(null)} 
              sort={modalSort}
              onSort={handleModalSort}
          />
      )}
    </div>
  );
};

export default InsightsDashboard;
