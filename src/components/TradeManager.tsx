import React, { useState, useMemo, useEffect } from 'react';
import { 
  ChevronDown, ChevronRight, Trash2, AlertTriangle, Download, 
  RefreshCw, Zap, ZapOff, Target, Check, X, DollarSign, Activity, 
  ArrowRight, Layers, FileSpreadsheet, Plus, Minus
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import Button from './Button';

interface TradeManagerProps {
  clients: any[];
  onUpdateClient: (client: any) => void;
  fetchFinnhub: (url: string) => Promise<any>;
}

const TradeManager = ({ clients, onUpdateClient, fetchFinnhub }: TradeManagerProps) => {
  const [expandedClients, setExpandedClients] = useState<Record<string, boolean>>({});
  const [liveQuotes, setLiveQuotes] = useState<Record<string, any>>({});
  const [isRefreshing, setIsRefreshing] = useState(false);

  const clientsWithTrades = useMemo(() => {
    return clients.filter(c => c.stagedTrades && c.stagedTrades.length > 0);
  }, [clients]);

  const toggleExpand = (id: string) => {
    setExpandedClients(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const refreshPrice = async (symbol: string) => {
    try {
        const data = await fetchFinnhub(`quote?symbol=${symbol}`);
        if (data && data.c) {
            setLiveQuotes(prev => ({
                ...prev,
                [symbol]: {
                    lastPrice: data.c,
                    timestamp: new Date(),
                    volume: prev[symbol]?.volume || 0
                }
            }));
            
            // Fetch volume for the thinly-traded warning
            const metrics = await fetchFinnhub(`stock/metric?symbol=${symbol}&metric=all`);
            if (metrics && metrics.metric?.avg10DayVolume) {
                setLiveQuotes(prev => ({
                    ...prev,
                    [symbol]: { 
                        ...prev[symbol], 
                        volume: metrics.metric.avg10DayVolume * 1000000 
                    }
                }));
            }
        }
    } catch (e) {
        console.error("Quote refresh failed", e);
    }
  };

  const fetchQuotes = async () => {
    setIsRefreshing(true);
    const symbols = new Set<string>();
    clientsWithTrades.forEach(c => {
      c.stagedTrades.forEach((t: any) => symbols.add(t.symbol));
    });
    
    await Promise.all(Array.from(symbols).map(sym => refreshPrice(sym)));
    setIsRefreshing(false);
  };

  useEffect(() => {
    if (clientsWithTrades.length > 0) {
      fetchQuotes();
    }
  }, [clientsWithTrades.length]);

  const handleDeleteTrade = (client: any, tradeId: string, symbol: string) => {
    const updatedTrades = client.stagedTrades.filter((t: any) => 
      (t.id && t.id !== tradeId) || (!t.id && t.symbol !== symbol)
    );
    onUpdateClient({ ...client, stagedTrades: updatedTrades });
  };

  const handleClearAll = (client: any) => {
    if (!client?.id) return;
    
    if (window.confirm(`Are you sure you want to clear all staged trades and visual flags for ${client.name}?`)) {
      // Create a clean copy of the client without trades or flags
      const cleanedClient = {
        ...client,
        stagedTrades: [],
        tradeFlags: {}
      };
      
      onUpdateClient(cleanedClient);
    }
  };

  const handleUpdateTrade = (client: any, tradeId: string, updates: any) => {
    const updatedTrades = client.stagedTrades.map((t: any) => 
      t.id === tradeId ? { ...t, ...updates } : t
    );
    onUpdateClient({ ...client, stagedTrades: updatedTrades });
  };

  const handleApplyLimitToAll = (symbol: string, limitPrice: number) => {
    clients.forEach(c => {
      if (c.stagedTrades?.some((t: any) => t.symbol === symbol)) {
        const updatedTrades = c.stagedTrades.map((t: any) => 
          t.symbol === symbol ? { ...t, type: 'Limit', limitPrice } : t
        );
        onUpdateClient({ ...c, stagedTrades: updatedTrades });
      }
    });
  };

  const exportToFidelity = () => {
    let csv = '';
    const allTrades: any[] = [];

    clients.forEach(client => {
      if (client.stagedTrades) {
        client.stagedTrades.forEach((trade: any) => {
          allTrades.push({ client, trade });
        });
      }
    });

    if (allTrades.length === 0) return;

    allTrades.forEach(({ client, trade }) => {
      const row = new Array(31).fill('');
      row[0] = client.profile?.accountNumber || client.id;
      row[1] = '1'; // Cash
      row[2] = trade.action === 'Buy' ? 'B' : 'S';
      row[3] = trade.shares;
      row[4] = trade.symbol;
      row[5] = trade.type === 'Limit' ? 'L' : 'M';
      row[6] = 'D'; // Day
      row[7] = trade.type === 'Limit' ? trade.limitPrice : '';
      row[8] = 'S'; // Shares
      
      csv += row.join(',') + '\n';
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `fidelity_trades_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Update status to exported
    clients.forEach(c => {
      if (c.stagedTrades?.length > 0) {
        const updatedTrades = c.stagedTrades.map((t: any) => ({ ...t, status: 'exported' }));
        onUpdateClient({ ...c, stagedTrades: updatedTrades });
      }
    });
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-white tracking-tighter flex items-center gap-3">
            <FileSpreadsheet className="h-10 w-10 text-blue-500" />
            TRADE EXPORT
          </h1>
          <p className="text-zinc-500 font-medium mt-1">Review and execute staged trades across all client accounts.</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={fetchQuotes}
            disabled={isRefreshing}
            className="h-12 w-12 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 hover:text-white transition-all hover:bg-zinc-800"
          >
            <RefreshCw className={`h-5 w-5 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
          <button 
            onClick={exportToFidelity}
            className="px-8 h-12 bg-blue-600 hover:bg-blue-500 text-white rounded-2xl font-black uppercase tracking-widest text-sm flex items-center gap-3 shadow-lg shadow-blue-600/20 transition-all"
          >
            <Download className="h-5 w-5" />
            Export to Fidelity
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {clientsWithTrades.length === 0 ? (
          <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-3xl p-20 flex flex-col items-center justify-center text-center">
            <div className="h-20 w-20 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-600 mb-6">
              <ZapOff className="h-10 w-10" />
            </div>
            <h3 className="text-xl font-black text-white tracking-tight">No Staged Trades</h3>
            <p className="text-zinc-500 max-w-xs mt-2">Go to a client rebalancer and stage some trades to see them here.</p>
          </div>
        ) : (
          clientsWithTrades.map(client => {
            const isExpanded = expandedClients[client.id];
            const totalBuy = client.stagedTrades.reduce((sum: number, t: any) => t.action === 'Buy' ? sum + t.value : sum, 0);
            const totalSell = client.stagedTrades.reduce((sum: number, t: any) => t.action === 'Sell' ? sum + t.value : sum, 0);

            return (
              <div key={client.id} className="bg-zinc-900/30 border border-zinc-800 rounded-3xl overflow-hidden transition-all hover:border-zinc-700">
                <div 
                  onClick={() => toggleExpand(client.id)}
                  className="p-6 flex items-center justify-between cursor-pointer group"
                >
                  <div className="flex items-center gap-6">
                    <div className="h-12 w-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-400 group-hover:bg-zinc-700 transition-colors">
                      {isExpanded ? <ChevronDown className="h-6 w-6" /> : <ChevronRight className="h-6 w-6" />}
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-white tracking-tight">{client.name}</h3>
                      <p className="text-zinc-500 text-sm font-medium">{client.stagedTrades.length} Pending Orders</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-12">
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Aggregate Buy</p>
                      <p className="text-lg font-mono font-black text-green-500">{formatCurrency(totalBuy)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-1">Aggregate Sell</p>
                      <p className="text-lg font-mono font-black text-red-500">{formatCurrency(totalSell)}</p>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); handleClearAll(client); }}
                      className="h-10 w-10 rounded-xl flex items-center justify-center text-zinc-600 hover:text-red-500 hover:bg-red-500/10 transition-all"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div 
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="border-t border-zinc-800 bg-zinc-950/50"
                    >
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-zinc-800">
                              <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Action</th>
                              <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Symbol</th>
                              <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Shares</th>
                              <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Live Quote</th>
                              <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Order Type</th>
                              <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Limit Price</th>
                              <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500">Status</th>
                              <th className="p-4 text-right"></th>
                            </tr>
                          </thead>
                          <tbody>
                            {client.stagedTrades.map((trade: any) => {
                              const quote = liveQuotes[trade.symbol];
                              const isThinlyTraded = quote && quote.volume < 1000000;

                              return (
                                <tr key={trade.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/20 transition-colors group/row">
                                  <td className="p-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${trade.action === 'Buy' ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                                      {trade.action}
                                    </span>
                                  </td>
                                  <td className="p-4">
                                    <div className="flex items-center gap-2">
                                      <span className="font-black text-white">{trade.symbol}</span>
                                      <button onClick={(e) => { e.stopPropagation(); refreshPrice(trade.symbol); }} className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-white transition-colors">
                                        <RefreshCw className="h-3 w-3" />
                                      </button>
                                      {isThinlyTraded && (
                                        <div className="group relative">
                                          <AlertTriangle className="h-4 w-4 text-amber-500" />
                                          <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-amber-500 text-black text-[10px] font-bold rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                                            Thinly Traded ({quote.volume.toLocaleString()} Vol) - Limit Order Recommended
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-4 font-mono text-zinc-300">{trade.shares.toLocaleString()}</td>
                                  <td className="p-4">
                                    {quote ? (
                                      <div className="flex flex-col">
                                        <span className="font-mono text-white font-bold">{formatCurrency(quote.lastPrice)}</span>
                                        <span className="text-[10px] text-zinc-500 font-medium">Vol: {(quote.volume / 1000000).toFixed(1)}M</span>
                                      </div>
                                    ) : (
                                      <span className="text-zinc-600 italic text-xs">Loading...</span>
                                    )}
                                  </td>
                                  <td className="p-4">
                                    <div className="flex bg-zinc-900 rounded-lg p-1 w-fit">
                                      {['Market', 'Limit'].map(type => (
                                        <button
                                          key={type}
                                          onClick={() => handleUpdateTrade(client, trade.id, { type })}
                                          className={`px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${trade.type === type ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                          {type}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="p-4">
                                    {trade.type === 'Limit' ? (
                                      <div className="flex items-center gap-2">
                                        <div className="relative">
                                          <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500" />
                                          <input 
                                            type="number"
                                            value={trade.limitPrice || ''}
                                            onChange={(e) => handleUpdateTrade(client, trade.id, { limitPrice: parseFloat(e.target.value) })}
                                            placeholder="0.00"
                                            className="w-24 bg-zinc-900 border border-zinc-800 rounded-lg pl-6 pr-2 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-blue-500 transition-colors"
                                          />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                          <button 
                                            onClick={() => {
                                              const base = quote?.lastPrice || trade.limitPrice || 0;
                                              handleUpdateTrade(client, trade.id, { limitPrice: parseFloat((base * 1.0025).toFixed(2)) });
                                            }}
                                            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                                            title="+0.25%"
                                          >
                                            <Plus className="h-3 w-3" />
                                          </button>
                                          <button 
                                            onClick={() => {
                                              const base = quote?.lastPrice || trade.limitPrice || 0;
                                              handleUpdateTrade(client, trade.id, { limitPrice: parseFloat((base * 0.9975).toFixed(2)) });
                                            }}
                                            className="p-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                                            title="-0.25%"
                                          >
                                            <Minus className="h-3 w-3" />
                                          </button>
                                        </div>
                                        <button 
                                          onClick={() => handleApplyLimitToAll(trade.symbol, trade.limitPrice)}
                                          className="p-2 rounded-lg bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white transition-all ml-2"
                                          title="Apply to All Clients"
                                        >
                                          <Layers className="h-4 w-4" />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-zinc-600 text-xs">—</span>
                                    )}
                                  </td>
                                  <td className="p-4">
                                    <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${trade.status === 'exported' ? 'bg-blue-500/10 text-blue-500' : 'bg-zinc-800 text-zinc-500'}`}>
                                      {trade.status}
                                    </span>
                                  </td>
                                  <td className="p-4 text-right">
                                    <button 
                                      onClick={() => handleDeleteTrade(client, trade.id, trade.symbol)}
                                      className="h-8 w-8 rounded-lg flex items-center justify-center text-zinc-600 hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover/row:opacity-100 transition-all"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TradeManager;
