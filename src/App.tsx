import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { motion } from 'motion/react';
import { 
  PieChart, ArrowRight, Upload, Trash2, Sparkles, Loader2, Globe, LayoutGrid, 
  PieChart as PieIcon, ChevronUp, ChevronDown, Briefcase, ArrowUpDown, 
  RefreshCw, Scale, Plus, Zap, ZapOff, ShieldCheck, Search, PlusCircle, 
  Newspaper, TrendingUp, Calendar, Info, Target, Users, Layers, Check, X, 
  Copy, Pencil, LineChart, AlertTriangle, FlaskConical, Database, WifiOff, 
  BarChart2, Activity, Banknote, Settings, Columns, GripVertical, ChevronRight, 
  RotateCcw, Landmark, MapPin, Key, Clock, ArrowDownAZ, ArrowUpAZ, 
  ArrowUpNarrowWide, ArrowDownWideNarrow, LayoutList, DollarSign, Eye, EyeOff, Lightbulb, Lock, Unlock, Save, ChevronLeft, Menu, Image, Sun, Moon, LogOut, Tag, Star, User, FileSpreadsheet, Layout, List, Settings2
} from 'lucide-react';
import { ref, uploadString, getDownloadURL, deleteObject } from "firebase/storage";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { storage, auth, db } from './services/firebase';
import InsightsDashboard from './components/InsightsDashboard';
import { fetchFinnhub, fetchTiingoGlobal, callGemini, markKeyAsDead, getFinnhubKeys, getLogoDevKey, getTiingoKeys, getGeminiKeys, safeSetItem, trackApiUsage } from './services/api';
import { parseFidelityCSV, parseMassImportCSV } from './utils/csvParsers';
import TradeManager from './components/TradeManager';
import Button from './components/Button';

const Tooltip = ({ children, text }: { children: React.ReactNode; text: string; key?: any }) => {
  const [show, setShow] = React.useState(false);
  if (!text) return <>{children}</>;
  return (
    <div
      className="relative flex items-center group"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {show && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-[1000] animate-in fade-in zoom-in-95 duration-100">
          <div className="relative bg-zinc-900 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg border border-zinc-800 shadow-2xl whitespace-nowrap">
            <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-zinc-900 border-l border-t border-zinc-800 rotate-45" />
            {text}
          </div>
        </div>
      )}
    </div>
  );
};

export interface Position {
    id: string;
    symbol: string;
    description: string;
    quantity: number;
    price: number;
    currentValue: number;
    costBasis: number;
    yield?: number;
    targetPct: number;
    roundingMode?: string;
    metadata?: any;
    unrealizedGL?: number;
    unrealizedGLPct?: number;
    tradeValue?: number;
    tradeShares?: number;
    isCash?: boolean;
    issuer?: string;
    maturityDate?: string;
    currentPct?: number;
}

export interface Account {
    id: string;
    accountNumber: string;
    name: string;
    positions: Position[];
    isMoneyMarket: boolean;
    lastUpdated: string;
}

export interface Client {
    id: string;
    name: string;
    accounts: Account[];
    lastUpdated: string;
    settings?: any;
    ladderSettings?: any;
    stagedTrades?: any[];
    profile?: {
        firstName?: string;
        lastName?: string;
        nickname?: string;
        dob?: string;
        phone?: string;
        email?: string;
        address?: string;
        accountNumber?: string;
        notes?: string;
    };
    tradeFlags?: Record<string, 'buy' | 'sell' | 'hold'>;
}

const REFRESH_INTERVAL = 15000; 
const GLOBAL_QUOTE_CACHE = new Map(); // key: symbol, value: { price, yield, timestamp }
const QUOTE_CACHE_TTL = 60000; // 60 seconds
let globalFirmOverviewCache: any = { assets: [], lastUpdated: 0, clientHash: '' };

const DEFAULT_INSIGHT_LAYOUT = [
  { i: 'spy', label: 'S&P 500', x: 0, y: 0, w: 12, h: 10, minW: 3, minH: 4, visible: true },
  { i: 'qqq', label: 'Nasdaq', x: 12, y: 0, w: 12, h: 10, minW: 3, minH: 4, visible: true },
  { i: 'dia', label: 'Dow Jones', x: 24, y: 0, w: 12, h: 10, minW: 3, minH: 4, visible: true },
  { i: 'billing', label: 'Days until Billing', x: 36, y: 0, w: 12, h: 10, minW: 3, minH: 4, visible: true },
  { i: 'excessCash', label: 'Excess Cash', x: 0, y: 10, w: 16, h: 22, minW: 4, minH: 6, visible: true },
  { i: 'insufficientCash', label: 'Insufficient Cash', x: 16, y: 10, w: 16, h: 22, minW: 4, minH: 6, visible: true },
  { i: 'fcash', label: 'FCASH Holdings', x: 32, y: 10, w: 16, h: 22, minW: 4, minH: 6, visible: true },
  { i: 'taxLoss', label: 'Tax Loss Harvesting', x: 0, y: 32, w: 16, h: 22, minW: 4, minH: 6, visible: true },
  { i: 'concentration', label: 'Concentration Risk', x: 16, y: 32, w: 16, h: 22, minW: 4, minH: 6, visible: true },
  { i: 'stalePortfolios', label: 'Stale Portfolios', x: 32, y: 32, w: 16, h: 22, minW: 4, minH: 6, visible: true },
  { i: 'bondMaturities', label: 'Bond Maturities', x: 0, y: 54, w: 16, h: 22, minW: 4, minH: 6, visible: true },
  { i: 'leaderboard', label: 'Performance Leaders', x: 0, y: 76, w: 48, h: 36, minW: 8, minH: 10, visible: true }
];

// --- DEFAULT LAYOUT ---
const DEFAULT_COLUMNS = [
  { id: 'symbol', label: 'Security', width: 200, visible: true },
  { id: 'issuer', label: 'Issuer', width: 150, visible: true },
  { id: 'maturityDate', label: 'Maturity Date', width: 120, visible: true },
  { id: 'quantity', label: 'Shares', width: 100, visible: true, align: 'right' },
  { id: 'price', label: 'Mkt Price', width: 100, visible: true, align: 'right' },
  { id: 'currentValue', label: 'Value', width: 120, visible: true, align: 'right' },
  { id: 'costBasis', label: 'Cost Basis', width: 120, visible: true, align: 'right' },
  { id: 'unrealizedGL', label: 'Unrealized G/L', width: 120, visible: true, align: 'right' },
  { id: 'unrealizedGLPct', label: 'G/L %', width: 100, visible: true, align: 'right' },
  { id: 'todayGL', label: 'Today $', width: 100, visible: true, align: 'right' },
  { id: 'todayGLPct', label: 'Today %', width: 100, visible: true, align: 'right' },
  { id: 'yield', label: 'Yield', width: 80, visible: true, align: 'right' },
  { id: 'currentPct', label: 'Weight', width: 80, visible: true, align: 'right' },
  { id: 'targetPct', label: 'Goal %', width: 100, visible: true, align: 'right' },
  { id: 'actualTargetValue', label: 'Goal $', width: 120, visible: true, align: 'right' },
  { id: 'tradeValue', label: 'Trade $', width: 120, visible: true, align: 'right' },
  { id: 'tradeShares', label: 'Trade Shares', width: 160, visible: true, align: 'right' },
];

// --- STYLES ---
const GlobalStyles = () => (
  <style>{`
    :root {
      --bg-primary: #09090b;
      --bg-secondary: #18181b;
      --accent: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.5);
      --text-main: #f4f4f5;
      --text-muted: #71717a;
    }
/* Hijack Tailwind classes to use our dynamic variables */
.bg-zinc-950 { background-color: var(--bg-primary) !important; }
.bg-zinc-900 { background-color: var(--bg-secondary) !important; }
.border-zinc-800 { border-color: rgba(255,255,255,0.1) !important; }
.text-zinc-100, .text-white { color: var(--text-main) !important; }
.text-zinc-500, .text-zinc-400 { color: var(--text-muted) !important; }
/* Accent Overrides */
.bg-blue-600, .bg-blue-500 { background-color: var(--accent) !important; }
.text-blue-400, .text-blue-500, .text-blue-600 { color: var(--accent) !important; }
.border-blue-500, .border-blue-600 { border-color: var(--accent) !important; }
/* Scrollbar Theme Sync */
.custom-scrollbar::-webkit-scrollbar-track { background: var(--bg-primary); }
.custom-scrollbar::-webkit-scrollbar-thumb {
background: var(--bg-secondary);
border: 2px solid var(--bg-primary);
}

/* Light Mode Text Adjustments */
.light-theme-text-adj { --text-main: #09090b; --text-muted: #52525b; }
/* Functional Styles */
input[type='number']::-webkit-inner-spin-button,
input[type='number']::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
input[type='number'] { -moz-appearance: textfield; appearance: textfield; }
.gauge-progress { transition: stroke-dashoffset 1s cubic-bezier(0.4, 0, 0.2, 1); }
.gauge-marker { transition: transform 1s cubic-bezier(0.4, 0, 0.2, 1); transform-origin: 100px 100px; }
`}</style>
);

// --- HELPERS ---

const generateId = () => Math.random().toString(36).substr(2, 9);

const CASH_TICKERS = ["FDRXX", "FCASH", "SPAXX", "CASH", "MMDA", "USD", "CORE", "FZFXX", "SWVXX"];
const COVERED_CALL_TICKERS = ['JEPI', 'JEPQ', 'QYLD', 'XYLD', 'RYLD', 'DIVO', 'GPIX', 'GPIQ', 'SPYI', 'ISPY', 'FEPI', 'SVOL'];
const BENCHMARK_OPTIONS = [
  { id: 'SPY', label: 'S&P 500 (SPY)', components: { SPY: 1 } },
  { id: 'QQQ', label: 'Nasdaq 100 (QQQ)', components: { QQQ: 1 } },
  { id: '90/10', label: '90% S&P 500 / 10% Bond', components: { SPY: 0.9, AGG: 0.1 } },
  { id: '80/20', label: '80% S&P 500 / 20% Bond', components: { SPY: 0.8, AGG: 0.2 } },
  { id: '70/30', label: '70% S&P 500 / 30% Bond', components: { SPY: 0.7, AGG: 0.3 } },
  { id: '60/40', label: '60% S&P 500 / 40% Bond', components: { SPY: 0.6, AGG: 0.4 } },
  { id: '50/50', label: '50% S&P 500 / 50% Bond', components: { SPY: 0.5, AGG: 0.5 } },
];
const TIME_RANGES = [
    { label: '1M', days: 30 }, { label: '3M', days: 90 }, { label: '6M', days: 180 },
    { label: 'YTD', days: 'ytd' }, { label: '1Y', days: 365 }, { label: '3Y', days: 365 * 3 },
    { label: '5Y', days: 365 * 5 }, { label: 'Custom', days: 'Custom' },
];

const isBond = (symbol, description) => {
    if (!description) return false;
    const bondPattern = /\d+\.?\d*%\s+\d{2}\/\d{2}\/\d{4}/;
    const isCusip = symbol && symbol.length === 9 && /^[0-9A-Z]+$/.test(symbol);
    const hasBondKeywords = description.includes(" BDS ") || description.includes(" NOTE ") || description.includes(" CORP ") || description.includes(" MUNI ");
    return bondPattern.test(description) || (isCusip && hasBondKeywords);
};

const isCoveredCall = (p) => {
    if (COVERED_CALL_TICKERS.includes(p.symbol)) return true;
    const desc = (p.description || "").toUpperCase();
    return desc.includes('COVERED CALL') || desc.includes('BUYWRITE') || desc.includes('OPTION INCOME');
};

const formatCurrency = (val) => {
  const num = Number(val);
  if (isNaN(num) || num === 0) return '$0.00';
  const str = Math.abs(num).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (num < 0 ? '-$' : '$') + str;
};

const formatPercent = (val) => (Number(val) * 100).toFixed(2) + '%';
const formatQuantity = (val) => Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 3 });

// --- UTILITY COMPONENTS ---

const Card = ({ children, className = "", title, icon: Icon, onClick }: any) => (
  <div onClick={onClick} className={`bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col transition-colors ${onClick ? 'cursor-pointer hover:border-zinc-600' : ''} ${className}`}>
    {(title || Icon) && (
      <div className="px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/50 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-zinc-500" />}
        <span className="text-[10px] font-black uppercase tracking-[0.1em] text-zinc-500">{title}</span>
      </div>
    )}
    <div className="p-4 flex-1">{children}</div>
  </div>
);

// Map common bond issuer names to their stock tickers for logo retrieval
const BOND_ISSUERS = {
  "WELLS FARGO": "WFC", "JPMORGAN": "JPM", "J P MORGAN": "JPM", "BANK OF AMERICA": "BAC", 
  "GOLDMAN SACHS": "GS", "GOLDMAN": "GS", "MORGAN STANLEY": "MS", "CITIGROUP": "C", 
  "CITI": "C", "BLACKROCK": "BLK", "BERKSHIRE": "BRK.B", "CHARLES SCHWAB": "SCHW", 
  "AMERICAN EXPRESS": "AXP", "VISA": "V", "MASTERCARD": "MA", "CAPITAL ONE": "COF", 
  "US BANCORP": "USB", "PNC": "PNC", "TRUIST": "TFC", "HSBC": "HSBC", "BARCLAYS": "BCS", 
  "UBS": "UBS", "DEUTSCHE BANK": "DB", "ROYAL BANK OF CANADA": "RY", "TORONTO DOMINION": "TD",
  "APPLE": "AAPL", "MICROSOFT": "MSFT", "AMAZON": "AMZN", "ALPHABET": "GOOGL", 
  "GOOGLE": "GOOGL", "META": "META", "FACEBOOK": "META", "NVIDIA": "NVDA", 
  "INTEL": "INTC", "AMD": "AMD", "ADVANCED MICRO": "AMD", "MICROCHIP": "MCHP", 
  "BROADCOM": "AVGO", "QUALCOMM": "QCOM", "TEXAS INSTRUMENTS": "TXN", "ORACLE": "ORCL", 
  "IBM": "IBM", "CISCO": "CSCO", "SALESFORCE": "CRM", "ADOBE": "ADBE", "INTUIT": "INTU", 
  "PAYPAL": "PYPL", "SERVICENOW": "NOW", "NETFLIX": "NFLX", "TAKE-TWO": "TTWO", 
  "LEIDOS": "LDOS", "BOOZ ALLEN": "BAH", "UBER": "UBER", "AT&T": "T", "VERIZON": "VZ", 
  "T-MOBILE": "TMUS", "COMCAST": "CMCSA", "CHARTER": "CHTR", "DISNEY": "DIS", 
  "WARNER BROS": "WBD", "PARAMOUNT": "PARA", "UNITEDHEALTH": "UNH", "CVS": "CVS", 
  "ELEVANCE": "ELV", "ANTHEM": "ELV", "CIGNA": "CI", "PFIZER": "PFE", 
  "JOHNSON & JOHNSON": "JNJ", "JOHNSON": "JNJ", "ABBVIE": "ABBV", "MERCK": "MRK", 
  "BRISTOL-MYERS": "BMY", "BRISTOL MYERS": "BMY", "AMGEN": "AMGN", "GILEAD": "GILD", 
  "ELI LILLY": "LLY", "LILLY": "LLY", "THERMO FISHER": "TMO", "DANAHER": "DHR", 
  "ABBOTT": "ABT", "STRYKER": "SYK", "MEDTRONIC": "MDT", "BECTON DICKINSON": "BDX", 
  "BOSTON SCIENTIFIC": "BSX", "WALMART": "WMT", "COSTCO": "COST", "TARGET": "TGT", 
  "HOME DEPOT": "HD", "LOWE'S": "LOW", "MCDONALD": "MCD", "STARBUCKS": "SBUX", 
  "NIKE": "NKE", "PROCTER & GAMBLE": "PG", "P&G": "PG", "PEPSICO": "PEP", 
  "COCA-COLA": "KO", "PHILIP MORRIS": "PM", "ALTRIA": "MO", "COLGATE": "CL", 
  "ESTEE LAUDER": "EL", "GENERAL MOTORS": "GM", "GM ": "GM", "FORD": "F", 
  "TESLA": "TSLA", "TOYOTA": "TM", "HONDA": "HMC", "BOEING": "BA", "LOCKHEED": "LMT", 
  "RAYTHEON": "RTX", "NORTHROP": "NOC", "GENERAL DYNAMICS": "GD", "L3HARRIS": "LHX", 
  "HONEYWELL": "HON", "GENERAL ELECTRIC": "GE", "CATERPILLAR": "CAT", "DEERE": "DE", 
  "3M": "MMM", "UPS": "UPS", "UNITED PARCEL": "UPS", "FEDEX": "FDX", "UNION PACIFIC": "UNP", 
  "CSX": "CSX", "EXXON": "XOM", "CHEVRON": "CVX", "CONOCOPHILLIPS": "COP", 
  "SCHLUMBERGER": "SLB", "EOG": "EOG", "MARATHON": "MPC", "PHILLIPS 66": "PSX", 
  "VALERO": "VLO", "OCCIDENTAL": "OXY", "KINDER MORGAN": "KMI", "WILLIAMS COS": "WMB", 
  "ENTERPRISE PRODUCTS": "EPD", "ENERGY TRANSFER": "ET", "NEXTERA": "NEE", 
  "DUKE ENERGY": "DUK", "SOUTHERN CO": "SO", "DOMINION": "D", "EXELON": "EXC", 
  "AMERICAN ELECTRIC": "AEP", "SEMPI": "SRE", "PACIFIC GAS": "PCG", "CONSOLIDATED EDISON": "ED", 
  "PUBLIC SERVICE": "PEG", "TREASURY": "GOVT", "UNITED STATES TREAS": "GOVT", 
  "US TREASURY": "GOVT", "FANNIE MAE": "FNMA", "FREDDIE MAC": "FMCC"
};

const CompanyLogo = React.memo(({ symbol, description, logoTicker, stateCode, isLoading, className = "" }) => {
  const [error, setError] = useState(false);
    
  useEffect(() => {
      setError(false);
  }, [symbol, logoTicker]);

  const displaySymbol = useMemo(() => {
      if (logoTicker) return logoTicker;
      if (!symbol) return null;
      
      const isPotentialBond = symbol.length === 9 && /^[0-9A-Z]+$/.test(symbol);
      if (isPotentialBond && description) {
          const upperDesc = description.toUpperCase();
          for (const [key, ticker] of Object.entries(BOND_ISSUERS)) {
              if (upperDesc.includes(key)) return ticker;
          }
      }
      return symbol;
  }, [symbol, description, logoTicker]);

  const isCash = symbol && CASH_TICKERS.some(t => symbol.toUpperCase().includes(t));
  const isBondLike = symbol && symbol.length === 9 && /^[0-9A-Z]+$/.test(symbol);

  if (isLoading && isBondLike && !logoTicker && !stateCode && !isCash) {
       return (
            <div className={`flex items-center justify-center bg-zinc-900 border border-zinc-800 rounded-lg flex-shrink-0 ${className}`}>
                <Sparkles className="h-4 w-4 text-blue-500 animate-pulse" />
            </div>
       );
  }

  if (stateCode) {
      return (
        <div className={`flex items-center justify-center bg-teal-950 text-teal-400 rounded-lg border border-teal-500/30 flex-shrink-0 relative overflow-hidden group ${className}`}>
            <div className="relative flex items-center justify-center">
                <MapPin className="h-6 w-6 text-teal-500 fill-teal-950/50" strokeWidth={1.5} />
                <span className="absolute text-[8px] font-black tracking-tighter text-white -mt-1">{stateCode}</span>
            </div>
        </div>
      );
  }

  if (!symbol) return null;
    
  if (error || isCash) {
      return (
        <div className={`flex items-center justify-center bg-zinc-800 text-[10px] font-bold text-zinc-400 rounded-lg border border-zinc-700/50 flex-shrink-0 ${className}`}>
            {isBondLike ? <Landmark className="h-4 w-4 opacity-50" /> : symbol.slice(0, 3)}
        </div>
      );
  }

  return (
    <div className={`bg-white rounded-lg flex items-center justify-center overflow-hidden border border-zinc-700/50 shadow-sm flex-shrink-0 ${className}`}>
        <img 
            src={`https://img.logo.dev/ticker/${displaySymbol}?token=${getLogoDevKey()}`} 
            onError={() => setError(true)} 
            alt={symbol} 
            className="w-full h-full object-contain" 
        />
    </div>
  );
});

const Gauge = ({ value, max, label, subLabel }) => {
  const radius = 30;
  const stroke = 6; const circumference = 2 * Math.PI * radius; const arcLength = circumference * 0.75;
  const percentage = Math.min(Math.max(value, 0), max) / max;
  let color = percentage > 0.85 ? "#ef4444" : percentage > 0.6 ? "#eab308" : "#22c55e";
  return (
    <div className="flex flex-col items-center">
      <div className="relative h-20 w-20 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-[225deg]" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r={radius} fill="none" stroke="#27272a" strokeWidth={stroke} strokeDasharray={`${arcLength} ${circumference}`} strokeLinecap="round" />
          <circle cx="40" cy="40" r={radius} fill="none" stroke={color} strokeWidth={stroke} strokeDasharray={`${arcLength} ${circumference}`} strokeDashoffset={arcLength - (percentage * arcLength)} strokeLinecap="round" className="transition-all duration-1000 ease-out" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-2"><span className="text-xl font-black text-white leading-none">{value}</span><span className="text-[9px] text-zinc-500 font-bold uppercase">/ {max}</span></div>
      </div>
      <div className="text-center mt-1"><div className="text-[10px] font-black uppercase text-zinc-400">{label}</div><div className="text-[9px] text-zinc-600">{subLabel}</div></div>
    </div>
  );
};

const SleekGauge = ({ value, target, label, subLabel, color }) => {
    const radius = 80;
    const stroke = 12;
    const startAngle = -220;
    const endAngle = 40;
    const totalAngle = endAngle - startAngle;
    
    const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
        const angleInRadians = (angleInDegrees - 90) * Math.PI / 180.0;
        return {
            x: centerX + (radius * Math.cos(angleInRadians)),
            y: centerY + (radius * Math.sin(angleInRadians))
        };
    };

    const describeArc = (x, y, radius, startAngle, endAngle) => {
        const start = polarToCartesian(x, y, radius, endAngle);
        const end = polarToCartesian(x, y, radius, startAngle);
        const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
        return [
            "M", start.x, start.y, 
            "A", radius, radius, 0, largeArcFlag, 0, end.x, end.y
        ].join(" ");
    };

    const pct = Math.min(Math.max(value, 0), 100);
    const progressAngle = startAngle + (totalAngle * (pct / 100));
    
    const needleAngle = Math.min(Math.max(startAngle + (totalAngle * (value/100)), startAngle), endAngle);
    
    const markerPos = polarToCartesian(100, 100, radius, needleAngle);
    const markerInner = polarToCartesian(100, 100, radius - (stroke / 2), needleAngle);
    const markerOuter = polarToCartesian(100, 100, radius + (stroke / 2), needleAngle);

    const targetAngle = Math.min(Math.max(startAngle + (totalAngle * (target/100)), startAngle), endAngle);
    const targetPos = polarToCartesian(100, 100, radius, targetAngle);
    const targetInnerLine = polarToCartesian(100, 100, radius - 15, targetAngle);

    const gradients = {
        pink: ['#FF0055', '#FF00AA'],
        purple: ['#8800FF', '#AA00FF'],
        blue: ['#0088FF', '#00AAFF'],
        cyan: ['#00FFFF', '#00FFAA']
    };
    
    let startColor, endColor;
    if (color && color.startsWith('#')) {
        startColor = color;
        endColor = color;
    } else {
        [startColor, endColor] = gradients[color] || gradients.blue;
    }

    const safeLabel = label.replace(/\s+/g, '-');

    return (
        <div className="flex flex-col items-center justify-center p-4">
            <div className="relative w-[200px] h-[120px] flex justify-center">
                <svg width="200" height="150" viewBox="0 0 200 150" className="overflow-visible">
                    <defs>
                        <linearGradient id={`grad-${safeLabel}`} x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor={startColor} />
                            <stop offset="100%" stopColor={endColor} />
                        </linearGradient>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
                            <feMerge>
                                <feMergeNode in="coloredBlur"/>
                                <feMergeNode in="SourceGraphic"/>
                            </feMerge>
                        </filter>
                    </defs>

                    <path 
                        d={describeArc(100, 100, radius, startAngle, endAngle)} 
                        fill="none" 
                        stroke="#18181b" 
                        strokeWidth={stroke} 
                        strokeLinecap="round" 
                    />

                    <path 
                        d={describeArc(100, 100, radius, startAngle, progressAngle)} 
                        fill="none" 
                        stroke={`url(#grad-${safeLabel})`} 
                        strokeWidth={stroke} 
                        strokeLinecap="round"
                        className="gauge-progress"
                        filter="url(#glow)"
                    />

                    {target > 0 && (
                          <line 
                            x1={targetInnerLine.x} y1={targetInnerLine.y} 
                            x2={targetPos.x} y2={targetPos.y} 
                            stroke="white" 
                            strokeWidth="2"
                            opacity="0.6"
                        />
                    )}

                    <line 
                        x1={markerInner.x} y1={markerInner.y} 
                        x2={markerOuter.x} y2={markerOuter.y} 
                        stroke="white" 
                        strokeWidth="4" 
                        className="gauge-marker"
                        strokeLinecap="butt"
                    />
                    
                    {Array.from({length: 9}).map((_, i) => {
                        const tickAngle = startAngle + (totalAngle * (i / 8));
                        const p1 = polarToCartesian(100, 100, radius + 18, tickAngle);
                        const p2 = polarToCartesian(100, 100, radius + 24, tickAngle);
                        return <line key={i} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke="#3f3f46" strokeWidth="2" opacity="0.5" />;
                    })}

                    <text x="100" y="105" textAnchor="middle" fill="white" fontSize="32" fontWeight="900" fontFamily="monospace" letterSpacing="-2px">
                        {value.toFixed(2)}%
                    </text>
                </svg>
            </div>
            
            <div className="text-center mt-0 w-full relative z-10">
                <div className="flex items-center justify-center gap-2 mb-1">
                    <div className={`h-2 w-2 rounded-full`} style={{ background: startColor }} />
                    <span className="text-xs font-black uppercase tracking-widest text-zinc-400">{label}</span>
                </div>
                {subLabel}
            </div>
        </div>
    );
};

const TargetAllocator = ({ positions, client, onUpdateClient }) => {
    const hasSpecifiedTargets = client.settings?.hasSpecifiedTargets || false;
    const isTargetsLocked = client.settings?.isTargetsLocked || false;

    // Helper to calculate current weights
    const calculateCurrentWeights = useMemo(() => {
        if (!positions) return { equity: 0, fixedIncome: 0, coveredCall: 0, cash: 0, equity_stocks: 0, equity_funds: 0, fi_bonds: 0, fi_funds: 0 };
        
        let equity = 0, fixedIncome = 0, coveredCall = 0, cash = 0;
        let equity_stocks = 0, equity_funds = 0, fi_bonds = 0, fi_funds = 0;
        const total = positions.reduce((sum, p) => sum + (Number(p.currentValue) || 0), 0);
        
        if (total === 0) return { equity: 0, fixedIncome: 0, coveredCall: 0, cash: 0, equity_stocks: 0, equity_funds: 0, fi_bonds: 0, fi_funds: 0 };

        positions.forEach(p => {
            const val = Number(p.currentValue) || 0;
            const isC = CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)) || p.metadata?.assetClass === 'Cash';
            const isFi = p.metadata?.assetClass === 'Fixed Income' || p.metadata?.assetClass === 'Municipal Bond' || isBond(p.symbol, p.description);
            const isCc = isCoveredCall(p);
            const isF = (p.symbol.length === 5 && p.symbol.endsWith('X')) || (p.description && /\b(ETF|FUND|TRUST)\b/i.test(p.description));
            
            if (isC) { cash += val; }
            else if (isCc) { coveredCall += val; }
            else if (isFi) { 
                fixedIncome += val; 
                if (isF) fi_funds += val; else fi_bonds += val;
            }
            else { 
                equity += val; 
                if (isF) equity_funds += val; else equity_stocks += val;
            } 
        });

        return {
            equity: (equity / total) * 100,
            fixedIncome: (fixedIncome / total) * 100,
            coveredCall: (coveredCall / total) * 100,
            cash: (cash / total) * 100,
            equity_stocks: (equity_stocks / total) * 100,
            equity_funds: (equity_funds / total) * 100,
            fi_bonds: (fi_bonds / total) * 100,
            fi_funds: (fi_funds / total) * 100
        };
    }, [positions]);

    const [targets, setTargets] = useState(() => {
        if (client.allocationTargets) {
            return {
                ...client.allocationTargets,
                equity_stocks: client.allocationTargets.equity_stocks ?? parseFloat(calculateCurrentWeights.equity_stocks.toFixed(2)),
                equity_funds: client.allocationTargets.equity_funds ?? parseFloat(calculateCurrentWeights.equity_funds.toFixed(2)),
                fi_bonds: client.allocationTargets.fi_bonds ?? parseFloat(calculateCurrentWeights.fi_bonds.toFixed(2)),
                fi_funds: client.allocationTargets.fi_funds ?? parseFloat(calculateCurrentWeights.fi_funds.toFixed(2))
            };
        }
        return {
            equity: parseFloat(calculateCurrentWeights.equity.toFixed(2)),
            fixedIncome: parseFloat(calculateCurrentWeights.fixedIncome.toFixed(2)),
            coveredCall: parseFloat(calculateCurrentWeights.coveredCall.toFixed(2)),
            cash: parseFloat(calculateCurrentWeights.cash.toFixed(2)),
            equity_stocks: parseFloat(calculateCurrentWeights.equity_stocks.toFixed(2)),
            equity_funds: parseFloat(calculateCurrentWeights.equity_funds.toFixed(2)),
            fi_bonds: parseFloat(calculateCurrentWeights.fi_bonds.toFixed(2)),
            fi_funds: parseFloat(calculateCurrentWeights.fi_funds.toFixed(2))
        };
    });

    // Default hiddenBuckets to include 'coveredCall' if undefined
    const hiddenBuckets = client.settings?.hiddenBuckets || ['coveredCall'];

    useEffect(() => {
        if (!hasSpecifiedTargets) {
            setTargets({
                equity: parseFloat(calculateCurrentWeights.equity.toFixed(2)),
                fixedIncome: parseFloat(calculateCurrentWeights.fixedIncome.toFixed(2)),
                coveredCall: parseFloat(calculateCurrentWeights.coveredCall.toFixed(2)),
                cash: parseFloat(calculateCurrentWeights.cash.toFixed(2)),
                equity_stocks: parseFloat(calculateCurrentWeights.equity_stocks.toFixed(2)),
                equity_funds: parseFloat(calculateCurrentWeights.equity_funds.toFixed(2)),
                fi_bonds: parseFloat(calculateCurrentWeights.fi_bonds.toFixed(2)),
                fi_funds: parseFloat(calculateCurrentWeights.fi_funds.toFixed(2))
            });
        }
    }, [calculateCurrentWeights, hasSpecifiedTargets]);

    const handleTargetChange = (key, value) => {
        const newTargets = { ...targets, [key]: parseFloat(value) || 0 };
        setTargets(newTargets);
        onUpdateClient({ 
            ...client, 
            allocationTargets: newTargets,
            settings: { ...(client.settings || {}), hasSpecifiedTargets: true }
        });
    };

    const stats = useMemo(() => {
        let equity = 0;
        let fixedIncome = 0;
        let coveredCall = 0;
        let cash = 0;
        
        if (!positions) return { total: 0, values: { equity: 0, fixedIncome: 0, coveredCall: 0, cash: 0 }, percents: { equity: 0, fixedIncome: 0, coveredCall: 0, cash: 0 } };
        
        const total = positions.reduce((sum, p) => sum + (Number(p.currentValue) || 0), 0);
        
        positions.forEach(p => {
            const val = Number(p.currentValue) || 0;
            const isC = CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)) || p.metadata?.assetClass === 'Cash';
            const isFi = p.metadata?.assetClass === 'Fixed Income' || p.metadata?.assetClass === 'Municipal Bond' || isBond(p.symbol, p.description);
            const isCc = isCoveredCall(p);
            
            if (isC) cash += val;
            else if (isCc) coveredCall += val;
            else if (isFi) fixedIncome += val;
            else equity += val; 
        });
        
        return {
            total,
            values: { equity, fixedIncome, coveredCall, cash },
            percents: {
                equity: total > 0 ? (equity / total) * 100 : 0,
                fixedIncome: total > 0 ? (fixedIncome / total) * 100 : 0,
                coveredCall: total > 0 ? (coveredCall / total) * 100 : 0,
                cash: total > 0 ? (cash / total) * 100 : 0,
            }
        };
    }, [positions]);

    const buckets = [
        { id: 'equity', label: 'Equities', color: '#3b82f6' },
        { id: 'fixedIncome', label: 'Fixed Income', color: '#f97316' },
        { id: 'coveredCall', label: 'Covered Call', color: '#3b82f6' },
        { id: 'cash', label: 'Cash', color: '#22c55e' },
    ];

    const bucketOrder = client.settings?.bucketOrder || ['equity', 'fixedIncome', 'coveredCall', 'cash'];
    const visibleBuckets = buckets
        .filter(b => {
            if (b.id === 'coveredCall' && stats.values.coveredCall > 0) return true;
            return !hiddenBuckets.includes(b.id);
        })
        .sort((a, b) => bucketOrder.indexOf(a.id) - bucketOrder.indexOf(b.id));
    const totalTargetSum = visibleBuckets.reduce((sum, b) => sum + (targets[b.id] || 0), 0);
    const remaining = 100 - totalTargetSum;

    const calculateDelta = (key) => {
        if (!hasSpecifiedTargets) return 0;
        const targetPct = Number(targets[key]) || 0;
        const currentPct = Number(stats.percents[key]) || 0;
        let delta = (stats.total * (targetPct / 100)) - stats.values[key];
        
        // Snap to zero if they match to 2 decimal places
        if (targetPct.toFixed(2) === currentPct.toFixed(2)) {
            delta = 0;
        }
        return delta;
    };

    return (
        <div className="p-8 mb-8 bg-zinc-950 border-b border-zinc-800">
            <div className="flex flex-col md:flex-row md:items-center justify-between mb-10 gap-6">
                <div>
                    <h3 className="text-2xl font-black text-white tracking-tighter flex items-center gap-2">
                         <Target className="h-6 w-6 text-blue-500" />
                        Portfolio Targets
                        <button 
                            onClick={() => {
                                const newTargets = {
                                    equity: parseFloat(calculateCurrentWeights.equity.toFixed(2)),
                                    fixedIncome: parseFloat(calculateCurrentWeights.fixedIncome.toFixed(2)),
                                    coveredCall: parseFloat(calculateCurrentWeights.coveredCall.toFixed(2)),
                                    cash: parseFloat(calculateCurrentWeights.cash.toFixed(2)),
                                    equity_stocks: parseFloat(calculateCurrentWeights.equity_stocks.toFixed(2)),
                                    equity_funds: parseFloat(calculateCurrentWeights.equity_funds.toFixed(2)),
                                    fi_bonds: parseFloat(calculateCurrentWeights.fi_bonds.toFixed(2)),
                                    fi_funds: parseFloat(calculateCurrentWeights.fi_funds.toFixed(2))
                                };
                                setTargets(newTargets);
                                onUpdateClient({ 
                                    ...client, 
                                    allocationTargets: newTargets,
                                    settings: { ...(client.settings || {}), hasSpecifiedTargets: false }
                                });
                            }}
                            disabled={isTargetsLocked}
                            className={`ml-4 p-1.5 rounded-lg transition-colors ${isTargetsLocked ? 'bg-zinc-900/50 border border-zinc-800/50 text-zinc-600 cursor-not-allowed' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </button>
                        <button 
                            onClick={() => {
                                onUpdateClient({ 
                                    ...client, 
                                    settings: { ...(client.settings || {}), isTargetsLocked: !isTargetsLocked }
                                });
                            }}
                            className={`ml-2 p-1.5 rounded-lg transition-colors ${isTargetsLocked ? 'bg-blue-500/20 border border-blue-500/30 text-blue-400' : 'bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800'}`}
                            title={isTargetsLocked ? "Unlock Targets" : "Lock Targets"}
                        >
                            {isTargetsLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                        </button>
                    </h3>
                    <p className={`text-xs mt-1 font-bold ${hasSpecifiedTargets ? 'text-blue-400' : 'text-zinc-500'}`}>{hasSpecifiedTargets ? 'Target specified' : 'Target not specified'}</p>
                </div>

                <div className="flex items-center gap-6 p-4 bg-zinc-900/50 rounded-2xl border border-zinc-800/80 shadow-inner">
                    <div className="flex flex-col gap-1 pr-6 border-r border-zinc-800">
                        <div className="flex items-center gap-2">
                            <div className={`h-2.5 w-2.5 rounded-full ${Math.abs(remaining) < 0.05 ? 'bg-green-500' : 'bg-orange-500'} shadow-lg`} />
                            <span className={`text-sm font-black uppercase tracking-widest ${Math.abs(remaining) < 0.05 ? 'text-green-400' : 'text-zinc-300'}`}>
                                Total: {totalTargetSum.toFixed(1)}%
                            </span>
                        </div>
                        <p className={`text-[10px] font-bold uppercase tracking-tight ${remaining > 0 ? 'text-blue-400' : remaining < 0 ? 'text-red-400' : 'text-green-500'}`}>
                            {remaining > 0 ? `+${remaining.toFixed(1)}% Needed` : remaining < 0 ? `${Math.abs(remaining).toFixed(1)}% Excess` : 'Perfectly Balanced'}
                        </p>
                    </div>
                    <div className="w-32 h-2 bg-zinc-950 rounded-full overflow-hidden border border-zinc-800/50">
                        <div 
                            className={`h-full transition-all duration-700 ease-out ${totalTargetSum > 100 ? 'bg-red-500' : totalTargetSum === 100 ? 'bg-green-500' : 'bg-blue-600'}`} 
                            style={{ width: `${Math.min(totalTargetSum, 100)}%` }} 
                        />
                    </div>
                </div>
            </div>

            <div className="flex flex-wrap justify-center gap-8">
                {visibleBuckets.map(bucket => {
                    const currentPct = stats.percents[bucket.id];
                    const delta = calculateDelta(bucket.id);
                    return (
                        <div key={bucket.id} className="flex flex-col items-center group w-full md:w-auto max-w-[250px]">
                            <SleekGauge 
                                value={currentPct} 
                                target={targets[bucket.id]} 
                                label={bucket.label} 
                                color={bucket.color}
                                subLabel={
                                    <div className={`text-[10px] font-mono font-black mt-1 py-1 px-2 rounded bg-zinc-900/50 ${delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-zinc-600'}`}>
                                        {delta > 0 ? '+' : ''}{formatCurrency(delta)}
                                    </div>
                                }
                            />
                            <div className="mt-2 w-full px-12">
                                <div className="relative bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden group-hover:border-zinc-500 transition-colors focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500/20">
                                    <input 
                                        type="number" 
                                        step="0.01"
                                        disabled={isTargetsLocked}
                                        onFocus={(e) => e.target.select()}
                                        className="w-full bg-transparent p-2 text-center text-white font-mono font-bold text-sm focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                                        value={targets[bucket.id]} 
                                        onChange={e => handleTargetChange(bucket.id, e.target.value)} 
                                    />
                                    <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                                <label className="block text-[8px] font-black uppercase text-zinc-600 mt-1 text-center tracking-widest">Target %</label>
                                {bucket.id === 'equity' && (
                                    <div className="flex gap-2 mt-2">
                                        <div className="flex-1 flex flex-col items-center">
                                            <input 
                                                type="number" 
                                                step="0.01"
                                                disabled={isTargetsLocked}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-900 border border-zinc-800 text-[10px] p-1 rounded text-center text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                                value={targets.equity_stocks || 0}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    const newTargets = { ...targets, equity_stocks: val, equity: val + (targets.equity_funds || 0) };
                                                    setTargets(newTargets);
                                                    onUpdateClient({ 
                                                        ...client, 
                                                        allocationTargets: newTargets,
                                                        settings: { ...(client.settings || {}), hasSpecifiedTargets: true }
                                                    });
                                                }}
                                            />
                                            <span className="text-[8px] text-zinc-500 uppercase font-bold mt-0.5">Stocks</span>
                                        </div>
                                        <div className="flex-1 flex flex-col items-center">
                                            <input 
                                                type="number" 
                                                step="0.01"
                                                disabled={isTargetsLocked}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-900 border border-zinc-800 text-[10px] p-1 rounded text-center text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                                value={targets.equity_funds || 0}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    const newTargets = { ...targets, equity_funds: val, equity: (targets.equity_stocks || 0) + val };
                                                    setTargets(newTargets);
                                                    onUpdateClient({ 
                                                        ...client, 
                                                        allocationTargets: newTargets,
                                                        settings: { ...(client.settings || {}), hasSpecifiedTargets: true }
                                                    });
                                                }}
                                            />
                                            <span className="text-[8px] text-zinc-500 uppercase font-bold mt-0.5">Funds</span>
                                        </div>
                                    </div>
                                )}
                                {bucket.id === 'fixedIncome' && (
                                    <div className="flex gap-2 mt-2">
                                        <div className="flex-1 flex flex-col items-center">
                                            <input 
                                                type="number" 
                                                step="0.01"
                                                disabled={isTargetsLocked}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-900 border border-zinc-800 text-[10px] p-1 rounded text-center text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                                value={targets.fi_bonds || 0}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    const newTargets = { ...targets, fi_bonds: val, fixedIncome: val + (targets.fi_funds || 0) };
                                                    setTargets(newTargets);
                                                    onUpdateClient({ 
                                                        ...client, 
                                                        allocationTargets: newTargets,
                                                        settings: { ...(client.settings || {}), hasSpecifiedTargets: true }
                                                    });
                                                }}
                                            />
                                            <span className="text-[8px] text-zinc-500 uppercase font-bold mt-0.5">Bonds</span>
                                        </div>
                                        <div className="flex-1 flex flex-col items-center">
                                            <input 
                                                type="number" 
                                                step="0.01"
                                                disabled={isTargetsLocked}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-900 border border-zinc-800 text-[10px] p-1 rounded text-center text-white focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                                                value={targets.fi_funds || 0}
                                                onChange={e => {
                                                    const val = parseFloat(e.target.value) || 0;
                                                    const newTargets = { ...targets, fi_funds: val, fixedIncome: (targets.fi_bonds || 0) + val };
                                                    setTargets(newTargets);
                                                    onUpdateClient({ 
                                                        ...client, 
                                                        allocationTargets: newTargets,
                                                        settings: { ...(client.settings || {}), hasSpecifiedTargets: true }
                                                    });
                                                }}
                                            />
                                            <span className="text-[8px] text-zinc-500 uppercase font-bold mt-0.5">Funds</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
                {visibleBuckets.length === 0 && (
                     <div className="flex flex-col items-center justify-center p-12 text-zinc-500">
                         <Info className="h-8 w-8 mb-2 opacity-50"/>
                         <p className="text-sm font-bold">All Asset Classes Hidden</p>
                         <p className="text-xs">Adjust visibility in settings.</p>
                     </div>
                )}
            </div>
        </div>
    );
};
// --- CORE DASHBOARD PIECES ---

const StyleBox = ({ data }) => {
  const rows = ['Large', 'Mid', 'Small'];
  const cols = ['Value', 'Core', 'Growth'];
  
  const rowDisplay = { 'Large': 'Large', 'Mid': 'Medium', 'Small': 'Small' };
  const colDisplay = { 'Value': 'Value', 'Core': 'Blend', 'Growth': 'Growth' };

  return (
    <div className="flex items-start gap-3 w-full max-w-[260px] mx-auto p-2">
      <div className="flex flex-col justify-between py-1 h-full min-h-[140px] text-[9px] font-black text-zinc-500 uppercase tracking-widest text-right">
        {rows.map(r => <div key={r} className="flex-1 flex items-center justify-end">{rowDisplay[r]}</div>)}
        <div className="h-5"></div> 
      </div>

      <div className="flex-1 flex flex-col gap-2 h-full">
        <div className="grid grid-cols-3 grid-rows-3 gap-px bg-zinc-800 border border-zinc-800 rounded-xl overflow-hidden shadow-2xl aspect-square w-full">
          {rows.map(row => 
            cols.map(col => {
              const key = `${row}-${col}`;
              const val = data?.[key] || 0;
              const opacity = Math.min(val * 2.5, 1);
              const isSignificant = val > 0.01;
              
              return (
                <div key={key} className="relative bg-zinc-900/80 flex items-center justify-center group">
                  {isSignificant && (
                    <div 
                      className="absolute inset-0 bg-blue-600 transition-all duration-500" 
                      style={{ opacity: Math.max(opacity, 0.1) }} 
                    />
                  )}
                  <span className={`relative z-10 text-xs font-mono font-bold ${val > 0.15 ? 'text-white' : isSignificant ? 'text-zinc-300' : 'text-zinc-700'}`}>
                    {Math.round(val * 100)}%
                  </span>
                </div>
              );
            })
          )}
        </div>
        <div className="grid grid-cols-3 text-center text-[9px] font-black text-zinc-500 uppercase tracking-widest">
          {cols.map(c => <span key={c}>{colDisplay[c]}</span>)}
        </div>
      </div>
    </div>
  );
};

const Toggle = ({ value, onChange, options }) => (
    <div className="flex bg-zinc-950 p-0.5 rounded-lg mb-3 border border-zinc-800">
        {options.map(opt => (
            <button
                key={opt}
                onClick={() => onChange(opt)}
                className={`flex-1 px-2 py-1.5 text-[9px] font-black uppercase tracking-wider rounded-md transition-all ${value === opt ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
            >
                {opt}
            </button>
        ))}
    </div>
);

const AnalyticsDashboard = ({ positions, client, onUpdateClient, assetOverrides }: any) => {
  const [sectorView, setSectorView] = useState('Equity');
  const [geoView, setGeoView] = useState('Equity');
  
  const ASSET_CLASSES = ["U.S. Equity", "Non-U.S. Equity", "Fixed Income", "Other", "Not Classified"];

  const stats = useMemo(() => {
    if (!positions) return { assetClass: [], sector: { Equity: [], 'Fixed Income': [] }, geo: { Equity: [], 'Fixed Income': [] }, totalVal: 0 };
    const invested = positions.filter((p: any) => {
        const s = p.symbol.toUpperCase();
        return !CASH_TICKERS.some(t => s.includes(t)) && 
               !(p.description && p.description.toUpperCase().includes('CASH')) &&
               p.metadata?.assetClass !== 'Cash';
    });

    const totalCurrentVal = invested.reduce((sum: number, p: any) => sum + (Number(p.currentValue) || 0), 0);
    const useTargets = totalCurrentVal === 0;
    const totalBasis = useTargets ? invested.reduce((sum: number, p: any) => sum + (Number(p.targetPct) || 0), 0) : totalCurrentVal;
    
    const equities: any[] = [];
    const fixedIncome: any[] = [];
    let equityTotal = 0;
    let fiTotal = 0;

    invested.forEach((p: any) => {
        const val = useTargets ? (Number(p.targetPct) || 0) : (Number(p.currentValue) || 0);
        const isFi = p.metadata?.assetClass === 'Fixed Income' || p.metadata?.assetClass === 'Municipal Bond' || isBond(p.symbol, p.description);
        if (isFi) {
            fixedIncome.push({ ...p, _calcVal: val });
            fiTotal += val;
        } else {
            equities.push({ ...p, _calcVal: val });
            equityTotal += val;
        }
    });

    const aggregate = (assets: any[], total: number, key: string) => {
        const res: any = {};
        assets.forEach(p => {
            let k = 'Unclassified';
            // Check overrides for style and sector
            if (assetOverrides && assetOverrides[p.symbol] && assetOverrides[p.symbol][key]) {
                k = assetOverrides[p.symbol][key];
            } else {
                k = p.metadata?.[key] || 'Unclassified';
            }
            const w = total > 0 ? p._calcVal / total : 0;
            res[k] = (res[k] || 0) + w;
        });
        return res;
    };

    const allocation: any = ASSET_CLASSES.reduce((acc, curr) => ({ ...acc, [curr]: 0 }), {});
    invested.forEach((p: any) => {
        const k = p.metadata?.assetClass || 'Not Classified';
        const val = useTargets ? (Number(p.targetPct) || 0) : (Number(p.currentValue) || 0);
        const w = totalBasis > 0 ? val / totalBasis : 0;
        allocation[k] = (allocation[k] || 0) + w;
    });

    return { 
        allocation, 
        styleBox: aggregate(equities, equityTotal, 'style'), 
        sectors: {
            Equity: aggregate(equities, equityTotal, 'sector'),
            'Fixed Income': aggregate(fixedIncome, fiTotal, 'sector')
        },
        countries: {
            Equity: aggregate(equities, equityTotal, 'country'),
            'Fixed Income': aggregate(fixedIncome, fiTotal, 'country')
        },
        totalVal: totalCurrentVal 
    };
  }, [positions, assetOverrides]);

  return (
    <div className="flex flex-col bg-zinc-950">
      <TargetAllocator positions={positions} client={client} onUpdateClient={onUpdateClient} />

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-6 p-8 border-b border-zinc-800">
        <Card title="Asset Distribution" icon={PieIcon}>
            <div className="space-y-3">
            {ASSET_CLASSES.map(k => (
                <div key={k} className="flex justify-between text-xs items-center">
                <span className="text-zinc-500 font-medium">{k}</span>
                <div className="flex items-center gap-3">
                    <div className="w-24 h-1 bg-zinc-800 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${(stats.allocation[k] || 0) * 100}%` }} /></div>
                    <span className="font-mono w-12 text-right text-white font-bold">{((stats.allocation[k] || 0) * 100).toFixed(1)}%</span>
                </div>
                </div>
            ))}
            </div>
        </Card>
        <Card title="Equity Style Grid" icon={LayoutGrid}>
            <div className="h-full flex items-center justify-center relative">
                <StyleBox data={stats.styleBox} />
            </div>
        </Card>
        <Card title="Sector Exposure" icon={PieChart}>
            <div className="flex flex-col h-full">
                <Toggle value={sectorView} onChange={setSectorView} options={['Equity', 'Fixed Income']} />
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-2 custom-scrollbar flex-1">
                {Object.entries(stats.sectors[sectorView]).sort((a: any, b: any) => b[1]-a[1]).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[11px] py-1 border-b border-zinc-800/30 last:border-0"><span className="text-zinc-500 font-medium truncate max-w-[140px]">{k}</span><span className="font-mono text-zinc-200 font-bold">{((v as number) * 100).toFixed(1)}%</span></div>
                ))}
                {Object.keys(stats.sectors[sectorView]).length === 0 && <div className="text-center text-zinc-600 text-[10px] mt-4 italic">No {sectorView} assets found.</div>}
                </div>
            </div>
        </Card>
        <Card title="Geo Concentration" icon={Globe}>
            <div className="flex flex-col h-full">
                <Toggle value={geoView} onChange={setGeoView} options={['Equity', 'Fixed Income']} />
                <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-2 custom-scrollbar flex-1">
                {Object.entries(stats.countries[geoView]).sort((a: any, b: any) => b[1]-a[1]).map(([k, v]) => (
                    <div key={k} className="flex justify-between text-[11px] py-1 border-b border-zinc-800/30 last:border-0"><span className="text-zinc-500 font-medium truncate max-w-[140px]">{k}</span><span className="font-mono text-zinc-200 font-bold">{((v as number) * 100).toFixed(1)}%</span></div>
                ))}
                {Object.keys(stats.countries[geoView]).length === 0 && <div className="text-center text-zinc-600 text-[10px] mt-4 italic">No {geoView} assets found.</div>}
                </div>
            </div>
        </Card>
      </div>
    </div>
  );
};

const ApiKeyManager = ({ keys, onChange, label, placeholder }) => {
    const [newKey, setNewKey] = useState("");
    const [deadKeys, setDeadKeys] = useState<any>({});
    const [revealed, setRevealed] = useState(false);

    useEffect(() => {
        const stored = JSON.parse(localStorage.getItem('dead_api_keys') || '{}');
        const now = Date.now();
        const stillDead: any = {};
        Object.entries(stored).forEach(([k, t]: any) => {
            if (now - t < 24 * 60 * 60 * 1000) stillDead[k] = t; // Keys stay dead for 24 hours
        });
        setDeadKeys(stillDead);
    }, []);

    const handleAdd = () => {
        if (newKey.trim()) {
            onChange([...keys, newKey.trim()]);
            setNewKey("");
        }
    };

    const handleRemove = (index) => {
        onChange(keys.filter((_, i) => i !== index));
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">{label}</label>
                <button onClick={() => setRevealed(!revealed)} className="text-zinc-500 hover:text-white transition-colors">{revealed ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}</button>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
                {keys.map((k, i) => {
                    const isDead = !!deadKeys[k];
                    const displayKey = revealed ? k : '••••••••••••••••••••••••' + k.slice(-4);
                    return (
                        <div key={i} className={`flex items-center gap-2 bg-zinc-950 border ${isDead ? 'border-red-900/50' : 'border-zinc-800'} rounded-xl px-3 py-2 group`}>
                            {isDead ? (
                                <ZapOff className="h-3 w-3 text-red-500" title="API Limit Reached (24h Lockout)" />
                            ) : (
                                <div className="h-2 w-2 rounded-full bg-blue-500/50" />
                            )}
                            <span className={`flex-1 font-mono text-xs truncate ${isDead ? 'text-zinc-600 line-through' : 'text-zinc-300'}`}>{displayKey}</span>
                            <button onClick={() => handleRemove(i)} className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all">
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    );
                })}
            </div>
            <div className="flex gap-2">
                <input 
                    className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white text-xs font-mono focus:outline-none focus:border-blue-500 transition-colors" 
                    value={newKey} 
                    onChange={e => setNewKey(e.target.value)} 
                    onKeyDown={e => e.key === 'Enter' && handleAdd()}
                    placeholder={placeholder} 
                />
                <button onClick={handleAdd} className="bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl w-12 flex items-center justify-center transition-colors border border-zinc-700">
                    <Plus className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
};

const GlobalSettingsPage = ({ userProfile, setUserProfile, themeMode, setThemeMode, themeFlavor, setThemeFlavor, accentColor, setAccentColor, customBg, setCustomBg, bgLibrary, onAddToLibrary, onSelectFromLibrary, onDeleteFromLibrary, user, tierSettings, setTierSettings, onImportClients, insightThresholds, setInsightThresholds }) => {
    const [initialUserProfile, setInitialUserProfile] = useState(userProfile);
    const [showPassword, setShowPassword] = useState(false);
    const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');

    const [finnhubKeys, setFinnhubKeys] = useState(() => { const stored = localStorage.getItem('user_finnhub_key'); return stored ? stored.split(',').filter(k => k.trim()) : []; });
    const [logoDev, setLogoDev] = useState(localStorage.getItem('user_logo_dev_key') || '');
    const [tiingoKeys, setTiingoKeys] = useState(() => { const stored = localStorage.getItem('user_tiingo_key'); return stored ? stored.split(',').filter(k => k.trim()) : []; });
    const [geminiKeys, setGeminiKeys] = useState(() => { const stored = localStorage.getItem('user_gemini_key'); return stored ? stored.split(',').filter(k => k.trim()) : []; });
    const [saveText, setSaveText] = useState("Save Settings");
    const [activeTab, setActiveTab] = useState('appearance');
    const [isDraggingBg, setIsDraggingBg] = useState(false);
    const [pendingBg, setPendingBg] = useState<string | null>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = (e) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const handleDrop = (e) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && file.type === "text/csv") {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const content = evt.target.result as string;
                const imported = parseMassImportCSV(content);
                if (imported.length > 0) {
                    onImportClients(imported);
                    setSaveText("Import Successful!");
                    setTimeout(() => setSaveText("Save Settings"), 3000);
                }
            };
            reader.readAsText(file);
        }
    };

    const updateThemeSettings = async (updates) => {
        if (updates.mode) { setThemeMode(updates.mode); localStorage.setItem('theme_mode', updates.mode); }
        if (updates.flavor) { setThemeFlavor(updates.flavor); localStorage.setItem('theme_flavor', updates.flavor); }
        if (updates.accent) { setAccentColor(updates.accent); localStorage.setItem('theme_accent', updates.accent); }
        
        if (user) {
            const currentSettings = {
                themeMode: updates.mode || themeMode,
                themeFlavor: updates.flavor || themeFlavor,
                themeAccent: updates.accent || accentColor
            };
            await setDoc(doc(db, "users", user.uid), JSON.parse(JSON.stringify({ settings: currentSettings })), { merge: true });
        }
    };

    const handleSave = async () => {
        localStorage.setItem('user_profile_settings', JSON.stringify(userProfile));
        setInitialUserProfile(userProfile);
        if (finnhubKeys.length > 0) localStorage.setItem('user_finnhub_key', finnhubKeys.join(',')); else localStorage.removeItem('user_finnhub_key');
        if (logoDev) localStorage.setItem('user_logo_dev_key', logoDev); else localStorage.removeItem('user_logo_dev_key');
        if (tiingoKeys.length > 0) localStorage.setItem('user_tiingo_key', tiingoKeys.join(',')); else localStorage.removeItem('user_tiingo_key');
        if (geminiKeys.length > 0) localStorage.setItem('user_gemini_key', geminiKeys.join(',')); else localStorage.removeItem('user_gemini_key');
        
        if (user) {
            try {
                await setDoc(doc(db, "users", user.uid), JSON.parse(JSON.stringify({
                    settings: {
                        finnhub: finnhubKeys.join(','),
                        tiingo: tiingoKeys.join(','),
                        gemini: geminiKeys.join(','),
                        logoDev: logoDev,
                        themeMode,
                        themeFlavor,
                        themeAccent: accentColor
                    },
                    tierSettings
                })), { merge: true });
            } catch (err) { console.error(err); }
        }
        localStorage.setItem('tier_settings', JSON.stringify(tierSettings));
        setSaveText("Saved!"); setTimeout(() => setSaveText("Save Settings"), 2000);
    };

    const handleBgUpload = (e) => {
        const file = e.target.files[0] || (e.dataTransfer && e.dataTransfer.files[0]);
        if (file) {
            const reader = new FileReader();
            reader.onload = (event) => {
                setPendingBg(event.target.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCommitPending = async (action: 'active' | 'library') => {
        if (!pendingBg) return;
        setIsUploading(true);
        try {
            if (action === 'active') {
                setCustomBg(pendingBg);
                const downloadUrl = await onAddToLibrary(pendingBg);
                setCustomBg(downloadUrl);
            } else {
                await onAddToLibrary(pendingBg);
            }
            setPendingBg(null);
        } catch (err) {
            alert("Failed to process image.");
        } finally {
            setIsUploading(false);
        }
    };

    const clearBg = async () => {
        setCustomBg('');
        try {
            const bgRef = ref(storage, `users/${auth.currentUser?.uid || 'developer_local_123'}/custom_bg`);
            await deleteObject(bgRef);
        } catch (e) { /* Ignore if it doesn't exist yet */ }
        localStorage.removeItem('user_custom_bg'); // Clean up old legacy data
    };

    const handleMassImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const text = evt.target?.result as string;
            const newClients = parseMassImportCSV(text);
            if (newClients.length > 0) {
                onImportClients(newClients);
                setSaveText("Import Successful!");
                setTimeout(() => setSaveText("Save Settings"), 3000);
            } else {
                alert("Failed to parse CSV. Please check the format.");
            }
        };
        reader.readAsText(file);
    };

    const handlePasswordUpdate = () => {
        if (newPassword !== confirmPassword) {
            setPasswordError("Passwords do not match");
            return;
        }
        if (newPassword.length < 8) {
            setPasswordError("Password must be at least 8 characters");
            return;
        }
        setUserProfile({ ...userProfile, password: newPassword });
        setIsPasswordModalOpen(false);
        setNewPassword('');
        setConfirmPassword('');
        setPasswordError('');
    };

    const hasProfileChanges = JSON.stringify(userProfile) !== JSON.stringify(initialUserProfile);

    return (
        <div className="max-w-6xl mx-auto p-8 md:p-12 space-y-8 pb-24 relative z-10">
            {isPasswordModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-md space-y-4 shadow-2xl animate-in zoom-in-95 duration-200">
                        <div className="flex justify-between items-center">
                            <h3 className="text-lg font-black text-white">Update Password</h3>
                            <button onClick={() => setIsPasswordModalOpen(false)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button>
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">New Password</label>
                                <input 
                                    type="password" 
                                    value={newPassword}
                                    onChange={(e) => setNewPassword(e.target.value)}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white text-sm mt-1 focus:border-blue-500 focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Confirm Password</label>
                                <input 
                                    type="password" 
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white text-sm mt-1 focus:border-blue-500 focus:outline-none"
                                />
                            </div>
                            {passwordError && <p className="text-red-500 text-xs font-bold">{passwordError}</p>}
                        </div>
                        <div className="pt-2 flex gap-3">
                            <button onClick={() => setIsPasswordModalOpen(false)} className="flex-1 py-2 rounded-xl border border-zinc-800 text-zinc-400 text-xs font-bold hover:bg-zinc-800">Cancel</button>
                            <button onClick={handlePasswordUpdate} className="flex-1 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-500">Update Password</button>
                        </div>
                    </div>
                </div>
            )}
            <div><h1 className="text-4xl font-black text-white tracking-tighter">Settings</h1><p className="text-zinc-500 text-base mt-2 font-medium">Manage your workspace preferences and integrations.</p></div>

            <div className="flex flex-col md:flex-row gap-8 lg:gap-12 mt-8">
                {/* Left Side Navigation */}
                <div className="w-full md:w-64 shrink-0 space-y-1">
                    {[
                        { id: 'appearance', label: 'Appearance', icon: Image },
                        { id: 'profile', label: 'Profile & Security', icon: ShieldCheck },
                        { id: 'apis', label: 'API Integrations', icon: Key },
                        { id: 'tiers', label: 'Client Tiers', icon: Users },
                        { id: 'insights', label: 'Insight Thresholds', icon: Lightbulb },
                        { id: 'data', label: 'Data Management', icon: Database },
                    ].map(tab => (
                        <button 
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all ${activeTab === tab.id ? 'bg-zinc-900 text-white shadow-sm border border-zinc-800' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50 transparent border border-transparent'}`}
                        >
                            <tab.icon className={`h-4 w-4 ${activeTab === tab.id ? 'text-blue-500' : 'opacity-50'}`} />
                            {tab.label}
                        </button>
                    ))}
                </div>
                {/* Right Side Content Area */}
                <div className="flex-1 max-w-3xl">
                    {activeTab === 'appearance' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div><h2 className="text-xl font-black text-white">Appearance</h2><p className="text-sm text-zinc-500 mt-1">Customize the visual theme of your workspace.</p></div>
                            <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-8">
                                {/* Base Theme Section */}
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">Base Theme</label>
                                    <div className="flex gap-4 mb-4">
                                        <button onClick={() => updateThemeSettings({ mode: 'dark' })} className={`flex-1 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${themeMode === 'dark' ? 'bg-zinc-800 border-blue-500 text-white shadow-lg' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'}`}>
                                            <Moon className="h-4 w-4"/> <span className="text-xs font-bold uppercase tracking-widest">Dark</span>
                                        </button>
                                        <button onClick={() => updateThemeSettings({ mode: 'light' })} className={`flex-1 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${themeMode === 'light' ? 'bg-zinc-800 border-blue-500 text-white shadow-lg' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'}`}>
                                            <Sun className="h-4 w-4"/> <span className="text-xs font-bold uppercase tracking-widest">Light</span>
                                        </button>
                                        <button onClick={() => updateThemeSettings({ mode: 'custom' })} className={`flex-1 py-3 rounded-xl border flex items-center justify-center gap-2 transition-all ${themeMode === 'custom' ? 'bg-zinc-800 border-blue-500 text-white shadow-lg' : 'border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900/50'}`}>
                                            <Image className="h-4 w-4"/> <span className="text-xs font-bold uppercase tracking-widest">Custom</span>
                                        </button>
                                    </div>
                                    
                                    {themeMode !== 'custom' && (
                                        <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800">
                                            {['zinc', 'slate', themeMode === 'dark' ? 'forest' : 'soft'].map(flavor => (
                                                <button 
                                                    key={flavor}
                                                    onClick={() => updateThemeSettings({ flavor })}
                                                    className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${themeFlavor === flavor ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    {flavor}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Accent Color Section */}
                                <div>
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-4">Accent Color</label>
                                    <div className="flex gap-4">
                                        {['blue', 'purple', 'emerald', 'rose', 'amber'].map(color => (
                                            <button 
                                                key={color}
                                                onClick={() => updateThemeSettings({ accent: color })}
                                                className={`h-10 w-10 rounded-full border-2 flex items-center justify-center transition-all ${accentColor === color ? 'border-white scale-110 shadow-lg' : 'border-transparent hover:scale-105'}`}
                                                style={{ backgroundColor: { blue: '#3b82f6', purple: '#a855f7', emerald: '#10b981', rose: '#f43f5e', amber: '#f59e0b' }[color] }}
                                            >
                                                {accentColor === color && <Check className="h-5 w-5 text-white drop-shadow-md" />}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Drag & Drop Zone */}
                                {themeMode === 'custom' && (
                                    <div className="space-y-8 animate-in fade-in slide-in-from-top-2 duration-300">
                                        <div 
                                            onDragOver={(e) => { e.preventDefault(); setIsDraggingBg(true); }}
                                            onDragLeave={() => setIsDraggingBg(false)}
                                            onDrop={(e) => { e.preventDefault(); setIsDraggingBg(false); handleBgUpload(e); }}
                                            className={`relative border-2 border-dashed rounded-3xl p-10 flex flex-col items-center justify-center transition-all duration-300 ${isDraggingBg ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-zinc-800 bg-zinc-950/30 hover:border-zinc-700'}`}
                                        >
                                            {pendingBg ? (
                                                <div className="flex flex-col items-center gap-6 w-full max-w-md animate-in zoom-in-95 duration-300">
                                                    <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-zinc-700 shadow-2xl">
                                                        <img src={pendingBg} alt="Pending" className="w-full h-full object-cover" />
                                                        {isUploading && (
                                                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                                                                <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
                                                            </div>
                                                        )}
                                                    </div>
                                                    <div className="flex gap-3 w-full">
                                                        <button 
                                                            disabled={isUploading}
                                                            onClick={() => handleCommitPending('active')}
                                                            className="flex-1 bg-white text-black h-11 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-200 transition-all disabled:opacity-50"
                                                        >
                                                            Set as Active
                                                        </button>
                                                        <button 
                                                            disabled={isUploading}
                                                            onClick={() => handleCommitPending('library')}
                                                            className="flex-1 bg-zinc-800 text-white h-11 rounded-xl text-xs font-black uppercase tracking-widest hover:bg-zinc-700 transition-all border border-zinc-700 disabled:opacity-50"
                                                        >
                                                            Save to Library
                                                        </button>
                                                        <button 
                                                            disabled={isUploading}
                                                            onClick={() => setPendingBg(null)}
                                                            className="h-11 w-11 flex items-center justify-center bg-zinc-900 text-zinc-500 rounded-xl hover:text-red-400 transition-all border border-zinc-800"
                                                        >
                                                            <X className="h-5 w-5" />
                                                        </button>
                                                    </div>
                                                </div>
                                            ) : customBg ? (
                                                <div className="flex flex-col items-center gap-6 animate-in fade-in duration-500">
                                                    <div className="relative group">
                                                        <img src={customBg} alt="Current" className="h-40 w-72 object-cover rounded-2xl border border-zinc-700 shadow-2xl transition-transform duration-500 group-hover:scale-[1.02]" referrerPolicy="no-referrer" />
                                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl flex items-center justify-center gap-2">
                                                            <label className="p-3 bg-white text-black rounded-full cursor-pointer hover:bg-zinc-200 transition-all shadow-xl">
                                                                <Upload className="h-5 w-5" />
                                                                <input type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                                                            </label>
                                                            <button onClick={clearBg} className="p-3 bg-red-500 text-white rounded-full hover:bg-red-600 transition-all shadow-xl">
                                                                <Trash2 className="h-5 w-5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="text-center">
                                                        <p className="text-sm font-bold text-white">Active Background</p>
                                                        <p className="text-[10px] text-zinc-500 uppercase font-black tracking-widest mt-1">Hover to change or remove</p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="text-center animate-in fade-in zoom-in-95 duration-300">
                                                    <div className="h-16 w-16 bg-zinc-900 rounded-2xl flex items-center justify-center text-zinc-600 mb-4 mx-auto border border-zinc-800">
                                                        <Upload className={`h-8 w-8 ${isDraggingBg ? 'text-blue-500 animate-bounce' : ''}`} />
                                                    </div>
                                                    <p className="text-base font-black text-white tracking-tight">Drop your masterpiece here</p>
                                                    <p className="text-xs text-zinc-500 mt-1 mb-6 font-medium">High resolution images work best (JPG, PNG, WebP)</p>
                                                    <label className="inline-flex items-center gap-2 bg-white text-black px-8 py-3 text-xs font-black uppercase tracking-widest rounded-xl cursor-pointer hover:bg-zinc-200 transition-all shadow-xl active:scale-95">
                                                        <Search className="h-4 w-4" /> Browse Files 
                                                        <input type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
                                                    </label>
                                                </div>
                                            )}
                                        </div>

                                        {/* Background Library Grid */}
                                        <div className="space-y-6">
                                            <div className="flex items-center justify-between">
                                                <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 flex items-center gap-2">
                                                    <Layers className="h-3 w-3" /> Background Library
                                                </label>
                                                {bgLibrary && bgLibrary.length > 0 && (
                                                    <span className="text-[10px] font-black text-zinc-600 uppercase tracking-widest bg-zinc-900 px-2 py-1 rounded-md border border-zinc-800">
                                                        {bgLibrary.length} Saved
                                                    </span>
                                                )}
                                            </div>

                                            {bgLibrary && bgLibrary.length > 0 ? (
                                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                                                    {bgLibrary.map((item) => (
                                                        <div 
                                                            key={item.id} 
                                                            className={`group relative aspect-video rounded-2xl border-2 overflow-hidden cursor-pointer transition-all duration-300 ${customBg === item.url ? 'border-blue-500 shadow-[0_0_20px_rgba(59,130,246,0.3)]' : 'border-zinc-800 hover:border-zinc-600'}`}
                                                        >
                                                            <img src={item.url} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110" referrerPolicy="no-referrer" />
                                                            
                                                            {/* Minimalist Overlay */}
                                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-all duration-300 flex items-center justify-center gap-3 backdrop-blur-[2px]">
                                                                <Tooltip text="Set as active">
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); onSelectFromLibrary(item.url); }}
                                                                        className={`p-2.5 rounded-xl transition-all shadow-xl ${customBg === item.url ? 'bg-blue-500 text-white scale-110' : 'bg-white text-black hover:bg-zinc-200'}`}
                                                                    >
                                                                        <Check className="h-4 w-4" />
                                                                    </button>
                                                                </Tooltip>
                                                                <Tooltip text="Delete from library">
                                                                    <button 
                                                                        onClick={(e) => { e.stopPropagation(); onDeleteFromLibrary(item.id); }}
                                                                        className="p-2.5 bg-zinc-900 text-zinc-400 rounded-xl hover:bg-red-500 hover:text-white transition-all shadow-xl border border-zinc-800"
                                                                    >
                                                                        <Trash2 className="h-4 w-4" />
                                                                    </button>
                                                                </Tooltip>
                                                            </div>

                                                            {customBg === item.url && (
                                                                <div className="absolute top-3 right-3 bg-blue-500 text-white p-1.5 rounded-lg shadow-lg animate-in zoom-in-50 duration-300">
                                                                    <Check className="h-3 w-3" />
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="h-32 rounded-2xl border border-zinc-800 border-dashed flex flex-col items-center justify-center gap-2 bg-zinc-950/20">
                                                    <Sparkles className="h-5 w-5 text-zinc-700" />
                                                    <p className="text-xs font-bold text-zinc-600 uppercase tracking-widest">No saved backgrounds yet.</p>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {activeTab === 'profile' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex items-center justify-between">
                                <div><h2 className="text-xl font-black text-white">Profile & Security</h2><p className="text-sm text-zinc-500 mt-1">Manage your professional identity and account access.</p></div>
                                <Button 
                                    variant="primary" 
                                    onClick={handleSave} 
                                    disabled={!hasProfileChanges && saveText === "Save Settings"}
                                    className={`rounded-xl py-2 px-6 text-xs transition-all ${!hasProfileChanges && saveText === "Save Settings" ? 'opacity-50 cursor-not-allowed grayscale' : ''}`}
                                >
                                    {saveText === "Saved!" ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />} {saveText}
                                </Button>
                            </div>

                            <div className="grid grid-cols-1 gap-6">
                                {/* Advisor Profile Card */}
                                <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-6">
                                    <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
                                        <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500"><Briefcase className="h-5 w-5" /></div>
                                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Advisor Profile</h3>
                                    </div>
                                    
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Full Name</label>
                                            <input 
                                                type="text" 
                                                value={userProfile.fullName}
                                                onChange={(e) => setUserProfile({...userProfile, fullName: e.target.value})}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                                                placeholder="e.g. Jonathan Smith"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Firm Name</label>
                                            <input 
                                                type="text" 
                                                value={userProfile.firmName}
                                                onChange={(e) => setUserProfile({...userProfile, firmName: e.target.value})}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                                                placeholder="e.g. Smith Capital Management"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">CRD / NPN Number</label>
                                            <input 
                                                type="text" 
                                                value={userProfile.crdNumber}
                                                onChange={(e) => setUserProfile({...userProfile, crdNumber: e.target.value})}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                                placeholder="e.g. 1234567"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Phone Number</label>
                                            <input 
                                                type="tel" 
                                                value={userProfile.phone}
                                                onChange={(e) => setUserProfile({...userProfile, phone: e.target.value})}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                                                placeholder="e.g. +1 (555) 000-0000"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Account Security Card */}
                                <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-6">
                                    <div className="flex items-center gap-3 border-b border-zinc-800 pb-4">
                                        <div className="p-2 bg-emerald-500/10 rounded-lg text-emerald-500"><ShieldCheck className="h-5 w-5" /></div>
                                        <h3 className="text-sm font-black text-white uppercase tracking-widest">Account Security</h3>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Login Email</label>
                                            <input 
                                                type="email" 
                                                value={userProfile.email}
                                                onChange={(e) => setUserProfile({...userProfile, email: e.target.value})}
                                                onFocus={(e) => e.target.select()}
                                                className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors"
                                                placeholder="name@firm.com"
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Password</label>
                                            <div className="relative">
                                                <input 
                                                    type={showPassword ? "text" : "password"}
                                                    value={userProfile.password}
                                                    readOnly
                                                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:border-blue-500 transition-colors pr-10 cursor-not-allowed opacity-70"
                                                    placeholder="••••••••••••"
                                                />
                                                <button 
                                                    onClick={() => setShowPassword(!showPassword)}
                                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                                                >
                                                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                                                </button>
                                            </div>
                                            <button 
                                                onClick={() => setIsPasswordModalOpen(true)}
                                                className="text-[10px] font-bold text-blue-500 hover:text-blue-400 uppercase tracking-wider mt-1"
                                            >
                                                Update Password
                                            </button>
                                        </div>
                                        
                                        <div className="md:col-span-2 pt-2 border-t border-zinc-800/50 flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-bold text-white">Two-Factor Authentication</div>
                                                <div className="text-xs text-zinc-500 mt-0.5">Secure your account with 2FA</div>
                                            </div>
                                            <button 
                                                onClick={() => setUserProfile({...userProfile, twoFactorEnabled: !userProfile.twoFactorEnabled})}
                                                className={`relative w-11 h-6 rounded-full transition-colors duration-200 ease-in-out focus:outline-none flex items-center ${userProfile.twoFactorEnabled ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                                            >
                                                <span className={`inline-block w-4 h-4 transform rounded-full bg-white shadow-sm transition duration-200 ease-in-out ${userProfile.twoFactorEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'apis' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex items-center justify-between">
                                <div><h2 className="text-xl font-black text-white">API Integrations</h2><p className="text-sm text-zinc-500 mt-1">Manage secure keys for live market data and AI engines.</p></div>
                                <Button variant="primary" onClick={handleSave} className="rounded-xl py-2 px-6 text-xs">{saveText === "Saved!" ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />} {saveText}</Button>
                            </div>
                            
                            <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-8">
                                <ApiKeyManager label="Finnhub (Real-Time Quotes)" placeholder="sk_..." keys={finnhubKeys} onChange={setFinnhubKeys} />
                                <div className="border-t border-zinc-800 pt-8">
                                    <ApiKeyManager label="Tiingo (Historical Backtesting)" placeholder="sk_..." keys={tiingoKeys} onChange={setTiingoKeys} />
                                </div>
                                <div className="border-t border-zinc-800 pt-8">
                                    <ApiKeyManager label="Google Gemini (AI Engine)" placeholder="AIza..." keys={geminiKeys} onChange={setGeminiKeys} />
                                </div>
                                <div className="border-t border-zinc-800 pt-8">
                                    <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Logo.dev (Asset Imagery)</label>
                                    <input type="password" className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-xs font-mono focus:outline-none focus:border-blue-500 transition-colors" value={logoDev} onChange={e => setLogoDev(e.target.value)} placeholder="Default public key used if empty" />
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'tiers' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex items-center justify-between">
                                <div><h2 className="text-xl font-black text-white">Client Tiers</h2><p className="text-sm text-zinc-500 mt-1">Configure segmentation thresholds for your book of business.</p></div>
                                <Button variant="primary" onClick={handleSave} className="rounded-xl py-2 px-6 text-xs">{saveText === "Saved!" ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />} {saveText}</Button>
                            </div>

                            <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-8">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <label className="block text-sm font-bold text-white">Segmentation Mode</label>
                                        <p className="text-xs text-zinc-500 mt-1">Switch between relative percentile rankings or absolute dollar values.</p>
                                    </div>
                                    <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800">
                                        <button 
                                            onClick={() => setTierSettings({ ...tierSettings, mode: 'relative' })}
                                            className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${tierSettings.mode === 'relative' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            Relative
                                        </button>
                                        <button 
                                            onClick={() => setTierSettings({ ...tierSettings, mode: 'absolute' })}
                                            className={`px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${tierSettings.mode === 'absolute' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            Absolute
                                        </button>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-6">
                                    {['A', 'B', 'C', 'D'].map(tier => (
                                        <div key={tier} className="space-y-2">
                                            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">
                                                Tier {tier} {tierSettings.mode === 'relative' ? '(Top % of AUM)' : '(Minimum $ Value)'}
                                            </label>
                                            <div className="relative">
                                                <input 
                                                    type="number" 
                                                    className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl px-4 py-3 text-white text-sm font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                                    value={tierSettings.thresholds[tier]}
                                                    onChange={(e) => setTierSettings({
                                                        ...tierSettings,
                                                        thresholds: { ...tierSettings.thresholds, [tier]: parseFloat(e.target.value) || 0 }
                                                    })}
                                                />
                                                <div className="absolute right-4 top-1/2 -translate-y-1/2 text-zinc-600 font-bold text-xs">
                                                    {tierSettings.mode === 'relative' ? '%' : '$'}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                <div className="bg-blue-500/5 border border-blue-500/10 rounded-xl p-4 flex items-start gap-3">
                                    <Info className="h-4 w-4 text-blue-500 mt-0.5" />
                                    <p className="text-xs text-zinc-400 leading-relaxed">
                                        <span className="text-blue-400 font-bold">Note:</span> F-Tier applies to any client below the D-Tier threshold. Tiering is calculated based on total household AUM across all linked accounts.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'insights' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div><h2 className="text-xl font-black text-white">Insight Thresholds</h2><p className="text-sm text-zinc-500 mt-1">Configure global alerts and detection sensitivity.</p></div>
                            <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-8">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Excess Cash Alert (%)</label>
                                        <input 
                                            type="number" 
                                            step="0.1"
                                            value={insightThresholds.excessCashThreshold} 
                                            onChange={(e) => setInsightThresholds({ ...insightThresholds, excessCashThreshold: parseFloat(e.target.value) })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">FCASH Exposure (%)</label>
                                        <input 
                                            type="number" 
                                            value={insightThresholds.fcashExposure} 
                                            onChange={(e) => setInsightThresholds({ ...insightThresholds, fcashExposure: parseFloat(e.target.value) })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Tax Loss Opportunity ($)</label>
                                        <input 
                                            type="number" 
                                            value={insightThresholds.taxLossOpportunity} 
                                            onChange={(e) => setInsightThresholds({ ...insightThresholds, taxLossOpportunity: parseFloat(e.target.value) })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Concentration Risk (%)</label>
                                        <input 
                                            type="number" 
                                            value={insightThresholds.concentrationRisk} 
                                            onChange={(e) => setInsightThresholds({ ...insightThresholds, concentrationRisk: parseFloat(e.target.value) })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Stale Portfolio (Days)</label>
                                        <input 
                                            type="number" 
                                            value={insightThresholds.stalePortfolioDays} 
                                            onChange={(e) => setInsightThresholds({ ...insightThresholds, stalePortfolioDays: parseFloat(e.target.value) })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Bond Maturity (Days)</label>
                                        <input 
                                            type="number" 
                                            value={insightThresholds.bondMaturityDays} 
                                            onChange={(e) => setInsightThresholds({ ...insightThresholds, bondMaturityDays: parseFloat(e.target.value) })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Insufficient Cash (%)</label>
                                        <input 
                                            type="number" 
                                            step="0.01"
                                            value={insightThresholds.insufficientCash} 
                                            onChange={(e) => setInsightThresholds({ ...insightThresholds, insufficientCash: parseFloat(e.target.value) })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white font-mono focus:outline-none focus:border-blue-500 transition-colors"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {activeTab === 'data' && (
                        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
                            <div className="flex items-center justify-between">
                                <div><h2 className="text-xl font-black text-white">Data Management</h2><p className="text-sm text-zinc-500 mt-1">Bulk import clients and portfolios.</p></div>
                                <Button variant="primary" onClick={handleSave} className="rounded-xl py-2 px-6 text-xs">{saveText === "Saved!" || saveText === "Import Successful!" ? <Check className="h-4 w-4 mr-2" /> : <Save className="h-4 w-4 mr-2" />} {saveText}</Button>
                            </div>
                            <div className="bg-zinc-900/40 backdrop-blur-md border border-zinc-800 rounded-2xl p-6 space-y-8">
                                <div 
                                  onDragOver={handleDragOver}
                                  onDragLeave={handleDragLeave}
                                  onDrop={handleDrop}
                                  className={`relative border-2 border-dashed rounded-3xl p-12 transition-all ${
                                    isDragging ? 'border-blue-500 bg-blue-500/10 scale-[1.02]' : 'border-zinc-800 bg-zinc-900/30'
                                  }`}
                                >
                                  <div className="flex flex-col items-center text-center">
                                    <div className={`h-20 w-20 rounded-full flex items-center justify-center mb-6 transition-colors ${
                                      isDragging ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-500'
                                    }`}>
                                      <Upload className="h-10 w-10" />
                                    </div>
                                    <h3 className="text-xl font-black text-white tracking-tight">Mass CSV Import</h3>
                                    <p className="text-zinc-500 max-w-xs mt-2 mb-8">Drag and drop your Fidelity Mass Export CSV here, or use the button below.</p>
                                    <label className="cursor-pointer bg-zinc-800 hover:bg-zinc-700 text-white px-8 py-3 rounded-xl font-bold transition-all">
                                      Browse Files
                                      <input type="file" accept=".csv" className="hidden" onChange={handleMassImport} />
                                    </label>
                                  </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

const ApiUsageModal = ({ onClose }) => {
  const [usage, setUsage] = useState({});
  useEffect(() => {
    const raw = JSON.parse(localStorage.getItem('tiingo_usage_log') || '{}');
    const now = Date.now();
    const stats = {};
    getTiingoKeys().forEach((key, idx) => {
        const timestamps = raw[key] || [];
        stats[key] = { hourly: timestamps.filter(t => now - t < 3600000).length, daily: timestamps.filter(t => now - t < 86400000).length };
    });
    setUsage(stats);
  }, []);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-4xl w-full shadow-2xl relative">
            <button onClick={onClose} className="absolute top-6 right-6 text-zinc-500 hover:text-white"><X className="h-6 w-6" /></button>
            <div className="mb-8 border-b border-zinc-800 pb-4"><h3 className="text-2xl font-black text-white tracking-tighter mb-1 flex items-center gap-2"><Activity className="h-6 w-6 text-blue-500" /> API Health Monitor</h3><p className="text-zinc-500 text-sm font-medium">Real-time quota tracking based on local session data.</p></div>
             <div className="grid grid-cols-5 gap-4">
                {getTiingoKeys().map((key, idx) => {
                    const stat = usage[key] || { hourly: 0, daily: 0 };
                    return (
                        <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 flex flex-col items-center">
                            <Gauge value={stat.hourly} max={50} label={`Key ${idx + 1}`} subLabel="Hourly Limit" />
                            <div className="mt-4 w-full bg-zinc-900 rounded-lg p-2 flex justify-between items-center text-[10px]"><span className="text-zinc-500 font-bold">24H</span><span className="text-zinc-300 font-mono">{stat.daily} / 1000</span></div>
                        </div>
                    );
                })}
            </div>
        </div>
    </div>
  );
};

const SettingsModal = ({ layout, onUpdateLayout, hiddenBuckets = [], onToggleBucket, onClose, bucketOrder: initialBucketOrder = ['equity', 'fixedIncome', 'coveredCall', 'cash'], globalCustomView, onUpdateGlobalCustomView, activeViewType, defaultViewType, setDefaultViewType, setHasUnsavedCustomChanges }) => {
    const [activeTab, setActiveTab] = useState('columns');
    const [draggedColIdx, setDraggedColIdx] = useState(null);
    const [bucketOrder, setBucketOrder] = useState(initialBucketOrder);
    const [draggedBucketIdx, setDraggedBucketIdx] = useState(null);
    const [showSuccessToast, setShowSuccessToast] = useState(false);

    const handleSaveCustomView = () => {
        onUpdateGlobalCustomView({
            ...globalCustomView,
            columns: layout
        });
        if (setHasUnsavedCustomChanges) {
            setHasUnsavedCustomChanges(false);
        }
        triggerSuccessToast();
    };

    const handleSetGlobalDefault = () => {
        if (setDefaultViewType && activeViewType) {
            setDefaultViewType(activeViewType);
            triggerSuccessToast();
        }
    };

    const triggerSuccessToast = () => {
        setShowSuccessToast(true);
        setTimeout(() => setShowSuccessToast(false), 2000);
    };

    const toggleCol = (id) => {
        const next = layout.map(col => col.id === id ? { ...col, visible: !col.visible } : col);
        onUpdateLayout(next);
    };

    const onDragStart = (e, index) => {
        setDraggedColIdx(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index);
    };

    const onDragOver = (e, index) => {
        e.preventDefault();
    };

    const onDrop = (e, index) => {
        e.preventDefault();
        if (draggedColIdx === null || draggedColIdx === index) return;
        
        const next = [...layout];
        const [moved] = next.splice(draggedColIdx, 1);
        next.splice(index, 0, moved);
        onUpdateLayout(next);
        setDraggedColIdx(null);
    };

    const onDragStartBucket = (e, index) => {
        setDraggedBucketIdx(index);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", index);
    };

    const onDragOverBucket = (e, index) => {
        e.preventDefault();
    };

    const onDropBucket = (e, index) => {
        e.preventDefault();
        if (draggedBucketIdx === null || draggedBucketIdx === index) return;
        
        const next = [...bucketOrder];
        const [moved] = next.splice(draggedBucketIdx, 1);
        next.splice(index, 0, moved);
        setBucketOrder(next);
        setDraggedBucketIdx(null);
    };

    const handleClose = () => {
        onClose(bucketOrder);
    };

    const buckets = [
        { id: 'equity', label: 'Equities' },
        { id: 'fixedIncome', label: 'Bonds' },
        { id: 'coveredCall', label: 'Covered Calls' },
        { id: 'cash', label: 'Cash' },
    ];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-md w-full shadow-2xl relative">
                <button onClick={handleClose} className="absolute top-6 right-6 text-zinc-500 hover:text-white"><X className="h-6 w-6" /></button>
                <div className="mb-6">
                    <h3 className="text-xl font-black text-white flex items-center gap-2 tracking-tight">
                        <Settings className="h-5 w-5 text-blue-500"/> Dashboard Settings
                    </h3>
                </div>
                
                <div className="flex p-1 bg-zinc-950 border border-zinc-800 rounded-xl mb-6">
                     <button 
                        onClick={() => setActiveTab('columns')} 
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === 'columns' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                     >
                         Columns
                     </button>
                     <button 
                        onClick={() => setActiveTab('assets')} 
                        className={`flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === 'assets' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                     >
                         Portfolio Targets
                     </button>
                </div>

                <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-2 custom-scrollbar">
                    {activeTab === 'columns' ? (
                        <>
                            {/* Custom View Configuration */}
                            <div className="mb-6 space-y-4">
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Custom View Configuration</h4>
                                </div>
                                
                                <div className="space-y-4 bg-zinc-950 border border-zinc-800 rounded-xl p-4">
                                    {/* Rename */}
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">View Name</label>
                                        <input 
                                            type="text"
                                            value={globalCustomView?.name || ''}
                                            onChange={(e) => onUpdateGlobalCustomView({ ...globalCustomView, name: e.target.value })}
                                            onFocus={(e) => e.target.select()}
                                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm font-bold text-white focus:outline-none focus:border-blue-500 transition-all"
                                            placeholder="Enter view name..."
                                        />
                                    </div>

                                    <div className="grid grid-cols-2 gap-4">
                                        {/* Framework */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Framework</label>
                                            <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1">
                                                <button 
                                                    onClick={() => onUpdateGlobalCustomView({ ...globalCustomView, framework: 'standard' })}
                                                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${globalCustomView?.framework === 'standard' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    List
                                                </button>
                                                <button 
                                                    onClick={() => onUpdateGlobalCustomView({ ...globalCustomView, framework: 'modular' })}
                                                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${globalCustomView?.framework === 'modular' ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    Modular
                                                </button>
                                            </div>
                                        </div>

                                        {/* Density */}
                                        <div className="space-y-1.5">
                                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500 ml-1">Density</label>
                                            <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1">
                                                <button 
                                                    onClick={() => onUpdateGlobalCustomView({ ...globalCustomView, isCompact: false })}
                                                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${!globalCustomView?.isCompact ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    Std
                                                </button>
                                                <button 
                                                    onClick={() => onUpdateGlobalCustomView({ ...globalCustomView, isCompact: true })}
                                                    className={`flex-1 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-md transition-all ${globalCustomView?.isCompact ? 'bg-zinc-800 text-white shadow' : 'text-zinc-500 hover:text-zinc-300'}`}
                                                >
                                                    Compact
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="text-zinc-500 text-xs font-medium mb-3 px-1">Drag to reorder. Toggle visibility.</div>
                            {layout.map((col, idx) => (
                                <div 
                                    key={col.id} 
                                    draggable
                                    onDragStart={(e) => onDragStart(e, idx)}
                                    onDragOver={(e) => onDragOver(e, idx)}
                                    onDrop={(e) => onDrop(e, idx)}
                                    className={`flex items-center gap-2 w-full p-2 rounded-xl border transition-all cursor-move ${col.visible ? 'bg-zinc-950 border-zinc-800/50' : 'bg-zinc-950/50 border-zinc-800 opacity-60'} ${draggedColIdx === idx ? 'opacity-50 border-blue-500/50' : ''}`}
                                >
                                    <div className="text-zinc-600 p-2">
                                        <GripVertical className="h-4 w-4" />
                                    </div>
                                    <button 
                                        onClick={() => toggleCol(col.id)}
                                        className="flex-1 flex items-center justify-between px-3 py-2 text-left"
                                    >
                                        <span className={`font-bold text-sm ${col.visible ? 'text-zinc-100' : 'text-zinc-500'}`}>{col.label}</span>
                                        {col.visible ? <Check className="h-4 w-4 text-blue-400" /> : <div className="h-4 w-4 rounded-full border border-zinc-700" />}
                                    </button>
                                </div>
                            ))}
                        </>
                    ) : (
                        <>
                            <div className="text-zinc-500 text-xs font-medium mb-3 px-1">Drag to reorder. Hide unused asset categories from the target allocator.</div>
                            {bucketOrder.map((bucketId, idx) => {
                                const bucket = buckets.find(b => b.id === bucketId);
                                if (!bucket) return null;
                                const isHidden = hiddenBuckets.includes(bucket.id);
                                return (
                                    <div
                                        key={bucket.id}
                                        draggable
                                        onDragStart={(e) => onDragStartBucket(e, idx)}
                                        onDragOver={(e) => onDragOverBucket(e, idx)}
                                        onDrop={(e) => onDropBucket(e, idx)}
                                        className={`flex items-center gap-2 w-full p-2 rounded-xl border transition-all cursor-move ${!isHidden ? 'bg-zinc-950 border-zinc-800/50' : 'bg-zinc-950/50 border-zinc-800 opacity-60'} ${draggedBucketIdx === idx ? 'opacity-50 border-blue-500/50' : ''}`}
                                    >
                                        <div className="text-zinc-600 p-2">
                                            <GripVertical className="h-4 w-4" />
                                        </div>
                                        <button
                                            onClick={() => onToggleBucket(bucket.id)}
                                            className="flex-1 flex items-center justify-between px-3 py-2 text-left"
                                        >
                                            <div className="flex items-center gap-3">
                                                {!isHidden ? <Eye className="h-4 w-4 text-blue-500" /> : <EyeOff className="h-4 w-4 text-zinc-600" />}
                                                <span className={`font-bold text-sm ${!isHidden ? 'text-zinc-100' : 'text-zinc-500'}`}>{bucket.label}</span>
                                            </div>
                                            {!isHidden && <Check className="h-4 w-4 text-blue-400" />}
                                        </button>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </div>
                <div className="mt-6 space-y-3">
                    {showSuccessToast && (
                        <div className="text-center text-emerald-400 text-xs font-bold uppercase tracking-widest animate-pulse">
                            Settings Saved!
                        </div>
                    )}
                    <div className="flex gap-3">
                        <Button 
                            variant="primary" 
                            onClick={handleSaveCustomView} 
                            className="flex-1 rounded-xl py-3 h-12 flex items-center justify-center gap-2"
                        >
                            <Save className="h-4 w-4" />
                            <span className="text-xs">Save Custom View</span>
                        </Button>
                        <Button 
                            variant="secondary" 
                            onClick={handleSetGlobalDefault} 
                            className="flex-1 rounded-xl py-3 h-12 flex items-center justify-center gap-2"
                        >
                            <Star className="h-4 w-4" />
                            <span className="text-xs">Set as Global Default</span>
                        </Button>
                    </div>
                    <Button variant="secondary" onClick={handleClose} className="w-full rounded-xl py-3 h-12">Close</Button>
                </div>
            </div>
        </div>
    );
};

const InsightsHub = ({ positions }) => {
  const [activeTab, setActiveTab] = useState('news');
  const [insights, setInsights] = useState({ news: null, earnings: [], analysts: {} });
  const [loading, setLoading] = useState(false);
  const [hasFetched, setHasFetched] = useState(false);

  const nonCashSymbols = useMemo(() => {
      if (!positions) return [];
      return positions.filter(p => !CASH_TICKERS.some(t => p.symbol.includes(t))).map(p => p.symbol);
  }, [positions]);

  const fetchData = async () => {
    if (nonCashSymbols.length === 0 || loading) return;
    setLoading(true);
    try {
      const nowStr = new Date().toISOString().split('T')[0];
      
      // Earnings Calendar
      let calData = { earningsCalendar: [] };
      try {
          const calRes = await fetchFinnhub(`calendar/earnings?from=${nowStr}&to=${new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0]}`);
          calData = await calRes || { earningsCalendar: [] };
      } catch (e) { console.warn("Earnings fetch failed", e); }

      // News
      let newsSummary = "";
      try {
          const newsResults = await Promise.all(nonCashSymbols.slice(0, 3).map(s => 
              fetchFinnhub(`company-news?symbol=${s}&from=${nowStr}&to=${nowStr}`)
                  .then(res => Array.isArray(res) ? res : [])
                  .catch(() => [])
          ));
          newsSummary = newsResults.flat().slice(0, 10).map(n => `[${n.related}] ${n.headline}`).join('\n');
      } catch (e) { console.warn("News fetch failed", e); }

      // Gemini Analysis
      let aiResponse = "No significant updates.";
      if (newsSummary) {
          try {
            aiResponse = await callGemini(`Briefly summarize this news:\n${newsSummary}`, "Senior Financial Analyst. Concise bullet points.", false);
          } catch (e) { console.error("Gemini error", e); aiResponse = "AI Analysis unavailable."; }
      }

      // Analyst Ratings
      const analysts = {};
      try {
          for (const s of nonCashSymbols.slice(0, 8)) {
            const r = await fetchFinnhub(`stock/recommendation?symbol=${s}`).catch(() => []);
            if (r && r[0]) analysts[s] = r[0];
          }
      } catch (e) { console.warn("Analyst fetch failed", e); }

      setInsights({ news: aiResponse, earnings: calData.earningsCalendar || [], analysts });
      setHasFetched(true);
    } catch (e) { console.error("InsightsHub error", e); } finally { setLoading(false); }
  };

  return (
    <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl mb-8 overflow-hidden">
      <div className="flex border-b border-zinc-800 bg-zinc-900/50 justify-between items-center pr-4">
        <div className="flex">
            {[ {id:'news', icon: Newspaper, label:'News'}, {id:'earnings', icon: Calendar, label:'Earnings'}, {id:'analysts', icon: TrendingUp, label:'Analysts'} ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`flex items-center gap-2 px-6 py-4 text-xs font-black uppercase tracking-widest transition-all ${activeTab === t.id ? 'bg-zinc-950 text-blue-400 border-b-2 border-blue-500' : 'text-zinc-500 hover:text-zinc-300'}`}>
                <t.icon className="h-3.5 w-3.5" />{t.label}
            </button>
            ))}
        </div>
        <button onClick={fetchData} disabled={loading} className="flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white disabled:opacity-50">
            {hasFetched ? <RotateCcw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} /> : <Sparkles className={`h-3 w-3 text-blue-500 ${loading ? 'animate-pulse' : ''}`} />}
            {loading ? 'Generating...' : (hasFetched ? 'Refresh' : 'Generate Insights')}
        </button>
      </div>
      <div className="p-8 min-h-[160px]">
        {loading ? <div className="h-24 flex items-center justify-center gap-3 text-zinc-500"><Loader2 className="h-5 w-5 animate-spin" /><span className="text-[10px] font-black uppercase tracking-widest">Loading Intelligence...</span></div> : (
          <div className="animate-in fade-in slide-in-from-bottom-2">
            {activeTab === 'news' && <div className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap">{insights.news || "No significant updates."}</div>}
            {activeTab === 'earnings' && <div className="grid grid-cols-4 gap-4">{insights.earnings.filter(e => nonCashSymbols.includes(e.symbol)).map(e => <div key={e.symbol} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800"><div className="font-black text-white">{e.symbol}</div><div className="text-xs text-zinc-500">{e.date}</div></div>)}</div>}
            {activeTab === 'analysts' && <div className="grid grid-cols-4 gap-4">{Object.entries(insights.analysts).map(([s, d]: any) => <div key={s} className="bg-zinc-950 p-4 rounded-xl border border-zinc-800"><div className="font-black text-white">{s}</div><div className="text-[10px] text-zinc-500 mt-1">BUY: {d.buy+d.strongBuy} | HOLD: {d.hold} | SELL: {d.sell}</div></div>)}</div>}
          </div>
        )}
      </div>
    </div>
  );
};

const BacktestModal = ({ model, onClose }) => {
  const [history, setHistory] = useState([]);
  const [benchmark, setBenchmark] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [metrics, setMetrics] = useState({ modelReturn: 0, benchReturn: 0, volatility: 0, sharpe: 0 });
  const [progress, setProgress] = useState("");
  const [usingCache, setUsingCache] = useState(false);
  const [failures, setFailures] = useState([]);
  const [hoverData, setHoverData] = useState(null);
  const [performanceData, setPerformanceData] = useState(null);
  const [tableSort, setTableSort] = useState({ key: 'symbol', direction: 'asc' });

  const formatTablePerf = (val) => { 
    if (val === null || val === undefined) return <span className="text-zinc-600">--</span>; 
    const num = val * 100; 
    return <span className={`font-mono ${num >= 0 ? 'text-green-400' : 'text-red-400'}`}>{num > 0 ? '+' : ''}{num.toFixed(2)}%</span>; 
  };

  const sortedAssets = useMemo(() => {
    if (!performanceData?.assets) return [];
    return [...performanceData.assets].sort((a, b) => {
        const valA = a[tableSort.key];
        const valB = b[tableSort.key];
        
        if (valA === null || valA === undefined) return 1;
        if (valB === null || valB === undefined) return -1;
        
        if (valA < valB) return tableSort.direction === 'asc' ? -1 : 1;
        if (valA > valB) return tableSort.direction === 'asc' ? 1 : -1;
        return 0;
    });
  }, [performanceData, tableSort]);
    
  const dataCache = useRef({});
  const inFlightRequests = useRef(new Map());
  const keyIndex = useRef(0);
    
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState(model.defaultBenchmark || 'SPY');
  const [selectedRange, setSelectedRange] = useState('1Y');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [assetsLoaded, setAssetsLoaded] = useState(false);

  const filterData = (dataSeries, range, customS, customE) => {
    if (!dataSeries || dataSeries.length === 0) return [];
    let cutoffDate = new Date();
    const today = new Date();
    if (range === 'Custom' && customS) { 
        cutoffDate = new Date(customS);
    } else {
        switch (range) {
            case '1M': cutoffDate.setMonth(today.getMonth() - 1); break;
            case '3M': cutoffDate.setMonth(today.getMonth() - 3); break;
            case '6M': cutoffDate.setMonth(today.getMonth() - 6); break;
            case 'YTD': cutoffDate = new Date(today.getFullYear(), 0, 1); break;
            case '1Y': cutoffDate.setFullYear(today.getFullYear() - 1); break;
            case '3Y': cutoffDate.setFullYear(today.getFullYear() - 3); break;
            case '5Y': cutoffDate.setFullYear(today.getFullYear() - 5); break;
            default: cutoffDate.setFullYear(today.getFullYear() - 1);
        }
    }

    let filtered = dataSeries.filter(d => d.date >= cutoffDate);
    if (range === 'Custom' && customE) { 
        filtered = filtered.filter(d => d.date <= new Date(customE));
    }
    if (filtered.length > 0) {
        const startVal = filtered[0].value;
        filtered = filtered.map(d => ({ ...d, value: d.value / startVal }));
    }
    return filtered;
  };

  const calcMetrics = (modelSeries, benchSeries) => {
    if (!modelSeries || modelSeries.length < 2) return;
    const totalReturn = (modelSeries[modelSeries.length - 1].value - 1) * 100;
    const benchReturn = benchSeries && benchSeries.length > 0 ? (benchSeries[benchSeries.length - 1].value - 1) * 100 : 0;
    const dailyReturns = modelSeries.map((p, i) => i === 0 ? 0 : (p.value / modelSeries[i-1].value) - 1).slice(1);
    const meanReturn = dailyReturns.reduce((sum, r) => sum + r, 0) / dailyReturns.length;
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / dailyReturns.length;
    const volatility = Math.sqrt(variance) * Math.sqrt(252) * 100;
    setMetrics({ modelReturn: totalReturn, benchReturn, volatility, sharpe: volatility ? totalReturn / volatility : 0 });
  };

  const fetchTiingo = async (symbol, startTimestamp) => {
    const cleanSymbol = symbol.toUpperCase().replace(/[\.\/]/g, '-');
    if (CASH_TICKERS.some(t => cleanSymbol.includes(t)) || cleanSymbol === 'USD') {
        const now = Math.floor(Date.now() / 1000);
        const start = new Date(startTimestamp * 1000).getTime() / 1000;
        const days = Math.ceil((now - start) / 86400);
        const data = { t: Array.from({length: days}, (_, i) => start + (i * 86400)), c: Array.from({length: days}, () => 1.0) };
        dataCache.current[cleanSymbol] = data;
        return data;
    }
    const cacheKey = `tiingo_${cleanSymbol}_5Y`; 
    if (dataCache.current[cleanSymbol]) return dataCache.current[cleanSymbol];
    if (inFlightRequests.current.has(cacheKey)) return inFlightRequests.current.get(cacheKey);
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const parsed = JSON.parse(cached);
            if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
                dataCache.current[cleanSymbol] = parsed.data;
                return parsed.data;
            }
        } catch (e) {}
    }

    const fetchPromise = (async () => {
        let attempts = 0;
        const keys = getTiingoKeys();
        const maxAttempts = keys.length * 2;
        while (attempts < maxAttempts) {
            const currentKey = keys[keyIndex.current % keys.length];
            const startDate = new Date(startTimestamp * 1000).toISOString().split('T')[0];
            const url = `https://api.tiingo.com/tiingo/daily/${cleanSymbol}/prices?startDate=${startDate}&resampleFreq=daily&token=${currentKey}`;
            let jsonResponse = null;
            try {
                try {
                    const res = await fetch(url);
                    if (res.status === 429) throw new Error("429");
                    if (res.ok) jsonResponse = await res.json();
                } catch (e) { if (e.message === "429") throw e; }

                if (!jsonResponse) {
                    try {
                        const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
                        const res = await fetch(proxyUrl);
                        if (res.status === 429) throw new Error("429");
                        if (res.ok) jsonResponse = await res.json();
                    } catch (e) { if (e.message === "429") throw e; }
                }

                if (!jsonResponse) {
                      try {
                        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                        const res = await fetch(proxyUrl);
                        if (res.ok) {
                            const wrapper = await res.json();
                            if (wrapper.contents) {
                                const parsed = JSON.parse(wrapper.contents);
                                if (parsed.detail && parsed.detail.includes("throttle")) throw new Error("429");
                                jsonResponse = parsed;
                            }
                        }
                    } catch (e) { if (e.message === "429") throw e; }
                }

                if (jsonResponse && Array.isArray(jsonResponse) && jsonResponse.length > 0) {
                      const normalized = { t: jsonResponse.map(d => new Date(d.date).getTime() / 1000), c: jsonResponse.map(d => d.adjClose || d.close) };
                      safeSetItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data: normalized }));
                      dataCache.current[cleanSymbol] = normalized;
                      trackApiUsage(currentKey); 
                      return normalized;
                }
                throw new Error("Fetch failed");
            } catch (err) {
                keyIndex.current++;
                attempts++;
                await new Promise(r => setTimeout(r, 1000 + (attempts * 500)));
            }
        }
        throw new Error(`Max retries exceeded for ${cleanSymbol}`);
    })();

    inFlightRequests.current.set(cacheKey, fetchPromise);
    try { return await fetchPromise; } finally { inFlightRequests.current.delete(cacheKey); }
  };

  useEffect(() => {
    const fetchAssets = async () => {
        setLoading(true); setError(null); setFailures([]); setUsingCache(false); setProgress("Initializing 5Y Data...");
        const end = Math.floor(Date.now() / 1000);
        const start = end - (5 * 365 * 24 * 60 * 60); 
        if (getTiingoKeys().length === 0) { setError("No API Key"); setLoading(false); return; }
        try {
             const uniqueTickers = [...new Set(model.allocations.map(a => a.symbol))];
             const batchSize = 5;
             const failed = [];
             let usedCache = false;
             for (let i = 0; i < uniqueTickers.length; i += batchSize) {
                const batch = uniqueTickers.slice(i, i + batchSize);
                setProgress(`Fetching assets...`);
                await Promise.allSettled(batch.map(async (sym: any) => {
                      const cleanSym = sym.toUpperCase().replace(/[\.\/]/g, '-');
                      if (localStorage.getItem(`tiingo_${cleanSym}_5Y`)) usedCache = true;
                      try { await fetchTiingo(sym, start); } catch(e) { failed.push(sym); }
                }));
             }
             if (failed.length === uniqueTickers.length) throw new Error("All assets failed to fetch.");
             if (failed.length > 0) setFailures(failed);
             if (usedCache) setUsingCache(true);
             setAssetsLoaded(true); 
        } catch(e) { setError(e.message); setLoading(false); }
    };
    fetchAssets();
  }, [model]);

  useEffect(() => {
    if (!assetsLoaded) return;
    const buildCharts = async () => {
        setProgress("Building Benchmark...");
        const end = Math.floor(Date.now() / 1000);
        const start = end - (5 * 365 * 24 * 60 * 60); 
        const selectedBench = BENCHMARK_OPTIONS.find(b => b.id === selectedBenchmarkId);
        if (!selectedBench) return;
        const components = Object.keys(selectedBench.components);
        for (const ticker of components) { if (!dataCache.current[ticker]) { try { await fetchTiingo(ticker, start); } catch(e) {} } }
        let masterTicker = 'SPY';
        if (!dataCache.current['SPY']) masterTicker = components[0];
        if (!dataCache.current[masterTicker]) {
              const firstAsset = model.allocations.find(a => dataCache.current[a.symbol.toUpperCase().replace(/[\.\/]/g, '-')]);
              if (firstAsset) masterTicker = firstAsset.symbol.toUpperCase().replace(/[\.\/]/g, '-');
        }
        const masterData = dataCache.current[masterTicker];
        if (!masterData || !masterData.t) { setError("Reference data missing."); setLoading(false); return; }
        
        const fullTimeline = masterData.t;
        const fullBenchSeries = fullTimeline.map((time, idx) => {
            let val = 0; let totalW = 0;
            Object.entries(selectedBench.components).forEach(([sym, w]) => {
                const d = dataCache.current[sym];
                if (d && d.c) {
                    const price = d.c[idx] || d.c[d.c.length-1];
                    const startP = d.c[0];
                    if (price && startP) { val += (price / startP) * w; totalW += w; }
                }
            });
            return { date: new Date(time * 1000), value: totalW > 0 ? val / totalW : 1 };
        });

        const validAllocations = model.allocations.filter(a => dataCache.current[a.symbol.toUpperCase().replace(/[\.\/]/g, '-')]);
        const totalAllocWeight = validAllocations.reduce((sum, a) => sum + a.percent, 0);
        const fullModelSeries = fullTimeline.map((time, idx) => {
             let val = 0;
             validAllocations.forEach(alloc => {
                 const s = alloc.symbol.toUpperCase().replace(/[\.\/]/g, '-');
                 const d = dataCache.current[s];
                 const price = d.c[idx] || d.c[d.c.length-1];
                 const startP = d.c[0];
                 if (price && startP) { val += (price / startP) * (totalAllocWeight > 0 ? alloc.percent / totalAllocWeight : 0); }
             });
             return { date: new Date(time * 1000), value: val };
        });
        
        const filteredModel = filterData(fullModelSeries, selectedRange, customStart, customEnd);
        const filteredBench = filterData(fullBenchSeries, selectedRange, customStart, customEnd);
        setHistory(filteredModel); setBenchmark(filteredBench);
        calcMetrics(filteredModel, filteredBench); 

        // Calculate Performance Matrix
        const periods = ['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'Custom'];
        const getReturnForPeriod = (series, period) => {
            const filtered = filterData(series, period, customStart, customEnd);
            if (!filtered || filtered.length < 2) return null;
            return (filtered[filtered.length - 1].value / filtered[0].value) - 1;
        };

        const perfMatrix = {
            benchmark: { id: 'bench', symbol: BENCHMARK_OPTIONS.find(b=>b.id===selectedBenchmarkId)?.label, isPinned: true },
            model: { id: 'model', symbol: model.name, isPinned: true },
            assets: []
        };

        periods.forEach(p => {
            perfMatrix.benchmark[p] = getReturnForPeriod(fullBenchSeries, p);
            perfMatrix.model[p] = getReturnForPeriod(fullModelSeries, p);
        });

        validAllocations.forEach(alloc => {
            const sym = alloc.symbol.toUpperCase().replace(/[\.\/]/g, '-');
            const d = dataCache.current[sym];
            let series = [];
            if (d && d.t) {
                series = d.t.map((t, i) => ({ date: new Date(t * 1000), value: d.c[i] }));
            }
            const assetPerf = { id: alloc.symbol, symbol: alloc.symbol, description: alloc.description, weight: alloc.percent };
            periods.forEach(p => {
                assetPerf[p] = getReturnForPeriod(series, p);
            });
            perfMatrix.assets.push(assetPerf);
        });

        setPerformanceData(perfMatrix);
        setLoading(false);
    };
    buildCharts();
  }, [selectedBenchmarkId, assetsLoaded, selectedRange, customStart, customEnd]); 

  const handleMouseMove = (e) => {
    if (!history || history.length === 0) return;
    const svgRect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - svgRect.left;
    const padding = 20;
    const chartWidth = svgRect.width - (padding * 2);
    const relativeX = Math.max(0, Math.min(x - padding, chartWidth));
    const index = Math.round((relativeX / chartWidth) * (history.length - 1));
    if (index >= 0 && index < history.length) {
        setHoverData({ index, date: history[index].date, modelVal: history[index].value, benchVal: benchmark[index]?.value });
    }
  };

  const renderChart = () => {
    if (history.length === 0) return null;
    const width = 500, height = 200, padding = 20, bottomPadding = 20;
    const minVal = Math.min(...history.map(d => d.value), ...benchmark.map(d => d.value)) * 0.95;
    const maxVal = Math.max(...history.map(d => d.value), ...benchmark.map(d => d.value)) * 1.05;
    const getX = (i) => (i / (history.length - 1)) * (width - padding * 2) + padding;
    const chartHeight = height - bottomPadding;
    const getY = (val) => chartHeight - padding - ((val - minVal) / (maxVal - minVal)) * (chartHeight - padding * 2);
    const makePath = (data) => data.map((d, i) => `${i===0?'M':'L'} ${getX(i)} ${getY(d.value)}`).join(' ');
    
    return (
        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible cursor-crosshair" onMouseMove={handleMouseMove} onMouseLeave={() => setHoverData(null)}>
            <line x1={padding} y1={getY(1)} x2={width-padding} y2={getY(1)} stroke="#334155" strokeDasharray="4" opacity="0.5" />
            <path d={makePath(benchmark)} fill="none" stroke="#64748b" strokeWidth="2" strokeDasharray="4" />
            <path d={makePath(history)} fill="none" stroke="#3b82f6" strokeWidth="3" />
            {hoverData && (
                <>
                    <line x1={getX(hoverData.index)} y1={padding} x2={getX(hoverData.index)} y2={chartHeight - padding} stroke="#e4e4e7" strokeWidth="1" strokeDasharray="2" />
                    <circle cx={getX(hoverData.index)} cy={getY(hoverData.modelVal)} r="5" fill="#3b82f6" stroke="white" strokeWidth="2" />
                    {hoverData.benchVal && <circle cx={getX(hoverData.index)} cy={getY(hoverData.benchVal)} r="4" fill="#64748b" />}
                </>
            )}
            <text x={padding} y={height - 5} fill="#52525b" fontSize="10" fontWeight="bold" textAnchor="start" style={{ textTransform: 'uppercase' }}>{history[0].date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</text>
            <text x={width - padding} y={height - 5} fill="#52525b" fontSize="10" fontWeight="bold" textAnchor="end" style={{ textTransform: 'uppercase' }}>{history[history.length-1].date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' })}</text>
        </svg>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-4xl w-full shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <button onClick={onClose} className="absolute top-6 right-6 text-zinc-500 hover:text-white"><X className="h-6 w-6" /></button>
            <div className="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
                <div><h3 className="text-2xl font-black text-white tracking-tighter mb-1">Backtest Intelligence</h3><p className="text-zinc-500 text-sm font-medium">{model.name} Performance</p></div>
                <div className="flex flex-col gap-2">
                    <div className="flex bg-zinc-950 border border-zinc-800 rounded-lg p-1 gap-1">
                        {TIME_RANGES.map(r => <button key={r.label} onClick={() => setSelectedRange(r.label)} className={`px-2 py-1 text-[10px] font-bold rounded-md transition-colors ${selectedRange === r.label ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}>{r.label}</button>)}
                    </div>
                    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 w-full">
                        <BarChart2 className="h-4 w-4 text-zinc-500" />
                        <select value={selectedBenchmarkId} onChange={(e) => setSelectedBenchmarkId(e.target.value)} className="bg-transparent text-xs font-bold text-zinc-300 focus:outline-none cursor-pointer w-full">
                            {BENCHMARK_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}
                        </select>
                    </div>
                 </div>
            </div>

            {selectedRange === 'Custom' && (
                <div className="flex gap-4 mb-6 bg-zinc-950 border border-zinc-800 p-3 rounded-xl items-center justify-center">
                    <div className="flex items-center gap-2"><span className="text-[10px] font-bold text-zinc-500 uppercase">Start</span><input type="date" className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white" value={customStart} onChange={e => setCustomStart(e.target.value)} /></div>
                    <ArrowRight className="h-4 w-4 text-zinc-600" />
                    <div className="flex items-center gap-2"><span className="text-[10px] font-bold text-zinc-500 uppercase">End</span><input type="date" className="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white" value={customEnd} onChange={e => setCustomEnd(e.target.value)} /></div>
                </div>
            )}

            {loading ? (
                <div className="h-64 flex flex-col items-center justify-center gap-4 text-zinc-500"><Loader2 className="h-8 w-8 animate-spin text-blue-500" /><span className="text-xs font-black uppercase tracking-widest">{progress}</span></div>
            ) : error ? (
                <div className="h-64 flex flex-col items-center justify-center gap-4 text-red-400"><WifiOff className="h-10 w-10 opacity-50" /><div className="text-center"><p className="font-bold">Backtest Failed</p><p className="text-xs text-red-400/60 mt-1">{error}</p></div></div>
            ) : (
                <>
                    {failures.length > 0 && (
                        <div className="bg-orange-500/10 border border-orange-500/20 rounded-xl p-3 mb-6 flex items-center gap-3">
                            <AlertTriangle className="h-5 w-5 text-orange-400" />
                            <div className="text-xs text-orange-200"><span className="font-bold block">Partial Data</span>Skipped: {failures.join(', ')}.</div>
                        </div>
                    )}
                    <div className="grid grid-cols-4 gap-4 mb-8">
                        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl"><div className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1">Model Return</div><div className={`text-2xl font-mono font-bold ${metrics.modelReturn >= 0 ? 'text-green-400' : 'text-red-400'}`}>{metrics.modelReturn > 0 ? '+' : ''}{metrics.modelReturn.toFixed(2)}%</div></div>
                        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl border-l-4 border-l-blue-600"><div className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1">Benchmark</div><div className="text-2xl font-mono font-bold text-zinc-300">{metrics.benchReturn > 0 ? '+' : ''}{metrics.benchReturn.toFixed(2)}%</div></div>
                        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl"><div className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1">Alpha</div><div className={`text-2xl font-mono font-bold ${metrics.modelReturn - metrics.benchReturn >= 0 ? 'text-blue-400' : 'text-orange-400'}`}>{(metrics.modelReturn - metrics.benchReturn) > 0 ? '+' : ''}{(metrics.modelReturn - metrics.benchReturn).toFixed(2)}%</div></div>
                        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl"><div className="text-[10px] font-black uppercase text-zinc-500 tracking-widest mb-1">Volatility</div><div className="text-2xl font-mono font-bold text-zinc-400">{metrics.volatility.toFixed(2)}%</div></div>
                    </div>
                    
                    <div className="relative h-64 w-full mb-4 group">
                        {renderChart()}
                        {hoverData && (
                            <div className="absolute bg-zinc-900/90 backdrop-blur-md border border-zinc-700 p-3 rounded-xl shadow-2xl pointer-events-none z-10 w-48 left-5 top-5">
                                <div className="text-[10px] font-black text-zinc-500 uppercase tracking-widest mb-2">{hoverData.date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</div>
                                <div className="space-y-1">
                                    <div className="flex justify-between items-center text-xs"><span className="font-bold text-blue-400">Model</span><span className="font-mono text-white">{((hoverData.modelVal - 1) * 100).toFixed(2)}%</span></div>
                                    <div className="flex justify-between items-center text-xs"><span className="font-bold text-zinc-500">Benchmark</span><span className="font-mono text-zinc-400">{((hoverData.benchVal - 1) * 100).toFixed(2)}%</span></div>
                                </div>
                            </div>
                        )}
                    </div>
                    
                    <div className="flex justify-center gap-8 text-[10px] font-bold uppercase tracking-widest">
                        <div className="flex items-center gap-2 text-blue-400"><div className="w-3 h-1 bg-blue-500 rounded-full" /> {model.name}</div>
                        <div className="flex items-center gap-2 text-zinc-500"><div className="w-3 h-1 bg-zinc-600 rounded-full border border-dashed border-zinc-500" /> {BENCHMARK_OPTIONS.find(b=>b.id===selectedBenchmarkId)?.label}</div>
                    </div>

                    {performanceData && (
                        <div className="mt-8 overflow-x-auto custom-scrollbar bg-zinc-950/50 border border-zinc-800 rounded-2xl">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-zinc-800 bg-zinc-900/30">
                                        <th className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 cursor-pointer hover:text-white transition-colors" onClick={() => setTableSort({ key: 'symbol', direction: tableSort.key === 'symbol' && tableSort.direction === 'asc' ? 'desc' : 'asc' })}>
                                            <div className="flex items-center gap-2">
                                                Symbol {tableSort.key === 'symbol' && (tableSort.direction === 'asc' ? <ArrowUpAZ className="h-3 w-3" /> : <ArrowDownAZ className="h-3 w-3" />)}
                                            </div>
                                        </th>
                                        {['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'Custom'].map(p => (
                                            <th key={p} className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 text-right cursor-pointer hover:text-white transition-colors" onClick={() => setTableSort({ key: p, direction: tableSort.key === p && tableSort.direction === 'asc' ? 'desc' : 'asc' })}>
                                                <div className="flex items-center justify-end gap-2">
                                                    {p} {tableSort.key === p && (tableSort.direction === 'asc' ? <ArrowUpNarrowWide className="h-3 w-3" /> : <ArrowDownWideNarrow className="h-3 w-3" />)}
                                                </div>
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Pinned Rows */}
                                    <tr className="bg-zinc-900/80 border-b-2 border-zinc-800 font-bold group">
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className="text-white text-xs flex items-center gap-2">
                                                    <Tag className="h-3 w-3 text-zinc-500" /> {performanceData.benchmark.symbol}
                                                </span>
                                                <span className="text-[9px] text-zinc-500 uppercase tracking-tighter">Benchmark Index</span>
                                            </div>
                                        </td>
                                        {['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'Custom'].map(p => (
                                            <td key={p} className="p-4 text-right text-sm">{formatTablePerf(performanceData.benchmark[p])}</td>
                                        ))}
                                    </tr>
                                    <tr className="bg-zinc-900/80 border-b-2 border-zinc-800 font-bold group">
                                        <td className="p-4">
                                            <div className="flex flex-col">
                                                <span className="text-blue-400 text-xs flex items-center gap-2">
                                                    <Layers className="h-3 w-3" /> {performanceData.model.symbol}
                                                </span>
                                                <span className="text-[9px] text-zinc-500 uppercase tracking-tighter">Model Strategy</span>
                                            </div>
                                        </td>
                                        {['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'Custom'].map(p => (
                                            <td key={p} className="p-4 text-right text-sm">{formatTablePerf(performanceData.model[p])}</td>
                                        ))}
                                    </tr>
                                    
                                    {/* Asset Rows */}
                                    {sortedAssets.map((asset, idx) => (
                                        <tr key={asset.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors group">
                                            <td className="p-4">
                                                <div className="flex flex-col">
                                                    <span className="text-white text-xs font-bold">{asset.symbol}</span>
                                                    <span className="text-[9px] text-zinc-500 truncate max-w-[150px]">{asset.description}</span>
                                                </div>
                                            </td>
                                            {['1M', '3M', '6M', 'YTD', '1Y', '3Y', '5Y', 'Custom'].map(p => (
                                                <td key={p} className="p-4 text-right text-sm">{formatTablePerf(asset[p])}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    </div>
  );
};
const BondLadderView = ({ client, positions, totalValue, onUpdateClient, visibleCols, renderCell, handleSort, sortConfig, handleResizeStart, handleDeletePos, newTicker, setNewTicker, addTicker, isAddingTicker, compactMode }: any) => {
    const lockedYears = client.ladderSettings?.lockedYears || {};
    const yearsOut = client.ladderSettings?.yearsOut || 10;
    const distributionType = client.ladderSettings?.distributionType || 'Even';
    const [collapsedYears, setCollapsedYears] = useState<Set<string>>(new Set());
    const [activeAddModule, setActiveAddModule] = useState<string | null>(null);

    const toggleYear = (y: string) => setCollapsedYears(prev => { const next = new Set(prev); if (next.has(y)) next.delete(y); else next.add(y); return next; });

    const handleSettingsChange = (key: string, value: any) => {
        onUpdateClient({
            ...client,
            ladderSettings: {
                ...client.ladderSettings,
                [key]: value
            },
            lastUpdated: new Date().toISOString()
        });
    };

    const isColVisible = (id: string) => {
        if (!visibleCols) return true;
        return visibleCols.some((c: any) => c.id === id);
    };

    const groups = useMemo(() => {
        const g: any = { 'Cash': [], 'Equities & Funds': [] };
        if (!positions) return g;
        positions.forEach((p: any) => {
            const symbol = p.symbol.toUpperCase();
            if (CASH_TICKERS.some(t => symbol.includes(t)) || (p.description && p.description.toUpperCase().includes('CASH')) || p.metadata?.assetClass === 'Cash') {
                g['Cash'].push(p);
            } else {
                const isFi = p.metadata?.assetClass === 'Fixed Income' || p.metadata?.assetClass === 'Municipal Bond' || isBond(p.symbol, p.description);
                if (!isFi) {
                    g['Equities & Funds'].push(p);
                } else {
                    const match = p.description?.match(/\d{2}\/\d{2}\/(\d{4})/);
                    const year = match ? match[1] : 'Other';
                    if (!g[year]) g[year] = [];
                    g[year].push(p);
                }
            }
        });
        return g;
    }, [positions]);

    const sortedYears = useMemo(() => {
        const currentYear = new Date().getFullYear();
        const yearsOut = client.ladderSettings?.yearsOut || 5;
        const hiddenYears = client.ladderSettings?.hiddenYears || [];
        const yearSet = new Set();
        for (let i = 0; i < yearsOut; i++) yearSet.add((currentYear + i).toString());
        Object.keys(groups).forEach(k => { if (k !== 'Cash' && k !== 'Equities & Funds' && k !== 'Other') yearSet.add(k); });
        const years = Array.from(yearSet).filter(y => !hiddenYears.includes(y as string)).sort();
        if (groups['Equities & Funds']?.length > 0) years.push('Equities & Funds');
        if (groups['Other']?.length > 0) years.push('Other');
        return years;
    }, [groups, client.ladderSettings]);

    const yearData = useMemo(() => {
        const data: any = {};
        let totalLockedPct = 0;
        let unlockedCount = 0;
        const distType = client.ladderSettings?.distributionType || 'Even';

        sortedYears.forEach(year => {
            const currentGroup = groups[year] || [];
            const yearValue = currentGroup.reduce((sum: number, p: any) => sum + (Number(p.currentValue) || 0), 0);
            const actualPct = totalValue > 0 ? (yearValue / totalValue) * 100 : 0;
            
            if (lockedYears[year] !== undefined) {
                totalLockedPct += lockedYears[year];
            } else {
                unlockedCount++;
            }
            
            data[year] = {
                value: yearValue,
                actualPct
            };
        });

        const evenTargetPct = unlockedCount > 0 ? Math.max(0, (100 - totalLockedPct) / unlockedCount) : 0;

        sortedYears.forEach(year => {
            if (lockedYears[year] !== undefined) {
                data[year].targetPct = lockedYears[year];
            } else {
                data[year].targetPct = distType === 'Custom' ? data[year].actualPct : evenTargetPct;
            }
            data[year].targetValue = (data[year].targetPct / 100) * totalValue;
            data[year].delta = data[year].targetValue - data[year].value;
        });

        return data;
    }, [groups, sortedYears, totalValue, lockedYears, client.ladderSettings]);

    const setTargetPct = (year: string, value: number) => {
        const newLocked = { ...lockedYears, [year]: value };
        onUpdateClient({ ...client, ladderSettings: { ...client.ladderSettings, lockedYears: newLocked }, lastUpdated: new Date().toISOString() });
    };

    const toggleLock = (year: string, targetPct: number) => {
        const newLocked = { ...lockedYears };
        if (newLocked[year] !== undefined) {
            delete newLocked[year];
        } else {
            newLocked[year] = targetPct;
        }
        onUpdateClient({ ...client, ladderSettings: { ...client.ladderSettings, lockedYears: newLocked }, lastUpdated: new Date().toISOString() });
    };

    const cashValue = useMemo(() => {
        return groups['Cash']?.reduce((sum: number, p: any) => sum + (Number(p.currentValue) || 0), 0) || 0;
    }, [groups]);

    const totals = useMemo(() => {
        let totalVal = 0;
        let totalCost = 0;
        let totalYieldVal = 0;
        
        if (positions) {
            positions.forEach((p: any) => {
                const val = Number(p.currentValue) || 0;
                const cost = Number(p.costBasis) || val;
                const yld = Number(p.yield) || 0;
                
                totalVal += val;
                totalCost += cost;
                
                let y = yld;
                if (isBond(p.symbol, p.description)) {
                    const yieldMatch = p.description?.match(/(\d+\.\d+)%/);
                    y = yieldMatch ? parseFloat(yieldMatch[1]) : yld;
                }
                totalYieldVal += val * y;
            });
        }
        
        const glDollars = totalVal - totalCost;
        const glPct = totalCost > 0 ? (glDollars / totalCost) * 100 : 0;
        const weightedYield = totalVal > 0 ? totalYieldVal / totalVal : 0;
        
        return { totalVal, totalCost, glPct, weightedYield };
    }, [positions]);

    const totalAllocated = Object.values(yearData as any).reduce((sum: number, d: any) => sum + d.targetPct, 0) as number;
    const allocatedColor = Math.abs(totalAllocated - 100) < 0.01 ? 'text-green-500' : (totalAllocated > 100 ? 'text-red-500' : 'text-orange-500');

    return (
        <div className="space-y-6 px-8 py-8 max-w-[1600px] w-full mx-auto">
            <div className="bg-zinc-900/20 border border-zinc-800 rounded-2xl p-6 mb-8 shadow-2xl flex flex-col md:flex-row justify-between items-center gap-6">
                <div>
                    <h3 className="text-xl font-black text-white tracking-tighter">Bond Ladder Settings</h3>
                    <p className="text-zinc-500 text-xs mt-1 font-medium">Configure ladder duration and target distribution.</p>
                </div>
                <div className="flex items-center gap-6">
                    <span className={`font-bold text-sm ${allocatedColor}`}>Total Allocated: {totalAllocated.toFixed(2)}%</span>
                    <div className="flex items-center gap-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Years Out</label>
                        <input 
                            type="number" 
                            className="w-16 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-sm font-mono text-white focus:outline-none focus:border-blue-500 transition-colors"
                            value={yearsOut}
                            onChange={(e) => handleSettingsChange('yearsOut', parseInt(e.target.value) || 5)}
                        />
                    </div>
                    <div className="flex items-center gap-3">
                        <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Distribution Type</label>
                        <select 
                            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm font-medium text-white focus:outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer pr-8 relative"
                            value={distributionType}
                            onChange={(e) => handleSettingsChange('distributionType', e.target.value)}
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2371717a'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E")`, backgroundPosition: 'right 0.5rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em' }}
                        >
                            <option value="Even">Even Split</option>
                            <option value="Custom">Custom Weighting</option>
                        </select>
                    </div>
                    <Button variant="secondary" onClick={() => handleSettingsChange('hiddenYears', [])} className="h-8 rounded-lg px-3 text-[10px] font-black uppercase">Restore Hidden</Button>
                </div>
            </div>

            {sortedYears.map(year => {
                const data = yearData[year];
                const isLocked = lockedYears[year] !== undefined;

                let totalYieldValue = 0;
                let totalYearValue = 0;
                
                const currentGroup = groups[year] || [];
                const processedBonds = currentGroup.map((p: any) => {
                    const desc = p.description || '';
                    const dateMatch = desc.match(/\d{2}\/\d{2}\/(\d{4})/);
                    const maturityDate = dateMatch ? dateMatch[0] : '--';
                    
                    const yieldMatch = desc.match(/(\d+\.\d+)%/);
                    const statedYield = yieldMatch ? parseFloat(yieldMatch[1]) : (p.yield || 0);
                    
                    let cleanIssuer = desc
                        .replace(/\d+\.?\d*%/g, '') // Remove Yield
                        .replace(/\d{2}\/\d{2}\/\d{4}/g, '') // Remove Date
                        .replace(/\b(ISIN|SEDOL)\s*#?[A-Z0-9]+/gi, '') // Remove ISIN/SEDOL codes
                        .replace(/\b(BOND|NOTE|NOTES|MTN|MTNS|CALL|MAKE|WHOLE|SER|SERIES)\b/gi, '') // Remove bond terms
                        .replace(/[^a-zA-Z\s&]/g, '') // Remove stray punctuation, keeping ampersands
                        .replace(/\s{2,}/g, ' ') // Collapse multiple spaces into one
                        .trim();
                    
                    const currentVal = Number(p.currentValue) || 0;
                    totalYieldValue += currentVal * statedYield;
                    totalYearValue += currentVal;
                    
                    const costBasis = Number(p.costBasis) || currentVal;
                    const glDollars = currentVal - costBasis;
                    const glPct = costBasis > 0 ? (glDollars / costBasis) * 100 : 0;

                    return {
                        ...p,
                        maturityDate,
                        statedYield,
                        issuer: cleanIssuer,
                        costBasis,
                        glPct
                    };
                });
                
                const weightedYield = totalYearValue > 0 ? totalYieldValue / totalYearValue : 0;

                return (
                    <div key={year} className="bg-zinc-900/20 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
                        <div className="bg-zinc-950/80 p-6 border-b border-zinc-800 flex justify-between items-center backdrop-blur-md">
                            <div className="flex items-center gap-6">
                                <button onClick={() => toggleYear(year)} className="text-zinc-500 hover:text-white transition-colors ml-2">
                                    {collapsedYears.has(year) ? <ChevronRight className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                                </button>
                                <h3 className="text-3xl font-black text-white tracking-tighter">{year}</h3>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Current Value</span>
                                    <span className="font-mono font-bold text-zinc-300">
                                        {formatCurrency(data.value)} 
                                        <span className="text-zinc-500 ml-1">({data.actualPct.toFixed(2)}%)</span>
                                        <span className="text-zinc-400 text-sm ml-4">Yield: {weightedYield.toFixed(2)}%</span>
                                    </span>
                                </div>
                            </div>
                            <div className="flex items-center gap-6">
                                <div className="text-right flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Target Value</span>
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono font-bold text-blue-400">{formatCurrency(data.targetValue)}</span>
                                        <div className="flex items-center bg-blue-500/10 rounded px-2 py-1 border border-blue-500/20">
                                            <input 
                                                type="number" 
                                                className="w-16 bg-transparent text-right font-mono text-blue-400 focus:outline-none text-sm" 
                                                value={isLocked ? lockedYears[year] : data.targetPct.toFixed(2)} 
                                                onChange={(e) => setTargetPct(year, parseFloat(e.target.value) || 0)}
                                            />
                                            <span className="text-blue-500/50 ml-1 text-sm">%</span>
                                        </div>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => toggleLock(year, data.targetPct)}
                                    className={`p-3 rounded-xl transition-all ${isLocked ? 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30' : 'bg-zinc-900 text-zinc-500 hover:text-white hover:bg-zinc-800 border border-zinc-800'}`}
                                >
                                    {isLocked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                                </button>
                                <button 
                                    onClick={() => handleSettingsChange('hiddenYears', [...(client.ladderSettings?.hiddenYears || []), year])}
                                    className="p-3 rounded-xl transition-all bg-zinc-900 text-zinc-500 hover:text-white hover:bg-zinc-800 border border-zinc-800"
                                >
                                    <EyeOff className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                        {!collapsedYears.has(year) && (
                            <div className="overflow-x-auto custom-scrollbar">
                                {year === 'Equities & Funds' ? (
                                    <table className="w-full text-left text-sm border-collapse min-w-[800px]" style={{ tableLayout: 'fixed' }}>
                                        <thead className="bg-zinc-950/50 border-b border-zinc-800">
                                            <tr>
                                                {visibleCols?.map((col: any) => (
                                                    <th key={col.id} style={{ width: col.width }} className={`sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-sm shadow-sm border-b border-zinc-800 p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 relative group/th cursor-pointer hover:bg-zinc-900/50 transition-colors ${col.align === 'right' ? 'text-right' : 'text-left'} ${compactMode ? 'p-2' : 'p-4'}`} onClick={() => handleSort && handleSort(col.id)}>
                                                        <div className={`flex items-center gap-2 ${col.align === 'right' ? 'justify-end' : ''}`}>
                                                            {col.label}
                                                            {sortConfig?.key === col.id && (sortConfig.direction === 'asc' ? <ArrowUpNarrowWide className="h-3 w-3 text-blue-500" /> : <ArrowDownWideNarrow className="h-3 w-3 text-blue-500" />)}
                                                        </div>
                                                        <div className="col-resizer" onMouseDown={(e) => { e.stopPropagation(); handleResizeStart && handleResizeStart(e, col.id); }} onClick={(e)=>e.stopPropagation()} />
                                                    </th>
                                                ))}
                                                <th className={`w-12 sticky top-0 z-10 bg-zinc-950/90 backdrop-blur-sm shadow-sm border-b border-zinc-800 ${compactMode ? 'p-2' : 'p-4'}`}></th>
                                            </tr>
                                        </thead>
                                    <tbody className="divide-y divide-zinc-900/50">
                                        {processedBonds.map((p: any) => (
                                            <tr key={p.id} className="hover:bg-zinc-900/40 transition-colors group">
                                                {visibleCols?.map((col: any) => (
                                                    <td key={col.id} className={`${col.id === 'symbol' ? 'p-0' : 'p-4'} whitespace-nowrap ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                                                        {renderCell && renderCell(col, p)}
                                                    </td>
                                                ))}
                                                <td className="p-4 text-right">
                                                    <button onClick={() => handleDeletePos && handleDeletePos(p.id)} className="text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        <tr className="bg-zinc-950/50 group border-t border-zinc-800/50">
                                            <td colSpan={visibleCols.length + 1} className="p-0">
                                                {activeAddModule === year ? (
                                                    <div className="flex items-center gap-4 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                                        <div className="h-8 w-8 rounded-lg border border-dashed border-zinc-800 flex items-center justify-center text-zinc-700"><PlusCircle className="h-4 w-4" /></div>
                                                        <input
                                                            autoFocus
                                                            className="bg-transparent flex-1 py-1 text-sm text-white focus:outline-none font-bold placeholder-zinc-700"
                                                            placeholder="Add Security (e.g. AAPL or Bond CUSIP)..."
                                                            value={newTicker}
                                                            onChange={e => setNewTicker(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') {
                                                                    addTicker();
                                                                    setActiveAddModule(null);
                                                                }
                                                                if (e.key === 'Escape') {
                                                                    setActiveAddModule(null);
                                                                    setNewTicker('');
                                                                }
                                                            }}
                                                            onBlur={() => {
                                                                if (!newTicker) setActiveAddModule(null);
                                                            }}
                                                        />
                                                        <div className="flex items-center gap-2">
                                                            <Button onClick={() => { addTicker(); setActiveAddModule(null); }} variant="ghost" loading={isAddingTicker} className="text-blue-500 h-8 px-3">Add</Button>
                                                            <button onClick={() => setActiveAddModule(null)} className="p-2 text-zinc-600 hover:text-zinc-400"><X className="h-4 w-4" /></button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button 
                                                        onClick={() => setActiveAddModule(year)}
                                                        className="w-full flex items-center justify-center gap-2 p-3 text-xs font-bold text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900/50 transition-colors uppercase tracking-widest"
                                                    >
                                                        <Plus className="h-3 w-3" /> Add Security
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            ) : (
                                <table className="w-full text-left text-sm border-collapse min-w-[800px]">
                                    <thead className="bg-zinc-950/50 border-b border-zinc-800">
                                        <tr>
                                            {['Symbol', 'Issuer', 'Maturity Date', 'Quantity', 'Price', 'Cost Basis', 'Current Value', 'G/L %', 'Yield'].map(header => (
                                                <th key={header} className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 text-left whitespace-nowrap">
                                                    {header}
                                                </th>
                                            ))}
                                            <th className="w-12 p-4"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-900/50">
                                        {processedBonds.map((p: any) => (
                                            <tr key={p.id} className="hover:bg-zinc-900/40 transition-colors group">
                                                <td className="p-4 whitespace-nowrap font-bold text-white">{p.symbol}</td>
                                                <td className="p-4 whitespace-nowrap text-zinc-400">{p.issuer || '--'}</td>
                                                <td className="p-4 whitespace-nowrap text-zinc-400">{p.maturityDate || '--'}</td>
                                                <td className="p-4 whitespace-nowrap text-zinc-300 font-mono">{formatQuantity(p.quantity)}</td>
                                                <td className="p-4 whitespace-nowrap text-zinc-300 font-mono">{formatCurrency(p.price)}</td>
                                                <td className="p-4 whitespace-nowrap text-zinc-300 font-mono">{formatCurrency(p.costBasis)}</td>
                                                <td className="p-4 whitespace-nowrap font-bold text-white font-mono">{formatCurrency(p.currentValue)}</td>
                                                <td className={`p-4 whitespace-nowrap font-mono font-bold ${p.glPct >= 0 ? 'text-green-500' : 'text-red-500'}`}>{p.glPct > 0 ? '+' : ''}{p.glPct.toFixed(2)}%</td>
                                                <td className="p-4 whitespace-nowrap font-mono text-zinc-300">{(p.statedYield || 0).toFixed(2)}%</td>
                                                <td className="p-4 text-right">
                                                    <button onClick={() => handleDeletePos && handleDeletePos(p.id)} className="text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all">
                                                        <Trash2 className="h-4 w-4" />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        <tr className="bg-zinc-950/50 group border-t border-zinc-800/50">
                                            <td colSpan={10} className="p-0">
                                                {activeAddModule === year ? (
                                                    <div className="flex items-center gap-4 p-4 animate-in fade-in slide-in-from-top-2 duration-200">
                                                        <div className="h-8 w-8 rounded-lg border border-dashed border-zinc-800 flex items-center justify-center text-zinc-700"><PlusCircle className="h-4 w-4" /></div>
                                                        <input
                                                            autoFocus
                                                            className="bg-transparent flex-1 py-1 text-sm text-white focus:outline-none font-bold placeholder-zinc-700"
                                                            placeholder="Add Security (e.g. AAPL or Bond CUSIP)..."
                                                            value={newTicker}
                                                            onChange={e => setNewTicker(e.target.value)}
                                                            onKeyDown={e => {
                                                                if (e.key === 'Enter') {
                                                                    addTicker();
                                                                    setActiveAddModule(null);
                                                                }
                                                                if (e.key === 'Escape') {
                                                                    setActiveAddModule(null);
                                                                    setNewTicker('');
                                                                }
                                                            }}
                                                            onBlur={() => {
                                                                if (!newTicker) setActiveAddModule(null);
                                                            }}
                                                        />
                                                        <div className="flex items-center gap-2">
                                                            <Button onClick={() => { addTicker(); setActiveAddModule(null); }} variant="ghost" loading={isAddingTicker} className="text-blue-500 h-8 px-3">Add</Button>
                                                            <button onClick={() => setActiveAddModule(null)} className="p-2 text-zinc-600 hover:text-zinc-400"><X className="h-4 w-4" /></button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <button 
                                                        onClick={() => setActiveAddModule(year)}
                                                        className="w-full flex items-center justify-center gap-2 p-3 text-xs font-bold text-zinc-600 hover:text-zinc-400 hover:bg-zinc-900/50 transition-colors uppercase tracking-widest"
                                                    >
                                                        <Plus className="h-3 w-3" /> Add Security
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}
                        </div>
                    )}
                        <div className={`p-6 border-t-4 border-zinc-800 flex justify-between items-center ${Math.abs(data.delta) > 1 ? (data.delta > 0 ? 'bg-green-900/10' : 'bg-red-900/10') : 'bg-zinc-950/80'}`}>
                            <span className="text-xs font-black uppercase tracking-widest text-zinc-500">Trade Action Needed</span>
                            <span className={`font-mono font-black text-2xl tracking-tight ${Math.abs(data.delta) > 1 ? (data.delta > 0 ? 'text-green-500' : 'text-red-500') : 'text-zinc-500'}`}>
                                {data.delta > 0 ? '+' : ''}{formatCurrency(data.delta)}
                            </span>
                        </div>
                    </div>
                );
            })}
            
            {/* Master Totals Section */}
            <div className="bg-zinc-900/20 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl mt-8">
                <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left text-sm border-collapse min-w-[800px]" style={{ tableLayout: 'fixed' }}>
                    <thead className="bg-zinc-950/50 border-b border-zinc-800">
                        <tr>
                            {visibleCols?.map((col: any) => (
                                <th key={col.id} style={{ width: col.width }} className={`p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 ${col.align === 'right' ? 'text-right' : 'text-left'}`}>
                                    {col.label}
                                </th>
                            ))}
                            <th className="w-12 p-4"></th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900/50">
                        <tr className="hover:bg-zinc-900/40 transition-colors group">
                            {visibleCols?.map((col: any) => {
                                if (col.id === 'symbol') {
                                    return (
                                        <td key={col.id} className="p-4 flex items-center gap-4">
                                            <div className="h-10 w-10 bg-green-900/20 rounded-lg flex items-center justify-center text-green-500 border border-green-500/20">
                                                <Banknote className="h-5 w-5" />
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="font-black text-white">CASH</span>
                                                <span className="text-[11px] text-zinc-500">Sweep</span>
                                            </div>
                                        </td>
                                    );
                                }
                                if (col.id === 'currentValue') {
                                    return (
                                        <td key={col.id} className="p-0 border border-transparent transition-colors h-full hover:bg-zinc-900 cursor-pointer hover:border-zinc-700">
                                            <input 
                                                type="number" 
                                                className="w-full h-full p-4 bg-transparent text-right font-mono font-bold text-white focus:outline-none" 
                                                value={cashValue} 
                                                onChange={(e) => {
                                                    const newVal = parseFloat(e.target.value) || 0;
                                                    const cashTickers = positions.filter((p: any) => CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)));
                                                    if (cashTickers.length > 0) {
                                                        const diff = newVal - cashValue;
                                                        const newPositions = positions.map((p: any) => p.id === cashTickers[0].id ? { ...p, currentValue: p.currentValue + diff } : p);
                                                        onUpdateClient({ ...client, positions: newPositions, lastUpdated: new Date().toISOString() });
                                                    } else {
                                                        const newPositions = [...positions, { id: generateId(), symbol: 'FCASH', description: 'Cash', quantity: newVal, price: 1, currentValue: newVal, yield: 0, targetPct: 0, roundingMode: 'exact', metadata: { assetClass: 'Cash' } }];
                                                        onUpdateClient({ ...client, positions: newPositions, lastUpdated: new Date().toISOString() });
                                                    }
                                                }} 
                                            />
                                        </td>
                                    );
                                }
                                if (col.id === 'currentPct') {
                                    return <td key={col.id} className="p-4 text-right"><span className="font-mono text-zinc-300 font-bold">{((cashValue / totalValue) * 100).toFixed(2)}%</span></td>;
                                }
                                if (col.id === 'price') return <td key={col.id} className="p-4 text-right font-mono text-zinc-500">$1.00</td>;
                                if (col.id === 'costBasis') return <td key={col.id} className="p-4 text-right font-mono text-zinc-500">{formatCurrency(cashValue)}</td>;
                                if (col.id === 'quantity') return <td key={col.id} className="p-4 text-right font-mono text-zinc-500">--</td>;
                                return <td key={col.id} className="p-4"></td>;
                            })}
                            <td className="p-4"></td>
                        </tr>
                    </tbody>
                    <tfoot className="bg-zinc-950/80 backdrop-blur-md border-t-4 border-zinc-800">
                        <tr className="text-zinc-400">
                            {visibleCols?.map((col: any) => {
                                if (col.id === 'symbol') return <td key={col.id} className="p-4 font-black uppercase tracking-widest text-[10px]">Total Portfolio</td>;
                                if (col.id === 'currentValue') return <td key={col.id} className="p-4 text-right font-mono font-black text-white text-base">{formatCurrency(totals.totalVal)}</td>;
                                if (col.id === 'costBasis') return <td key={col.id} className="p-4 text-right font-mono text-zinc-500">{formatCurrency(totals.totalCost)}</td>;
                                if (col.id === 'unrealizedGLPct') return (
                                    <td key={col.id} className="p-4 text-right font-mono font-bold">
                                        <span className={totals.glPct >= 0 ? 'text-green-500' : 'text-red-500'}>{totals.glPct > 0 ? '+' : ''}{totals.glPct.toFixed(2)}%</span>
                                    </td>
                                );
                                if (col.id === 'yield') return <td key={col.id} className="p-4 text-right font-mono text-green-400">{totals.weightedYield.toFixed(2)}%</td>;
                                return <td key={col.id} className="p-4"></td>;
                            })}
                            <td className="p-4"></td>
                        </tr>
                    </tfoot>
                    </table>
                </div>
            </div>
        </div>
    );
};

const ClientProfileModal = ({ client, onClose, onUpdateClient }: any) => {
    const [firstName, setFirstName] = useState(client.profile?.firstName || '');
    const [lastName, setLastName] = useState(client.profile?.lastName || '');
    const [nickname, setNickname] = useState(client.profile?.nickname || '');
    const [dob, setDob] = useState(client.profile?.dob || '');
    const [phone, setPhone] = useState(client.profile?.phone || '');
    const [email, setEmail] = useState(client.profile?.email || '');
    const [address, setAddress] = useState(client.profile?.address || '');
    const [accountNumber, setAccountNumber] = useState(client.profile?.accountNumber || '');

    const handleSave = () => {
        if (!firstName.trim() || !lastName.trim()) {
            alert("First Name and Last Name are required.");
            return;
        }
        const name = `${firstName.trim()} ${lastName.trim()}`;
        const profile = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            nickname: nickname.trim(),
            dob: dob.trim(),
            phone: phone.trim(),
            email: email.trim(),
            address: address.trim(),
            accountNumber: accountNumber.trim()
        };
        onUpdateClient({ ...client, name, profile, lastUpdated: new Date().toISOString() });
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
                            <User className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white tracking-tight">Client Profile</h2>
                            <p className="text-xs text-zinc-500 font-medium">View and edit client details</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Account Number</label>
                            <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="e.g. 123456789" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Nickname</label>
                            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="Janey" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">First Name *</label>
                            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="Jane" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Last Name *</label>
                            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="Doe" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Date of Birth</label>
                            <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Phone Number</label>
                            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="(555) 123-4567" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Email Address</label>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="jane@example.com" />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Mailing Address</label>
                            <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="123 Main St, City, ST 12345" />
                        </div>
                    </div>
                </div>
                <div className="p-6 border-t border-zinc-800 bg-zinc-900/50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-6 py-2.5 text-sm font-bold text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    <Button onClick={handleSave} className="px-8 py-2.5 rounded-xl">Save Profile</Button>
                </div>
            </div>
        </div>
    );
};

const Rebalancer = ({ client, userProfile, getGreeting, onUpdateClient, onBack, models, isAggregated, onDeleteAccount, assetOverrides, setAssetOverrides, onNavigate, viewPreferences, setViewPreferences, globalCustomView, onUpdateGlobalCustomView, hasUnsavedCustomChanges, setHasUnsavedCustomChanges, activeViewType, setActiveViewType, defaultViewType, setDefaultViewType }: any) => {
  const [positions, setPositions] = useState(client.positions || []);
  const [isEnriching, setIsEnriching] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [newTicker, setNewTicker] = useState('');
  const [isAddingTicker, setIsAddingTicker] = useState(false);
  const [plannedValue, setPlannedValue] = useState(null); 
  const [showModelModal, setShowModelModal] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [modelTargetValue, setModelTargetValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [layout, setLayout] = useState(() => {
      try { return JSON.parse(localStorage.getItem('rebalance_layout')) || DEFAULT_COLUMNS; } 
      catch(e) { return DEFAULT_COLUMNS; }
  });
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  
  const compactMode = activeViewType === 'custom' ? globalCustomView?.isCompact : viewPreferences.isCompact;
  const isModularView = activeViewType === 'custom' ? globalCustomView?.framework === 'modular' : viewPreferences.layout === 'modular';
  const columns = layout;
  
  useEffect(() => {
      if (activeViewType === 'custom') {
          setLayout(globalCustomView.columns);
          setHasUnsavedCustomChanges(false);
      } else {
          try { 
              setLayout(JSON.parse(localStorage.getItem('rebalance_layout')) || DEFAULT_COLUMNS); 
          } catch(e) { 
              setLayout(DEFAULT_COLUMNS); 
          }
      }
  }, [activeViewType, setHasUnsavedCustomChanges]);

  const startResizeRef = useRef(null);

  const [isEditingName, setIsEditingName] = useState(false);
  const [tempName, setTempName] = useState(client.name);
  const nameInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localCashTarget, setLocalCashTarget] = useState<string>(client.allocationTargets?.cash?.toString() || '');
  const [isEditingAccNum, setIsEditingAccNum] = useState(false);
  const [tempAccNum, setTempAccNum] = useState(client.accountNumber || '');

  useEffect(() => {
      setTempAccNum(client.accountNumber || '');
  }, [client.accountNumber]);

  useEffect(() => {
      if (client.allocationTargets?.cash !== undefined) {
          setLocalCashTarget(client.allocationTargets.cash.toString());
      }
  }, [client.allocationTargets?.cash]);

  useEffect(() => {
      setPositions(client.positions || []);
  }, [client.positions]);

  const totalValue = useMemo(() => plannedValue !== null ? plannedValue : positions.reduce((sum, p) => sum + (Number(p.currentValue) || 0), 0), [positions, plannedValue]);

  const handleSaveName = () => {
    if (tempName.trim() && tempName !== client.name) {
      onUpdateClient({ ...client, name: tempName.trim(), positions });
    }
    setIsEditingName(false);
  };

  const handleStageTrades = (navigateAfter = false) => {
    const CASH_SWAP_ACCOUNT_TYPES = ['Individual', 'TOD', 'TODI', 'TODE', 'TODJ'];
    const allDerivedPositions = displayPositions.modularGroups.flatMap((g: any) => g.items);
    const newTrades = allDerivedPositions
        .filter(p => {
            const hasValue = Math.abs(p.tradeShares) > 0 || Math.abs(p.tradeValue) > 0;
            if (!hasValue) return false;
            const isCashTicker = CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t));
            
            // If it's not cash, we always want to stage the trade
            if (!isCashTicker) return true;
            // If it IS a cash ticker, check the FDRXX Buy exception
            const isFdrxxBuy = p.symbol.toUpperCase() === 'FDRXX' && p.tradeValue > 0;
            const isQualifyingAccount = CASH_SWAP_ACCOUNT_TYPES.includes(client.accountType);
            return isFdrxxBuy && isQualifyingAccount;
        })
        .map(p => ({
            id: p.symbol,
            symbol: p.symbol,
            action: p.tradeValue > 0 ? 'Buy' : 'Sell',
            shares: Math.abs(p.tradeShares) || 0,
            value: Math.abs(p.tradeValue) || 0,
            type: 'Market',
            limitPrice: null,
            status: 'pending',
            timestamp: Date.now()
        }));
    if (newTrades.length === 0) {
        onUpdateClient({ ...client, positions, tradeFlags: {}, lastUpdated: new Date().toISOString() });
        setShowSaveModal(false);
        if (navigateAfter && onNavigate) onNavigate('trades');
        return;
    }
    const existingExported = (client.stagedTrades || []).filter(t => t.status === 'exported');
    const hasConflict = newTrades.some(nt => existingExported.some(et => et.symbol === nt.symbol));
    if (hasConflict) {
        if (!window.confirm('Warning: You have already exported trades for some of these symbols today. Overwrite?')) return;
    }
    const mergedTrades = [...(client.stagedTrades || []).filter(t => !newTrades.some(nt => nt.symbol === t.symbol)), ...newTrades];
    onUpdateClient({ ...client, positions, stagedTrades: mergedTrades, tradeFlags: {}, lastUpdated: new Date().toISOString() });
    setShowSaveModal(false);
    if (navigateAfter && onNavigate) onNavigate('trades');
  };

  useEffect(() => {
    if (isEditingName && nameInputRef.current) {
      nameInputRef.current.focus();
    }
  }, [isEditingName]);

  const handleResetGoals = () => {
    const totalVal = positions.reduce((sum, p) => sum + (Number(p.currentValue) || 0), 0);
    const nextPositions = positions.map(p => {
        const currentWeight = totalVal > 0 ? (p.currentValue / totalVal) * 100 : 0;
        return { ...p, targetPct: currentWeight, targetEdited: false };
    });
    setPositions(nextPositions);
    onUpdateClient({ ...client, positions: nextPositions, lastUpdated: new Date().toISOString() });
  };

  const applyModel = async () => {
    const model = models.find(m => m.id === selectedModelId);
    if (!model) return;
    const targetValNum = parseFloat(modelTargetValue);
    if (!isNaN(targetValNum) && targetValNum > 0) setPlannedValue(targetValNum);
    setIsAddingTicker(true);

    const cleanPositions = positions.filter((p: any) => {
        if (p.quantity > 0) return true; 
        if (p.description && typeof p.description === 'string' && p.description.startsWith('Model:')) {
            return false; 
        }
        return true; 
    });

    const existingMap = new Map(cleanPositions.map(p => [p.symbol, p]));
    const newPositions = [];
    
    for (const alloc of model.allocations) {
      const symbol = alloc.symbol.toUpperCase();
      let pos: any = existingMap.get(symbol);
      if (!pos) {
        let price = 0;
        try {
          const res = await fetchFinnhub(`quote?symbol=${symbol}`);
          price = res.c || 0;
        } catch (e) {}
        pos = { id: generateId(), symbol, description: `Model: ${model.name}`, quantity: 0, price, currentValue: 0, yield: 0, targetPct: alloc.percent, targetEdited: true, roundingMode: 'exact', metadata: null };
      } else { 
          const isModelPlaceholder = pos.quantity === 0 && pos.description.startsWith('Model:');
          pos = { 
              ...pos, 
              targetPct: alloc.percent, 
              targetEdited: true,
              description: isModelPlaceholder ? `Model: ${model.name}` : pos.description 
          }; 
          existingMap.delete(symbol);
      }
      newPositions.push(pos);
    }
    existingMap.forEach((pos: any) => newPositions.push({ ...pos, targetPct: 0, targetEdited: true }));
    setPositions(newPositions); 
    setShowModelModal(false);
    setIsAddingTicker(false);
    onUpdateClient({ ...client, positions: newPositions, lastUpdated: new Date().toISOString() });
  };

  useEffect(() => {
    if (positions.length > 0) { setIsLive(true); fetchPrices(); }
    const timer = setInterval(fetchPrices, REFRESH_INTERVAL);
    return () => clearInterval(timer);
  }, [positions.length]);

  const fetchPrices = async () => {
    const nonCash = positions.filter(p => !CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)));
    if (nonCash.length === 0) return;

    const uniqueSymbols = [...new Set(nonCash.map(p => p.symbol))];
    const now = Date.now();
    const updates = new Map(); 

    try {
        await Promise.all(uniqueSymbols.map(async (sym) => {
            const cached = GLOBAL_QUOTE_CACHE.get(sym);
            if (cached && (now - cached.timestamp < QUOTE_CACHE_TTL)) {
                updates.set(sym, cached);
                return;
            }

            try {
                const data = await fetchFinnhub(`quote?symbol=${sym}`);
                const fallbackYield = nonCash.find(p => p.symbol === sym)?.yield || 0;
                let dividendYield = fallbackYield;

                try {
                    const metricsData = await fetchFinnhub(`stock/metric?symbol=${sym}&metric=all`);
                    if (metricsData.metric && metricsData.metric.currentDividendYieldTTM) {
                        dividendYield = metricsData.metric.currentDividendYieldTTM;
                    }
                } catch(e) {}

                if (data.c > 0) {
                    const entry = { price: data.c, yield: dividendYield, prevClose: data.pc || data.c, timestamp: now };
                    GLOBAL_QUOTE_CACHE.set(sym, entry);
                    updates.set(sym, entry);
                }
            } catch(e) {
                if (cached) updates.set(sym, cached);
            }
        }));

        setPositions(prev => prev.map(p => {
            const update = updates.get(p.symbol);
            if (update) {
                return { 
                    ...p, 
                    price: update.price, 
                    prevClose: update.prevClose,
                    currentValue: p.quantity * update.price, 
                    yield: update.yield
                };
            }
            return p;
        }));
    } catch (err) { setIsLive(false); }
  };

  const addTicker = async () => {
    if (!newTicker.trim()) return;
    setIsAddingTicker(true);
    const symbols = newTicker.split(/[\s,]+/).filter(s => s.trim().length > 0);
    try {
      const newItems = await Promise.all(symbols.map(async (sym) => {
        const symbol = sym.trim().toUpperCase();
        const res = await fetchFinnhub(`quote?symbol=${symbol}`);
        let initYield = 0;
        try {
              const metrics = await fetchFinnhub(`stock/metric?symbol=${symbol}&metric=all`);
              initYield = metrics.metric?.currentDividendYieldTTM || 0;
        } catch(e) {}
        return { id: generateId(), symbol, description: `Added: ${symbol}`, quantity: 0, price: res.c || 0, currentValue: 0, yield: initYield, targetPct: 0, roundingMode: 'exact', metadata: null };
      }));
      setPositions(prev => [...prev, ...newItems]); setNewTicker('');
    } finally { setIsAddingTicker(false); }
  };

  const handleEnrich = async (overridePositions?: any) => {
    const targetPositions = overridePositions || positions;
    setIsEnriching(true);
    try {
      const stocks = targetPositions.filter(p => !CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)));
      if (stocks.length === 0) return;
      const tickers = stocks.map(p => `${p.symbol}: ${p.description}`).join('\n');
      const systemPrompt = `
        You are a financial data engine.
        For each ticker, return a JSON object keyed by the exact ticker symbol provided.
        Each value must be an object with these exact keys: 'assetClass', 'style', 'sector', 'country', 'logoTicker', 'stateCode'.
        **CRITICAL FOR MUNICIPAL BONDS:**
        - Identify the US State of the issuer (e.g. "MIAMI-DADE" -> "FL", "MICHIGAN ST HSG" -> "MI").
        - Return the 2-letter US State code in 'stateCode'.
        - If not a municipal bond, 'stateCode' should be null.
        **CRITICAL FOR CORPORATE BONDS:**
        - Identify the parent company/issuer of the bond.
        - Return the stock ticker of that issuer in the 'logoTicker' field.
        - Example: "WELLS FARGO & CO" -> "WFC", "MICROCHIP TECH" -> "MCHP", "LEIDOS" -> "LDOS".
        - If it is a standard stock/ETF, 'logoTicker' should be null or the same as the symbol.
        **CRITICAL FOR ETFs & MUTUAL FUNDS:**
        - You MUST reference the "Morningstar Style Box" methodology to determine the 'style' field.
        - 1. assetClass options: "U.S. Equity", "Non-U.S. Equity", "Fixed Income", "Municipal Bond", "Other".
        - 2. style options: "Large-Value", "Large-Core", "Large-Growth", "Mid-Value", "Mid-Core", "Mid-Growth", "Small-Value", "Small-Core", "Small-Growth".
        - 3. sector options: "Technology", "Healthcare", "Financial Services", "Real Estate", "Energy", "Industrials", "Communication Services", "Consumer Defensive", "Consumer Cyclical", "Utilities", "Basic Materials".
        - 4. country: The primary country or region of risk.
        
        You must return a single, flat JSON object where the keys are the exact ticker symbols provided. Example structure: { "AAPL": { "assetClass": "U.S. Equity", "style": "Large-Growth", "sector": "Technology", "country": "United States", "logoTicker": null, "stateCode": null } }
      `;
      const result = await callGemini(`Classify these assets:\n${tickers}`, systemPrompt, true);
      const cleanResult = result.replace(/```json\n?|```/g, '').trim();
      const enrichment = JSON.parse(cleanResult);
      
      const next = targetPositions.map(p => {
        const isCash = CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t));
        if (isCash) return { ...p, metadata: { assetClass: 'Cash', sector: 'Cash', country: 'United States', style: 'Mid-Core' }};
        const aiData = enrichment[p.symbol] || enrichment[p.symbol.toUpperCase()] || {};
        return { 
          ...p, 
          metadata: { 
            assetClass: aiData.assetClass || 'Not Classified', 
            sector: aiData.sector || 'Misc', 
            country: aiData.country || 'United States', 
            style: aiData.style || 'Mid-Core',
            logoTicker: aiData.logoTicker || null, 
            stateCode: aiData.stateCode || null 
          } 
        };
      });
      setPositions(next); 
      onUpdateClient({ ...client, positions: next, lastUpdated: new Date().toISOString() });
    } catch (e) {
        console.error("AI Enrichment Failed", e);
        const fallbackPositions = targetPositions.map(p => {
            if (p.metadata && p.metadata.assetClass !== 'Not Classified') return p; 
            
            const desc = (p.description || "").toUpperCase();
            const isBondPos = isBond(p.symbol, desc);
           
            let fallbackMeta = { 
                assetClass: isBondPos ? 'Fixed Income' : 'U.S. Equity',
                sector: 'Unclassified',
                country: 'United States',
                style: 'Mid-Core',
                logoTicker: null,
                stateCode: null
            };

            if (desc.includes("INTL") || desc.includes("EMERGING")) fallbackMeta.assetClass = "Non-U.S. Equity";
            if (desc.includes("TECH")) fallbackMeta.sector = "Technology";
            if (desc.includes("HEALTH") || desc.includes("PHARM")) fallbackMeta.sector = "Healthcare";
            if (desc.includes("BANK") || desc.includes("FIN")) fallbackMeta.sector = "Financial Services";
            if (desc.includes("UTIL") || desc.includes("PWR")) fallbackMeta.sector = "Utilities";
            
            return { ...p, metadata: fallbackMeta };
        });
        setPositions(fallbackPositions);
        onUpdateClient({ ...client, positions: fallbackPositions, lastUpdated: new Date().toISOString() });

    } finally { setIsEnriching(false); }
  };

  const processFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
        const parsed = parseFidelityCSV(evt.target.result as string);
        const uniqueSymbols = [...new Set(parsed
            .filter(p => !(CASH_TICKERS.some(t => p.symbol.includes(t)) || (p.description && p.description.toUpperCase().includes("CASH"))))
            .map(p => p.symbol)
        )];

        const priceMap = new Map();
        try {
            await Promise.all(uniqueSymbols.map(async (symbol) => {
                try {
                    const data = await fetchFinnhub(`quote?symbol=${symbol}`);
                    if (data.c) priceMap.set(symbol, data.c);
                } catch(e) {}
            }));
        } catch(e) {}

        const liveParsed = parsed.map(p => {
             const isCash = CASH_TICKERS.some(t => p.symbol.includes(t)) || (p.description && p.description.toUpperCase().includes("CASH"));
             const isFixedIncome = isBond(p.symbol, p.description);
             let price = p.price; 
             
             if (isCash) {
                 price = 1.0;
             } else if (priceMap.has(p.symbol)) {
                 price = priceMap.get(p.symbol);
             }
             
             let val = p.quantity * price;
             if (isFixedIncome) {
                 val = (p.quantity * price) / 100;
             }
             
             return { ...p, price: price, currentValue: val };
        });

        const totalVal = liveParsed.reduce((sum, p) => sum + (p.currentValue || 0), 0);
        const hasNonCashPositions = positions.some(p => !CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)));
        const existingMap = new Map();
        if (hasNonCashPositions) {
            positions.forEach(p => {
                if (p.targetPct && p.targetPct > 0) {
                    existingMap.set(p.symbol, p.targetPct);
                }
            });
        }

        const merged = liveParsed.map(p => {
            const currentWeight = totalVal > 0 ? (p.currentValue / totalVal) * 100 : 0;
            const targetPct = existingMap.has(p.symbol) ? existingMap.get(p.symbol) : currentWeight;
            return { ...p, targetPct };
        });

        setPositions(merged); 
        onUpdateClient({ ...client, positions: merged, lastUpdated: new Date().toISOString() });
        handleEnrich(merged);
    };
    reader.readAsText(file);
  };

  const handleFileUpload = (e) => {
      processFile(e.target.files[0]);
  };

  const handleDragOver = (e) => {
      e.preventDefault();
      setIsDragging(true);
  };

  const handleDragLeave = (e) => {
      e.preventDefault();
      setIsDragging(false);
  };

  const handleDrop = (e) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          processFile(e.dataTransfer.files[0]);
      }
  };

  const displayPositions = useMemo(() => {
    const rawStocks = positions.filter(p => !CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)));
    const rawCash = positions.filter(p => CASH_TICKERS.some(t => p.symbol.toUpperCase().includes(t)));
    const stocks = rawStocks.map(p => {
      const currentPct = totalValue > 0 ? (Number(p.currentValue) || 0) / totalValue : 0;
      const activeTargetPct = p.targetEdited ? ((Number(p.targetPct) || 0) / 100) : currentPct;
      let targetValue = totalValue * activeTargetPct;
      let tradeValue = targetValue - (Number(p.currentValue) || 0);
      if (Math.abs(tradeValue) < 0.01) tradeValue = 0;

      const isBondPos = isBond(p.symbol, p.description);
      let tradeShares = 0;
      
      const currentVal = Number(p.currentValue) || 0;
      const costBasis = Number(p.costBasis) || currentVal;
      const unrealizedGL = currentVal - costBasis;
      const unrealizedGLPct = costBasis > 0 ? (unrealizedGL / costBasis) : 0;

      const prevClose = Number(p.prevClose) || p.price;
      const todayGLPerShare = p.price - prevClose;
      const todayGL = todayGLPerShare * p.quantity;
      const todayGLPct = prevClose > 0 ? (todayGLPerShare / prevClose) : 0;

      if (p.price > 0) {
        if (isBondPos) {
            tradeShares = (tradeValue * 100) / p.price;
        } else {
            tradeShares = tradeValue / p.price;
        }
        
        if (p.roundingMode === '0.5') {
            tradeShares = Math.round(tradeShares * 2) / 2;
            tradeValue = isBondPos ? (tradeShares * p.price) / 100 : tradeShares * p.price;
            targetValue = (Number(p.currentValue) || 0) + tradeValue;
        } else if (p.roundingMode === '1.0') {
            tradeShares = Math.round(tradeShares);
            tradeValue = isBondPos ? (tradeShares * p.price) / 100 : tradeShares * p.price;
            targetValue = (Number(p.currentValue) || 0) + tradeValue;
        }
      }

      return { ...p, currentPct, actualTargetValue: targetValue, actualTargetPct: totalValue > 0 ? (targetValue / totalValue) * 100 : 0, tradeValue, tradeShares, costBasis, unrealizedGL, unrealizedGLPct, todayGL, todayGLPct, prevClose, displayTargetPct: activeTargetPct * 100 };
    });

    if (sortConfig.key) { 
        stocks.sort((a,b) => a[sortConfig.key] < b[sortConfig.key] ? (sortConfig.direction==='asc'?-1:1) : (sortConfig.direction==='asc'?1:-1));
    }
    
    let cashPositions = rawCash.reduce((acc: any[], curr) => {
        const existing = acc.find(p => p.symbol === curr.symbol);
        if (existing) {
            existing.currentValue += (Number(curr.currentValue) || 0);
            existing.quantity += (Number(curr.quantity) || 0);
        } else {
            acc.push({ ...curr, currentValue: Number(curr.currentValue) || 0, quantity: Number(curr.quantity) || 0 });
        }
        return acc;
    }, []).map((p: any) => {
      const currentPct = totalValue > 0 ? p.currentValue / totalValue : 0;
      const activeTargetPct = p.targetEdited ? ((Number(p.targetPct) || 0) / 100) : currentPct;
      let targetValue = totalValue * activeTargetPct;
      let tradeValue = targetValue - p.currentValue;
      if (Math.abs(tradeValue) < 0.01) tradeValue = 0;

      return {
          ...p,
          isCash: true,
          currentPct,
          actualTargetValue: targetValue,
          tradeValue,
          targetPct: p.targetPct, // Preserve the typed target
          tradeShares: tradeValue, // For cash, $1 = 1 share
          todayGL: 0,
          todayGLPct: 0,
          prevClose: 1.0,
          price: 1.0,
          displayTargetPct: activeTargetPct * 100
      };
    });

    if (cashPositions.length === 0) {
      const defaultCash = positions.find(p => p.id === 'CASH_DEFAULT');
      const targetEdited = defaultCash?.targetEdited || false;
      const activeTargetPct = targetEdited ? ((Number(defaultCash?.targetPct) || 0) / 100) : 0;
      let targetValue = totalValue * activeTargetPct;

      cashPositions.push({
          id: 'CASH_DEFAULT',
          symbol: 'FCASH',
          description: 'Money Market',
          quantity: 0,
          price: 1.00,
          currentValue: 0,
          yield: 0,
          currentPct: 0,
          targetPct: defaultCash?.targetPct || 0,
          targetEdited: targetEdited,
          actualTargetValue: targetValue,
          tradeValue: targetValue,
          tradeShares: targetValue,
          isCash: true,
          todayGL: 0,
          todayGLPct: 0,
          prevClose: 1.0,
          displayTargetPct: activeTargetPct * 100
      });
    }

    const assetClassStats = (() => {
      if (client.accountType === 'Bond Ladder' || client.accountType === 'Money Market' || client.isMoneyMarket) return null;

      const groups = {
        'Covered Calls': { currentValue: 0, targetValue: 0 },
        'Bond Funds': { currentValue: 0, targetValue: 0 },
        'Bonds': { currentValue: 0, targetValue: 0 },
        'Equity Funds': { currentValue: 0, targetValue: 0 },
        'Stocks': { currentValue: 0, targetValue: 0 }
      };

      stocks.forEach(p => {
        const manualBucket = assetOverrides[p.symbol]?.bucket;
        const isC = CASH_TICKERS.some(t => p.symbol.includes(t)) || (p.description && p.description.toUpperCase().includes('CASH')) || p.metadata?.assetClass === 'Cash';
        const isCc = manualBucket === 'Covered Call' || (!manualBucket && isCoveredCall(p));
        const isFi = manualBucket === 'Bond' || manualBucket === 'Bond Fund' || (!manualBucket && (p.metadata?.assetClass === 'Fixed Income' || p.metadata?.assetClass === 'Municipal Bond' || isBond(p.symbol, p.description)));
        const isF = manualBucket === 'Equity Fund' || manualBucket === 'Bond Fund' || (!manualBucket && ((p.symbol.length === 5 && p.symbol.endsWith('X')) || (p.description && /\b(ETF|FUND|TRUST)\b/i.test(p.description))));
        
        let groupKey = 'Stocks';
        if (isCc) groupKey = 'Covered Calls';
        else if (isFi) {
            if (isF) groupKey = 'Bond Funds';
            else groupKey = 'Bonds';
        } else if (isF) {
            groupKey = 'Equity Funds';
        }

        groups[groupKey].currentValue += (Number(p.currentValue) || 0);
        groups[groupKey].targetValue += (Number(p.actualTargetValue) || 0);
      });

      return Object.entries(groups).map(([name, data]) => ({
        name,
        currentValue: data.currentValue,
        currentPct: totalValue > 0 ? (data.currentValue / totalValue) * 100 : 0,
        targetValue: data.targetValue,
        tradeDelta: data.targetValue - data.currentValue
      }));
    })();

    const modularGroups = (() => {
      const groups = {
        'Stocks': [],
        'Equity Funds': [],
        'Covered Calls': [],
        'Bonds': [],
        'Bond Funds': [],
        'Cash & Cash Alternatives': cashPositions
      };

      stocks.forEach(p => {
        const manualBucket = assetOverrides[p.symbol]?.bucket;
        const isCc = manualBucket === 'Covered Call' || (!manualBucket && isCoveredCall(p));
        const isFi = manualBucket === 'Bond' || manualBucket === 'Bond Fund' || (!manualBucket && (p.metadata?.assetClass === 'Fixed Income' || p.metadata?.assetClass === 'Municipal Bond' || isBond(p.symbol, p.description)));
        const isF = manualBucket === 'Equity Fund' || manualBucket === 'Bond Fund' || (!manualBucket && ((p.symbol.length === 5 && p.symbol.endsWith('X')) || (p.description && /\b(ETF|FUND|TRUST)\b/i.test(p.description))));

        if (isCc) groups['Covered Calls'].push(p);
        else if (isFi) {
          if (isF) groups['Bond Funds'].push(p);
          else groups.Bonds.push(p);
        } else if (isF) {
          groups['Equity Funds'].push(p);
        } else {
          groups.Stocks.push(p);
        }
      });

      const hasSpecifiedTargets = client.settings?.hasSpecifiedTargets || false;

      return Object.entries(groups).map(([name, items]) => {
        const groupValue = (items as any[]).reduce((sum: number, p: any) => sum + (Number(p.currentValue) || 0), 0);
        const groupTargetValue = (items as any[]).reduce((sum: number, p: any) => sum + (Number(p.actualTargetValue) || 0), 0);
        const currentPct = totalValue > 0 ? (groupValue / totalValue) * 100 : 0;
        
        // Link target weight to allocationTargets
        let targetWeight = 0;
        if (hasSpecifiedTargets) {
            if (name === 'Bonds') {
              targetWeight = client.allocationTargets?.fixedIncome || 0;
            } else if (name === 'Bond Funds') {
              targetWeight = client.allocationTargets?.fixedIncome || 0;
            } else if (name === 'Stocks') {
              targetWeight = client.allocationTargets?.equity || 0;
            } else if (name === 'Equity Funds') {
              targetWeight = client.allocationTargets?.equity || 0;
            } else if (name === 'Covered Calls') {
              targetWeight = client.allocationTargets?.coveredCall || 0;
            } else if (name === 'Cash & Cash Alternatives') {
              targetWeight = client.allocationTargets?.cash || 0;
            }
        } else {
            targetWeight = currentPct;
        }

        let recommendedDelta = (totalValue * (targetWeight / 100)) - groupValue;
        
        if (!hasSpecifiedTargets) {
            recommendedDelta = 0;
        } else if (Number(targetWeight).toFixed(2) === currentPct.toFixed(2)) {
            // Snap to zero to prevent ghost trades from rounding discrepancies
            recommendedDelta = 0;
        }
        
        const plannedDelta = groupTargetValue - groupValue;
        const remainingDelta = recommendedDelta - plannedDelta;

        return {
          name,
          items,
          currentValue: groupValue,
          targetValue: groupTargetValue,
          tradeDelta: groupTargetValue - groupValue,
          currentPct: currentPct,
          targetWeight: targetWeight,
          recommendedDelta,
          recommendedDeltaPct: totalValue > 0 ? (recommendedDelta / totalValue) * 100 : 0,
          plannedDelta,
          plannedDeltaPct: totalValue > 0 ? (plannedDelta / totalValue) * 100 : 0,
          remainingDelta,
          remainingDeltaPct: totalValue > 0 ? (remainingDelta / totalValue) * 100 : 0
        };
      }).filter(g => g.name === 'Cash & Cash Alternatives' || g.items.length > 0);
    })();

    return { stocks, cashPositions, assetClassStats, modularGroups };
  }, [positions, totalValue, sortConfig, client.accountType, client.isMoneyMarket, client.allocationTargets]);

  const totals = useMemo(() => {
      const all = [...displayPositions.stocks, ...displayPositions.cashPositions];
      const calculatedYield = all.reduce((acc, p) => {
          const weight = p.currentPct || 0;
          const y = p.yield || 0;
          return acc + (y * weight);
      }, 0);

      const todayGL = all.reduce((s, p) => s + (p.todayGL || 0), 0);
      const totalPrevClose = all.reduce((s, p) => s + ((Number(p.prevClose) || p.price) * p.quantity), 0);
      const todayGLPct = totalPrevClose > 0 ? (todayGL / totalPrevClose) : 0;

      return {
          value: all.reduce((s, p) => s + (p.currentValue || 0), 0),
          costBasis: all.reduce((s, p) => s + (p.costBasis || 0), 0),
          unrealizedGL: all.reduce((s, p) => s + (p.unrealizedGL || 0), 0),
          weight: all.reduce((s, p) => s + (p.currentPct || 0), 0),
          targetPct: all.reduce((s, p) => s + (p.targetPct || 0), 0),
          targetValue: all.reduce((s, p) => s + (p.actualTargetValue || 0), 0),
          tradeValue: all.reduce((s, p) => s + (p.tradeValue || 0), 0),
          weightedYield: calculatedYield,
          todayGL,
          todayGLPct
      };
  }, [displayPositions]);

  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
    else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      setSortConfig({ key: null, direction: 'asc' });
      return;
    }
    setSortConfig({ key, direction });
  };

  useEffect(() => {
      if (activeViewType !== 'custom') {
          localStorage.setItem('rebalance_layout', JSON.stringify(layout));
      }
  }, [layout, activeViewType]);

  const handleResizeStart = (e, colId) => {
      e.preventDefault();
      startResizeRef.current = { id: colId, startX: e.clientX, startWidth: layout.find(c => c.id === colId).width };
      document.addEventListener('mousemove', handleResizeMove);
      document.addEventListener('mouseup', handleResizeEnd);
  };
  
  const handleResizeMove = useCallback((e) => {
      if (!startResizeRef.current) return;
      const { id, startX, startWidth } = startResizeRef.current;
      const newWidth = Math.max(100, startWidth + (e.clientX - startX));
      setLayout(prev => prev.map(col => col.id === id ? { ...col, width: newWidth } : col));
      if (activeViewType === 'custom') setHasUnsavedCustomChanges(true);
  }, [activeViewType, setHasUnsavedCustomChanges]);
  
  const handleResizeEnd = useCallback(() => {
      startResizeRef.current = null;
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeEnd);
  }, [handleResizeMove]);

  const updateLayout = (newLayout) => {
      setLayout(newLayout);
      if (activeViewType === 'custom') {
          setHasUnsavedCustomChanges(true);
      }
  };

  const handleToggleBucket = (id) => {
      const settings = client.settings || {};
      const currentHidden = settings.hiddenBuckets || ['coveredCall'];
      const newHidden = currentHidden.includes(id) 
          ? currentHidden.filter(h => h !== id)
          : [...currentHidden, id];
          
      onUpdateClient({
          ...client,
          settings: { ...settings, hiddenBuckets: newHidden },
          positions, // Preserves local state
          lastUpdated: new Date().toISOString()
      });
  };

  const handleDeletePos = (id) => {
    if (confirmDeleteId === id) {
      const newPos = positions.filter(p => p.id !== id);
      setPositions(newPos);
      setConfirmDeleteId(null);
      onUpdateClient({ ...client, positions: newPos, lastUpdated: new Date().toISOString() });
    } else {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  const handleTargetPctChange = (id, val) => {
    let nextPositions = [...positions];
    if (id === 'CASH_DEFAULT' && !nextPositions.find(p => p.id === 'CASH_DEFAULT')) {
        nextPositions.push({ id: 'CASH_DEFAULT', symbol: 'FCASH', description: 'Money Market', quantity: 0, price: 1.00, currentValue: 0, yield: 0, isCash: true, targetEdited: true });
    }
    if (val === '') {
      nextPositions = nextPositions.map(p => p.id === id ? { ...p, targetPct: 0, targetEdited: false } : p);
    } else {
      nextPositions = nextPositions.map(p => p.id === id ? { ...p, targetPct: parseFloat(val) || 0, targetEdited: true } : p);
    }
    setPositions(nextPositions);
  };

  const handleTargetValueChange = (id, val) => {
    let nextPositions = [...positions];
    if (id === 'CASH_DEFAULT' && !nextPositions.find(p => p.id === 'CASH_DEFAULT')) {
        nextPositions.push({ id: 'CASH_DEFAULT', symbol: 'FCASH', description: 'Money Market', quantity: 0, price: 1.00, currentValue: 0, yield: 0, isCash: true, targetEdited: true });
    }
    const num = parseFloat(val) || 0;
    const newPct = totalValue > 0 ? (num / totalValue) * 100 : 0;
    setPositions(nextPositions.map(p => p.id === id ? { ...p, targetPct: newPct, targetEdited: true } : p));
  };

  const setRoundingMode = (id, mode) => {
    setPositions(positions.map(p => p.id === id ? { ...p, roundingMode: mode } : p));
  };

  const renderCell = (col, p) => {
      const isZero = (val: any) => !val || val === 0 || val === '0.00' || val === '$0.00' || val === '0.00%' || val === '--';
      const dimClass = (val: any) => isZero(val) ? 'text-zinc-700/50' : 'text-zinc-300';
      const compactClass = compactMode ? 'p-2 text-xs' : 'p-4 text-sm';

      switch(col.id) {
          case 'symbol': {
              const flag = client.tradeFlags?.[p.symbol];
              const flagClass = flag === 'buy' ? 'border-l-2 border-green-500 bg-green-500/5' : flag === 'sell' ? 'border-l-2 border-red-500 bg-red-500/5' : 'border-l-2 border-transparent';
              return (
                  <div className={`flex items-center gap-4 h-full w-full ${compactMode ? 'gap-2 p-2' : 'p-4'} ${flagClass}`}>
                      <CompanyLogo symbol={p.symbol} description={p.description} logoTicker={p.metadata?.logoTicker} stateCode={p.metadata?.stateCode} isLoading={isEnriching} className={compactMode ? 'h-8 w-8' : 'h-10 w-10'} />
                      <div className="flex flex-col">
                          <div className="flex items-center gap-2">
                              <span className={`font-black text-white ${compactMode ? 'text-xs' : 'text-sm'}`}>{p.symbol}</span>
                              {flag === 'buy' && <span className="text-[8px] uppercase tracking-widest px-1 rounded bg-green-500/20 text-green-400">BUY</span>}
                              {flag === 'sell' && <span className="text-[8px] uppercase tracking-widest px-1 rounded bg-red-500/20 text-red-400">SELL</span>}
                          </div>
                          <span className={`text-[11px] text-zinc-500 truncate max-w-[120px] ${compactMode ? 'text-[9px]' : ''}`}>{p.description}</span>
                      </div>
                  </div>
              );
          }
          case 'issuer': return <span className={`text-zinc-400 font-medium truncate ${compactMode ? 'text-xs' : ''}`}>{p.issuer || '--'}</span>;
          case 'maturityDate': return <span className={`text-zinc-400 font-medium ${compactMode ? 'text-xs' : ''}`}>{p.maturityDate || '--'}</span>;
          case 'quantity': return <span className={`font-medium ${dimClass(formatQuantity(p.quantity))} ${compactMode ? 'text-xs' : ''}`}>{formatQuantity(p.quantity)}</span>;
          case 'price': return <span className={`font-medium ${dimClass(formatCurrency(p.price))} ${compactMode ? 'text-xs' : ''}`}>{formatCurrency(p.price)}</span>;
          case 'currentValue': return <span className={`font-bold text-white ${compactMode ? 'text-xs' : ''}`}>{formatCurrency(p.currentValue)}</span>;
          case 'costBasis': return <span className={`font-medium ${dimClass(formatCurrency(p.costBasis))} ${compactMode ? 'text-xs' : ''}`}>{formatCurrency(p.costBasis)}</span>;
          case 'unrealizedGL': return <span className={`font-mono font-bold ${p.unrealizedGL > 0 ? 'text-green-500' : p.unrealizedGL < 0 ? 'text-red-500' : 'text-zinc-500'} ${compactMode ? 'text-xs' : ''}`}>{formatCurrency(p.unrealizedGL)}</span>;
          case 'unrealizedGLPct': return <span className={`font-mono font-bold ${p.unrealizedGLPct > 0 ? 'text-green-500' : p.unrealizedGLPct < 0 ? 'text-red-500' : 'text-zinc-500'} ${compactMode ? 'text-xs' : ''}`}>{p.unrealizedGLPct > 0 ? '+' : ''}{(p.unrealizedGLPct * 100).toFixed(2)}%</span>;
          case 'todayGL': return <span className={`font-mono font-bold ${p.todayGL > 0 ? 'text-green-500' : p.todayGL < 0 ? 'text-red-500' : 'text-zinc-500'} ${compactMode ? 'text-xs' : ''}`}>{formatCurrency(p.todayGL)}</span>;
          case 'todayGLPct': return <span className={`font-mono font-bold ${p.todayGLPct > 0 ? 'text-green-500' : p.todayGLPct < 0 ? 'text-red-500' : 'text-zinc-500'} ${compactMode ? 'text-xs' : ''}`}>{p.todayGLPct > 0 ? '+' : ''}{(p.todayGLPct * 100).toFixed(2)}%</span>;
          case 'yield': return (
             <div className="relative w-full h-full p-0 hover:bg-zinc-900 cursor-pointer border border-transparent hover:border-zinc-700 transition-colors">
                <input type="number" onFocus={(e) => e.target.select()} className={`w-full h-full bg-transparent text-right font-mono text-zinc-500 focus:text-white focus:outline-none ${compactMode ? 'p-2 text-[10px]' : 'p-4 text-xs'}`} value={p.yield || ''} placeholder="--" onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    setPositions(positions.map(x => x.id === p.id ? { ...x, yield: val } : x));
                }} /><span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] text-zinc-600 pointer-events-none">%</span>
             </div>
          );
          case 'currentPct': return <span className={`text-zinc-300 font-bold ${compactMode ? 'text-xs' : ''}`}>{formatPercent(p.currentPct)}</span>;
          case 'targetPct': return <div className="h-full bg-blue-600/5 hover:bg-blue-600/10"><input type="number" onFocus={(e) => e.target.select()} className={`w-full h-full bg-transparent text-right font-mono text-blue-300 font-bold focus:outline-none cursor-pointer ${compactMode ? 'p-2 text-xs' : 'p-4'}`} value={p.targetEdited ? (p.targetPct ?? '') : p.displayTargetPct?.toFixed(2) || ''} onChange={e => handleTargetPctChange(p.id, e.target.value)} placeholder="0.0" /></div>;
          case 'actualTargetValue': return <div className="h-full bg-blue-600/5 hover:bg-blue-600/10"><input type="number" onFocus={(e) => e.target.select()} className={`w-full h-full bg-transparent text-right font-mono text-blue-300 font-bold focus:outline-none cursor-pointer ${compactMode ? 'p-2 text-xs' : 'p-4'}`} value={Math.round(totalValue * (p.targetPct/100)) || ''} onChange={e => handleTargetValueChange(p.id, e.target.value)} placeholder="0" /></div>;
          case 'tradeValue': return <span className={`font-mono font-black ${p.tradeValue > 0 ? 'text-green-500' : p.tradeValue < 0 ? 'text-red-500' : 'text-zinc-800'} ${compactMode ? 'text-xs' : ''}`}>{p.tradeValue !== 0 ? formatCurrency(p.tradeValue) : '--'}</span>;
          case 'tradeShares': return p.isCash ? <span className="font-mono text-zinc-700">--</span> : (
            <div className={`flex flex-col items-end gap-1.5 ${compactMode ? 'p-1' : 'p-3'}`}>
                <span className={`font-mono font-black ${p.tradeValue > 0 ? 'text-green-500' : p.tradeValue < 0 ? 'text-red-500' : 'text-zinc-800'} ${compactMode ? 'text-xs' : ''}`}>
                    {p.tradeShares !== 0 ? (p.tradeShares > 0 ? '+' : '') + formatQuantity(p.tradeShares) : '--'}
                </span>
                <div className="flex bg-zinc-900 rounded-lg p-0.5 border border-zinc-800">
                    {['exact', '0.5', '1.0'].map(mode => (
                        <button 
                            key={mode} 
                            onClick={() => setRoundingMode(p.id, mode)} 
                            className={`px-2 py-0.5 text-[9px] font-bold rounded transition-colors ${p.roundingMode === mode ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:text-zinc-400'}`}
                        >
                            {mode === 'exact' ? 'EXACT' : mode}
                        </button>
                    ))}
                </div>
            </div>
          );
          case 'actions': return (
              <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleDeletePos(p.id)} className="text-zinc-600 hover:text-red-500 transition-colors p-1 rounded hover:bg-zinc-800">
                      <Trash2 className="h-4 w-4" />
                  </button>
              </div>
          );
          default: return null;
      }
  };

  const visibleCols = columns.filter(c => c.visible);

  return (
    <div 
        className="flex-1 flex flex-col bg-zinc-950 overflow-hidden relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
    >
        {isDragging && (
            <div className="absolute inset-0 z-50 bg-blue-900/20 backdrop-blur-sm border-4 border-dashed border-blue-500 flex items-center justify-center pointer-events-none">
                <div className="text-3xl font-black text-blue-400 tracking-tighter flex items-center gap-4">
                    <Upload className="h-10 w-10" /> Drop CSV to Import
                </div>
            </div>
        )}
        {!isAggregated && (
            <div className="px-8 py-2 flex items-center justify-between border-b border-zinc-900 shrink-0">
                <div className="flex items-center group gap-2">
                    {isEditingName ? (
                        <div className="flex items-center gap-2">
                            <input
                                ref={nameInputRef}
                                className="bg-zinc-900 border border-blue-500 text-sm font-bold text-white rounded px-2 py-1 focus:outline-none"
                                value={tempName}
                                onChange={e => setTempName(e.target.value)}
                                onBlur={handleSaveName}
                                onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                            />
                            <button onClick={handleSaveName} className="text-green-500 hover:text-green-400"><Check className="h-4 w-4" /></button>
                        </div>
                    ) : (
                        <div className="flex flex-col">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-black uppercase tracking-widest text-zinc-500">{client.name}</span>
                                <button onClick={() => { setIsEditingName(true); setTempName(client.name); }} className="text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100"><Pencil className="h-3 w-3" /></button>
                                <button onClick={() => setShowProfileModal(true)} className="text-zinc-600 hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-opacity"><User className="h-4 w-4" /></button>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="flex items-center gap-2 group/acc">
                                    {isEditingAccNum ? (
                                        <input 
                                            autoFocus 
                                            className="bg-zinc-900 border border-blue-500 text-[10px] text-white px-2 py-0.5 rounded font-mono focus:outline-none"
                                            value={tempAccNum}
                                            onChange={e => setTempAccNum(e.target.value)}
                                            onBlur={() => {
                                                onUpdateClient({ ...client, accountNumber: tempAccNum });
                                                setIsEditingAccNum(false);
                                            }}
                                            onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
                                            onFocus={(e) => e.target.select()}
                                        />
                                    ) : (
                                        <div className="flex items-center gap-2">
                                            <p 
                                                onClick={() => { setTempAccNum(client.accountNumber || ''); setIsEditingAccNum(true); }} 
                                                className="text-xs font-black uppercase tracking-widest text-zinc-500 mt-1 cursor-pointer hover:text-zinc-300 transition-colors"
                                            >
                                                Acct: {client.accountNumber || client.profile?.accountNumber || 'N/A'}
                                            </p>
                                            <Pencil onClick={() => { setTempAccNum(client.accountNumber || ''); setIsEditingAccNum(true); }} className="h-3 w-3 text-zinc-700 cursor-pointer opacity-0 group-hover/acc:opacity-100 transition-opacity mt-1" />
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <div className="flex items-center gap-3">
                    {client.lastUpdated && (
                        <span className="text-[10px] text-zinc-500 mr-4">Last edited: {new Date(client.lastUpdated).toLocaleDateString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    )}
                    {!isAggregated && (
                        <div className="relative">
                            <select
                                value={client.accountType || 'Unclassified'}
                                onChange={(e) => onUpdateClient({ ...client, accountType: e.target.value, lastUpdated: new Date().toISOString() })}
                                className="appearance-none bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 px-4 py-1.5 pr-8 rounded-full text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-700"
                            >
                                <option value="Unclassified">Unclassified</option>
                                <option value="Model Portfolio">Model Portfolio</option>
                                <option value="Bespoke Portfolio">Bespoke Portfolio</option>
                                <option value="Money Market">Money Market</option>
                                <option value="Bond Ladder">Bond Ladder</option>
                            </select>
                            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3 w-3 text-zinc-500 pointer-events-none" />
                        </div>
                    )}
                    {onDeleteAccount && (
                        <button 
                            onClick={() => {
                                if (confirmDelete) onDeleteAccount();
                                else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 3000); }
                            }} 
                            className={`transition-colors p-2 rounded-lg flex items-center justify-center ${confirmDelete ? 'bg-red-600 text-white w-24' : 'text-red-900 hover:text-red-500 w-8'}`}
                            title="Delete Account"
                        >
                            {confirmDelete ? <span className="text-[10px] font-bold uppercase tracking-widest">Sure?</span> : <Trash2 className="h-4 w-4" />}
                        </button>
                    )}
                    <div className="inline-flex items-center bg-zinc-900 border border-zinc-800 rounded-full shadow-lg overflow-hidden h-8">
                        <label className="flex items-center justify-center cursor-pointer hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 h-full w-8 transition-colors border-r border-zinc-800" title="Import CSV"><Upload className="h-4 w-4"/><input type="file" className="hidden" accept=".csv" onChange={handleFileUpload}/></label>
                        <button onClick={handleResetGoals} className="h-full w-8 flex items-center justify-center hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors border-r border-zinc-800" title="Reset to Original"><RotateCcw className="h-4 w-4"/></button>
                        <button onClick={() => setShowModelModal(true)} className="h-full w-8 flex items-center justify-center hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors border-r border-zinc-800" title="Apply Model"><Layers className="h-4 w-4"/></button>
                        <button onClick={() => handleEnrich()} disabled={isEnriching} className="h-full w-8 flex items-center justify-center hover:bg-zinc-800 text-indigo-400 hover:text-indigo-300 transition-colors border-r border-zinc-800" title="AI Scan"><Sparkles className={`h-4 w-4 ${isEnriching ? 'animate-spin text-indigo-200' : ''}`} /></button>
                        <button onClick={() => setShowSaveModal(true)} className="h-full w-8 flex items-center justify-center hover:bg-blue-900/30 text-blue-500 hover:text-blue-400 transition-colors" title="Save Changes"><Save className="h-4 w-4"/></button>
                    </div>

                    <button onClick={() => setShowSettingsModal(true)} className="h-8 w-8 rounded-full flex items-center justify-center bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors ml-2" title="Dashboard Settings">
                        <Settings className="h-4 w-4" />
                    </button>
                </div>
            </div>
        )}
      <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col bg-zinc-950">
        {/* STICKY TRADE METRICS HEADER */}
        <div className="sticky top-0 z-30 bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 px-8 py-3 flex items-center justify-between shadow-lg">
            <div className="flex items-center gap-8">
                {!isAggregated && (
                    <div className="flex flex-col">
                        <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Total Target %</span>
                        <span className={`text-sm font-black font-mono ${Math.abs(totals.targetPct - 100) < 0.01 ? 'text-green-500' : 'text-amber-500'}`}>
                            {totals.targetPct.toFixed(2)}%
                        </span>
                    </div>
                )}
                {!isAggregated && <div className="h-8 w-px bg-zinc-800" />}
                <div className="flex flex-col">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Total Buys</span>
                    <span className="text-sm font-black font-mono text-blue-400">
                        {formatCurrency(displayPositions.stocks.reduce((sum, p) => sum + (p.tradeValue > 0 ? p.tradeValue : 0), 0))}
                    </span>
                </div>
                <div className="flex flex-col ml-4">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Total Sells</span>
                    <span className="text-sm font-black font-mono text-orange-400">
                        {formatCurrency(Math.abs(displayPositions.stocks.reduce((sum, p) => sum + (p.tradeValue < 0 ? p.tradeValue : 0), 0)))}
                    </span>
                </div>
            </div>
            <div className="flex items-center gap-6">
                <div className="flex items-center gap-2 ml-auto mr-4">
                    {/* Layout Pill */}
                    <div className="flex bg-zinc-900/50 border border-zinc-800 p-1 rounded-full h-9 items-center">
                        {[
                            { id: 'standard', icon: Layout, label: 'Standard' },
                            { id: 'modular', icon: LayoutGrid, label: 'Modular' },
                            { id: 'custom', icon: Settings2, label: globalCustomView.name }
                        ].map(view => (
                            <Tooltip key={view.id} text={view.label}>
                                <button
                                    onClick={() => {
                                        if (view.id === 'custom') {
                                            setActiveViewType('custom');
                                            setViewPreferences(prev => ({ ...prev, layout: 'custom', isCompact: globalCustomView.isCompact }));
                                        } else {
                                            setActiveViewType(view.id);
                                            setViewPreferences(prev => ({ ...prev, layout: view.id }));
                                        }
                                    }}
                                    className={`relative w-8 h-7 rounded-full flex items-center justify-center transition-all ${
                                        activeViewType === view.id 
                                        ? 'bg-blue-600 text-white shadow-lg' 
                                        : 'text-zinc-500 hover:text-zinc-300'
                                    }`}
                                >
                                    <view.icon className="h-3.5 w-3.5" />
                                    {view.id === 'custom' && hasUnsavedCustomChanges && (
                                        <span className="absolute top-0 right-0 h-2 w-2 bg-red-500 rounded-full border border-zinc-950"></span>
                                    )}
                                </button>
                            </Tooltip>
                        ))}
                    </div>

                    {/* Density Toggle */}
                    <div className="flex bg-zinc-900/50 border border-zinc-800 p-1 rounded-full h-9 items-center">
                        <Tooltip text={viewPreferences.isCompact ? "Normal View" : "Compact View"}>
                            <button
                                onClick={() => setViewPreferences(prev => ({ ...prev, isCompact: !prev.isCompact }))}
                                className={`w-8 h-7 rounded-full flex items-center justify-center transition-all ${
                                    viewPreferences.isCompact 
                                    ? 'text-blue-400 bg-blue-400/10' 
                                    : 'text-zinc-500 hover:text-zinc-300'
                                }`}
                            >
                                <List className="h-3.5 w-3.5" />
                            </button>
                        </Tooltip>
                    </div>
                </div>
                <div className="flex flex-col items-end">
                    <span className="text-[9px] font-black text-zinc-500 uppercase tracking-widest mb-0.5">Cash Impact</span>
                    <span className={`text-sm font-black font-mono ${totals.tradeValue > 0 ? 'text-red-400' : 'text-green-400'}`}>
                        {totals.tradeValue > 0 ? '-' : '+'}{formatCurrency(Math.abs(totals.tradeValue))}
                    </span>
                </div>
                <Button 
                    variant="primary" 
                    size="sm" 
                    onClick={() => handleStageTrades(true)}
                    className="rounded-full px-6 h-9 uppercase text-[10px] font-black tracking-widest flex items-center gap-2"
                >
                    Export Trades <FileSpreadsheet className="h-3.5 w-3.5" />
                </Button>
            </div>
        </div>
        <AnalyticsDashboard 
          positions={positions} 
          client={client} 
          onUpdateClient={(updatedClient) => onUpdateClient({ ...updatedClient, positions })} 
          assetOverrides={assetOverrides} 
        />
        <div className="px-8 py-8 max-w-[1600px] w-full mx-auto">
          <InsightsHub positions={positions} />
          
          {/* ASSET CLASS VIEW MODULES */}
          {displayPositions.assetClassStats && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              {displayPositions.assetClassStats.map((group) => (
                <div key={group.name} className="bg-zinc-900/40 backdrop-blur-xl border border-zinc-800 rounded-2xl p-6 flex flex-col justify-between group hover:border-zinc-700 transition-all duration-300 shadow-xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg bg-zinc-800 text-zinc-400`}>
                        {group.name === 'Bonds' ? <LayoutList className="h-4 w-4" /> : 
                         group.name === 'Funds' ? <Layers className="h-4 w-4" /> : 
                         <Activity className="h-4 w-4" />}
                      </div>
                      <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500 group-hover:text-zinc-300 transition-colors">{group.name}</span>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex justify-between items-end">
                      <div className="text-2xl font-black text-white font-mono tracking-tighter">
                        {formatCurrency(group.currentValue)}
                      </div>
                      <div className="text-xs font-bold text-zinc-500 font-mono">
                        {group.currentPct.toFixed(1)}%
                      </div>
                    </div>
                    
                    <div className="pt-2 border-t border-zinc-800/50 flex justify-between items-center">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Target</span>
                        <span className="text-xs font-bold text-blue-400 font-mono">{formatCurrency(group.targetValue)}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[9px] font-black uppercase tracking-widest text-zinc-600">Delta</span>
                        <span className={`text-xs font-bold font-mono ${group.tradeDelta > 0 ? 'text-green-500' : group.tradeDelta < 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                          {group.tradeDelta > 0 ? '+' : ''}{formatCurrency(group.tradeDelta)}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {client.accountType === 'Bond Ladder' ? (
              <BondLadderView 
                  client={client} 
                  positions={positions} 
                  totalValue={totalValue} 
                  onUpdateClient={(updatedClient) => onUpdateClient({ ...updatedClient, positions })} 
                  visibleCols={visibleCols} 
                  renderCell={renderCell}
                  handleSort={handleSort}
                  sortConfig={sortConfig}
                  handleResizeStart={handleResizeStart}
                  handleDeletePos={handleDeletePos}
                  newTicker={newTicker}
                  setNewTicker={setNewTicker}
                  addTicker={addTicker}
                  isAddingTicker={isAddingTicker}
                  compactMode={compactMode}
              />
          ) : (
              <div className="space-y-12 pb-24">
                  {/* ADD SECURITY ROW (Global if modular) */}
                  {isModularView && !isAggregated && (
                      <div className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-4 flex items-center gap-4 shadow-xl">
                          <div className="h-10 w-10 rounded-xl border border-dashed border-zinc-800 flex items-center justify-center text-zinc-700 focus-within:border-blue-500/50 focus-within:text-blue-500 transition-colors">
                              <PlusCircle className="h-5 w-5" />
                          </div>
                          <input 
                              className="bg-transparent flex-1 py-2 text-sm text-white focus:outline-none font-bold placeholder-zinc-700" 
                              placeholder="Add Security to Portfolio (e.g. NVDA, AAPL)..." 
                              value={newTicker} 
                              onChange={e => setNewTicker(e.target.value)} 
                              onKeyDown={e => e.key === 'Enter' && addTicker()} 
                          />
                          {newTicker && (
                              <Button onClick={addTicker} variant="ghost" loading={isAddingTicker} className="text-blue-500 hover:bg-blue-500/10 px-6 h-8 rounded-xl uppercase text-[10px] font-black">
                                  Add
                              </Button>
                          )}
                      </div>
                  )}

                  {(isModularView 
                      ? [
                          ...displayPositions.modularGroups.filter(g => g.name !== 'Cash & Cash Alternatives' && g.items.length > 0),
                          ...displayPositions.modularGroups.filter(g => g.name === 'Cash & Cash Alternatives')
                        ]
                      : [{ name: 'Portfolio', items: displayPositions.stocks, isStandard: true }]
                  ).map((group: any) => {
                      const groupVisibleCols = visibleCols.filter(col => {
                          if (isModularView && (group.name === 'Stocks' || group.name === 'Equity Funds' || group.name === 'Bond Funds' || group.name === 'Covered Calls')) {
                              return col.id !== 'issuer' && col.id !== 'maturityDate';
                          }
                          return true;
                      });

                      const handleGroupTargetChange = (val: string) => {
                          let key = 'equity';
                          if (group.name === 'Bonds') key = 'fixedIncome';
                          else if (group.name === 'Bond Funds') key = 'fixedIncome';
                          else if (group.name === 'Equity Funds') key = 'equity';
                          else if (group.name === 'Covered Calls') key = 'coveredCall';
                          else if (group.name === 'Cash & Cash Alternatives') key = 'cash';
                          
                          const numVal = parseFloat(val) || 0;
                          const newTargets = { ...(client.allocationTargets || {}), [key]: numVal };

                          onUpdateClient({ 
                              ...client, 
                              allocationTargets: newTargets,
                              settings: { ...(client.settings || {}), hasSpecifiedTargets: true }
                          });
                      };

                      return (
                      <div key={group.name} className="space-y-4 bg-zinc-900/20 border border-zinc-800/50 rounded-2xl p-6 backdrop-blur-xl shadow-2xl">
                          {/* MODULE HEADER */}
                          {isModularView && (
                              <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-3">
                                      <div className="h-10 w-10 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-400 shadow-inner">
                                          {group.name === 'Bonds' ? <LayoutList className="h-5 w-5 text-blue-400" /> : 
                                           group.name === 'Bond Funds' ? <Layers className="h-5 w-5 text-blue-400" /> : 
                                           group.name === 'Equity Funds' ? <Layers className="h-5 w-5 text-indigo-400" /> : 
                                           group.name === 'Cash & Cash Alternatives' ? <Banknote className="h-5 w-5 text-green-400" /> :
                                           <Activity className="h-5 w-5 text-indigo-400" />}
                                      </div>
                                      <div>
                                          <h3 className="text-xl font-black text-white tracking-tighter uppercase leading-none">{group.name}</h3>
                                          <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">{group.items.length} Assets</span>
                                      </div>
                                  </div>
                                  <div className="flex items-center gap-8">
                                      <div className="flex flex-col items-end">
                                          <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Current Value</span>
                                          <span className="text-lg font-bold text-white font-mono leading-none">{formatCurrency(group.currentValue)}</span>
                                      </div>
                                      <div className="flex flex-col items-end">
                                          <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Weight</span>
                                          <span className="text-lg font-bold text-zinc-400 font-mono leading-none">{group.currentPct.toFixed(2)}%</span>
                                      </div>
                                      <div className="flex flex-col items-end">
                                          <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Target Weight (%)</span>
                                          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 group/target transition-all focus-within:border-blue-500/50">
                                              <input 
                                                  type="number" 
                                                  disabled={client.settings?.isTargetsLocked}
                                                  onFocus={(e) => e.target.select()}
                                                  className="w-12 bg-transparent text-right text-base font-bold text-blue-400 font-mono focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed" 
                                                  value={group.name === 'Cash & Cash Alternatives' ? localCashTarget : group.targetWeight} 
                                                  onChange={(e) => {
                                                      if (group.name === 'Cash & Cash Alternatives') {
                                                          setLocalCashTarget(e.target.value);
                                                      } else {
                                                          handleGroupTargetChange(e.target.value);
                                                      }
                                                  }}
                                                  onBlur={() => {
                                                      if (group.name === 'Cash & Cash Alternatives') {
                                                          const val = localCashTarget === '' ? '' : parseFloat(localCashTarget);
                                                          onUpdateClient({
                                                              ...client,
                                                              allocationTargets: { ...(client.allocationTargets || {}), cash: val },
                                                              settings: { ...client.settings, hasSpecifiedTargets: true }
                                                          });
                                                      }
                                                  }}
                                                  onKeyDown={(e) => {
                                                      if (e.key === 'Enter' && group.name === 'Cash & Cash Alternatives') {
                                                          e.currentTarget.blur();
                                                      }
                                                  }}
                                              />
                                              <span className="text-xs font-bold text-zinc-600">%</span>
                                              <button 
                                                  onClick={() => handleGroupTargetChange(group.currentPct.toFixed(2))}
                                                  disabled={client.settings?.isTargetsLocked}
                                                  className="p-1 text-zinc-700 hover:text-blue-400 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                                  title="Match Current Weight"
                                              >
                                                  <RotateCcw className="h-3.5 w-3.5" />
                                              </button>
                                          </div>
                                      </div>
                                  </div>
                              </div>
                          )}

                          {/* MODULE TABLE */}
                          <div className="bg-zinc-950/40 border border-zinc-800 rounded-xl overflow-x-auto custom-scrollbar shadow-inner">
                              <table className="w-full text-left text-sm border-collapse min-w-[1200px]" style={{ tableLayout: 'fixed' }}>
                                  <thead className="bg-zinc-950/80 border-b border-zinc-800 sticky top-0 z-10 backdrop-blur-md">
                                      <tr>
                                          {groupVisibleCols.map(col => (
                                              <th key={col.id} style={{ width: col.width }} className={`relative text-[10px] font-black uppercase tracking-widest text-zinc-500 cursor-pointer hover:text-white transition-colors whitespace-nowrap ${col.align==='right'?'text-right':'text-left'} ${compactMode ? 'p-2' : 'p-4'}`} onClick={() => handleSort(col.id)}>
                                                  <div className={`flex items-center gap-1.5 ${col.align==='right'?'justify-end':'justify-start'}`}>{col.label}{sortConfig.key===col.id ? (sortConfig.direction==='asc'?<ChevronUp className="h-3 w-3 text-blue-400"/>:<ChevronDown className="h-3 w-3 text-blue-400"/>):<ArrowUpDown className="h-3 w-3 opacity-20"/>}</div>
                                                  <div className="col-resizer" onMouseDown={(e) => handleResizeStart(e, col.id)} onClick={(e)=>e.stopPropagation()} />
                                              </th>
                                          ))}
                                          <th className={`w-20 text-right ${compactMode ? 'p-2' : 'p-4'}`}></th>
                                      </tr>
                                  </thead>
                                  <tbody className="divide-y divide-zinc-900/50">
                                      {/* Standard View Add Security Row */}
                                      {!isModularView && !isAggregated && (
                                          <tr className="bg-zinc-950/50 group">
                                              <td colSpan={groupVisibleCols.length + 1} className="p-0 border-b border-zinc-800">
                                                  <div className="flex items-center gap-4 p-4">
                                                      <div className="h-10 w-10 rounded-xl border border-dashed border-zinc-800 flex items-center justify-center text-zinc-700 group-focus-within:border-blue-500/50 group-focus-within:text-blue-500 transition-colors"><PlusCircle className="h-5 w-5" /></div>
                                                      <input className="bg-transparent flex-1 py-2 text-sm text-white focus:outline-none font-bold placeholder-zinc-700" placeholder="Add Security (e.g. NVDA, AAPL)..." value={newTicker} onChange={e => setNewTicker(e.target.value)} onKeyDown={e => e.key === 'Enter' && addTicker()} />
                                                      {newTicker && <Button onClick={addTicker} variant="ghost" loading={isAddingTicker} className="text-blue-500 hover:bg-blue-500/10 px-6 h-8 rounded-xl uppercase text-[10px] font-black">Add</Button>}
                                                  </div>
                                              </td>
                                          </tr>
                                      )}
                                      {group.items.map(p => (
                                          <tr key={p.id} className="hover:bg-zinc-900/40 group">
                                              {groupVisibleCols.map(col => (
                                                  <td key={col.id} className={`p-0 border-b border-zinc-900/50 ${col.align==='right'?'text-right':''} ${['targetPct', 'actualTargetValue', 'yield'].includes(col.id) ? 'bg-blue-600/5' : ''}`}>
                                                      {p.isCash ? (
                                                          col.id === 'symbol' ? (
                                                              <div className={`p-4 flex items-center gap-4 h-full ${client.tradeFlags?.[p.symbol] === 'buy' ? 'border-l-2 border-green-500 bg-green-500/5' : client.tradeFlags?.[p.symbol] === 'sell' ? 'border-l-2 border-red-500 bg-red-500/5' : 'border-l-2 border-transparent'}`}>
                                                                  <div className="flex-shrink-0 min-w-[40px] w-10 h-10 bg-green-900/20 rounded-lg flex items-center justify-center text-green-500 border border-green-500/20"><Banknote className="h-5 w-5" /></div>
                                                                  <div className="flex flex-col">
                                                                      <div className="flex items-center gap-2">
                                                                          <span className="font-black text-white">{p.symbol}</span>
                                                                          {client.tradeFlags?.[p.symbol] === 'buy' && <span className="text-[8px] uppercase tracking-widest px-1 rounded bg-green-500/20 text-green-400">BUY</span>}
                                                                          {client.tradeFlags?.[p.symbol] === 'sell' && <span className="text-[8px] uppercase tracking-widest px-1 rounded bg-red-500/20 text-red-400">SELL</span>}
                                                                      </div>
                                                                      <span className="text-[11px] text-zinc-500">{p.description || 'Money Market'}</span>
                                                                  </div>
                                                              </div>
                                                          ) :
                                                          col.id === 'currentValue' ? 
                                                            <div className={`p-0 border border-transparent transition-colors h-full ${!isAggregated ? 'hover:bg-zinc-900 cursor-pointer hover:border-zinc-700' : ''}`}>
                                                                <input disabled={isAggregated} type="number" className="w-full h-full p-4 bg-transparent text-right font-mono font-bold text-white focus:outline-none" value={p.currentValue} onChange={(e) => {
                                                                    const newVal = parseFloat(e.target.value) || 0;
                                                                    const diff = newVal - p.currentValue;
                                                                    setPositions(positions.map((pos: any) => pos.symbol === p.symbol ? { ...pos, currentValue: pos.currentValue + diff } : pos));
                                                                }} />
                                                            </div> :
                                                          col.id === 'price' ? <div className="p-4 font-mono text-zinc-300 text-xs">$1.00</div> :
                                                          col.id === 'quantity' ? <div className="p-4 font-mono text-zinc-300 text-xs">--</div> :
                                                          renderCell(col, p)
                                                      ) : (
                                                          ['symbol', 'targetPct', 'actualTargetValue', 'yield', 'tradeShares'].includes(col.id) ? renderCell(col, p) : <div className={compactMode ? 'p-2' : 'p-4'}>{renderCell(col, p)}</div>
                                                      )}
                                                  </td>
                                              ))}
                                              <td className={`text-right ${compactMode ? 'p-2' : 'p-4'}`}>
                                                  {!isAggregated && !p.isCash && (
                                                      <button onClick={() => handleDeletePos(p.id)} className={`p-2 rounded-lg transition-all opacity-0 group-hover:opacity-100 ${confirmDeleteId === p.id ? 'bg-red-500 text-white opacity-100' : 'text-zinc-600 hover:text-red-500'}`}>{confirmDeleteId === p.id ? <Check className="h-4 w-4"/> : <Trash2 className="h-4 w-4" />}</button>
                                                  )}
                                              </td>
                                          </tr>
                                      ))}
                                      {/* Standard View Cash Row */}
                                      {!isModularView && displayPositions.cashPositions.map((cashPos: any) => (
                                          <tr key={cashPos.id} className="bg-zinc-950 border-t-2 border-zinc-800">
                                              {groupVisibleCols.map(col => (
                                                  <td key={col.id} className={`p-0 ${col.align==='right'?'text-right':''} ${['targetPct', 'actualTargetValue', 'yield', 'currentValue'].includes(col.id) ? 'bg-blue-600/5' : ''}`}>
                                                      {col.id === 'symbol' ? (
                                                          <div className={`p-4 flex items-center gap-4 h-full ${client.tradeFlags?.[cashPos.symbol] === 'buy' ? 'border-l-2 border-green-500 bg-green-500/5' : client.tradeFlags?.[cashPos.symbol] === 'sell' ? 'border-l-2 border-red-500 bg-red-500/5' : 'border-l-2 border-transparent'}`}>
                                                              <div className="flex-shrink-0 min-w-[40px] w-10 h-10 bg-green-900/20 rounded-lg flex items-center justify-center text-green-500 border border-green-500/20"><Banknote className="h-5 w-5" /></div>
                                                              <div className="flex flex-col">
                                                                  <div className="flex items-center gap-2">
                                                                      <span className="font-black text-white">{cashPos.symbol}</span>
                                                                      {client.tradeFlags?.[cashPos.symbol] === 'buy' && <span className="text-[8px] uppercase tracking-widest px-1 rounded bg-green-500/20 text-green-400">BUY</span>}
                                                                      {client.tradeFlags?.[cashPos.symbol] === 'sell' && <span className="text-[8px] uppercase tracking-widest px-1 rounded bg-red-500/20 text-red-400">SELL</span>}
                                                                  </div>
                                                                  <span className="text-[11px] text-zinc-500">{cashPos.description || 'Money Market'}</span>
                                                              </div>
                                                          </div>
                                                      ) :
                                                       col.id === 'currentValue' ? 
                                                         <div className={`p-0 border border-transparent transition-colors h-full ${!isAggregated ? 'hover:bg-zinc-900 cursor-pointer hover:border-zinc-700' : ''}`}>
                                                             <input disabled={isAggregated} type="number" className="w-full h-full p-4 bg-transparent text-right font-mono font-bold text-white focus:outline-none" value={cashPos.currentValue} onChange={(e) => {
                                                                 const newVal = parseFloat(e.target.value) || 0;
                                                                 const diff = newVal - cashPos.currentValue;
                                                                 setPositions(positions.map((p: any) => p.symbol === cashPos.symbol ? { ...p, currentValue: p.currentValue + diff } : p));
                                                             }} />
                                                         </div> :
                                                       col.id === 'price' ? <div className="p-4 font-mono text-zinc-300 text-xs">$1.00</div> :
                                                       col.id === 'quantity' ? <div className="p-4 font-mono text-zinc-300 text-xs">--</div> :
                                                       renderCell(col, cashPos)
                                                      }
                                                  </td>
                                              ))}
                                              <td className="p-4 text-right"></td>
                                          </tr>
                                      ))}
                                  </tbody>
                                  {!isModularView && (
                                      <tfoot className="bg-zinc-950/80 backdrop-blur-md border-t-4 border-zinc-800 sticky bottom-0 z-10">
                                          <tr className="text-zinc-400">
                                              {groupVisibleCols.map((col, idx) => (
                                                  <td key={col.id} className={`p-4 ${col.align==='right'?'text-right':''} ${idx===0?'font-black uppercase tracking-widest text-[10px]':''} ${col.id==='currentValue'?'font-mono font-black text-white text-base':''} ${col.id==='currentPct'?'font-mono text-white font-bold':''} ${col.id==='targetPct'?'bg-blue-600/10 font-mono text-blue-400 font-bold':''} ${col.id==='actualTargetValue'?'bg-blue-600/10 font-mono text-blue-400 font-bold':''} ${col.id==='tradeValue'?'font-mono text-zinc-500 font-bold':''}`}>
                                                      {col.id === 'symbol' ? 'Total Portfolio' :
                                                       col.id === 'currentValue' ? formatCurrency(totals.value) :
                                                       col.id === 'costBasis' ? formatCurrency(totals.costBasis) :
                                                       col.id === 'unrealizedGL' ? <span className={totals.unrealizedGL > 0 ? 'text-green-500' : totals.unrealizedGL < 0 ? 'text-red-500' : ''}>{formatCurrency(totals.unrealizedGL)}</span> :
                                                       col.id === 'unrealizedGLPct' ? <span className={totals.unrealizedGL > 0 ? 'text-green-500' : totals.unrealizedGL < 0 ? 'text-red-500' : ''}>{(totals.costBasis > 0 ? (totals.unrealizedGL / totals.costBasis) * 100 : 0).toFixed(2)}%</span> :
                                                       col.id === 'todayGL' ? <span className={totals.todayGL > 0 ? 'text-green-500' : totals.todayGL < 0 ? 'text-red-500' : ''}>{formatCurrency(totals.todayGL)}</span> :
                                                       col.id === 'todayGLPct' ? <span className={totals.todayGL > 0 ? 'text-green-500' : totals.todayGL < 0 ? 'text-red-500' : ''}>{(totals.todayGLPct * 100).toFixed(2)}%</span> :
                                                       col.id === 'currentPct' ? formatPercent(totals.weight) :
                                                       col.id === 'targetPct' ? formatPercent(totals.targetPct/100) :
                                                       col.id === 'actualTargetValue' ? formatCurrency(totals.targetValue) :
                                                       col.id === 'tradeValue' ? formatCurrency(totals.tradeValue) :
                                                       col.id === 'yield' ? formatPercent(totals.weightedYield / 100) :
                                                       ''}
                                                  </td>
                                              ))}
                                              <td></td>
                                          </tr>
                                      </tfoot>
                                  )}
                                  {isModularView && group.name === 'Cash & Cash Alternatives' && (
                                      <tfoot className="bg-zinc-950/80 backdrop-blur-md border-t-4 border-zinc-800 sticky bottom-0 z-10">
                                          <tr className="text-zinc-400">
                                              {groupVisibleCols.map((col, idx) => (
                                                  <td key={col.id} className={`p-4 ${col.align==='right'?'text-right':''} ${idx===0?'font-black uppercase tracking-widest text-[10px]':''} ${col.id==='currentValue'?'font-mono font-black text-white text-base':''} ${col.id==='currentPct'?'font-mono text-white font-bold':''} ${col.id==='targetPct'?'bg-blue-600/10 font-mono text-blue-400 font-bold':''} ${col.id==='actualTargetValue'?'bg-blue-600/10 font-mono text-blue-400 font-bold':''} ${col.id==='tradeValue'?'font-mono text-zinc-500 font-bold':''}`}>
                                                      {col.id === 'symbol' ? 'Total Portfolio' :
                                                       col.id === 'currentValue' ? formatCurrency(totals.value) :
                                                       col.id === 'costBasis' ? formatCurrency(totals.costBasis) :
                                                       col.id === 'unrealizedGL' ? <span className={totals.unrealizedGL > 0 ? 'text-green-500' : totals.unrealizedGL < 0 ? 'text-red-500' : ''}>{formatCurrency(totals.unrealizedGL)}</span> :
                                                       col.id === 'unrealizedGLPct' ? <span className={totals.unrealizedGL > 0 ? 'text-green-500' : totals.unrealizedGL < 0 ? 'text-red-500' : ''}>{(totals.costBasis > 0 ? (totals.unrealizedGL / totals.costBasis) * 100 : 0).toFixed(2)}%</span> :
                                                       col.id === 'todayGL' ? <span className={totals.todayGL > 0 ? 'text-green-500' : totals.todayGL < 0 ? 'text-red-500' : ''}>{formatCurrency(totals.todayGL)}</span> :
                                                       col.id === 'todayGLPct' ? <span className={totals.todayGL > 0 ? 'text-green-500' : totals.todayGL < 0 ? 'text-red-500' : ''}>{(totals.todayGLPct * 100).toFixed(2)}%</span> :
                                                       col.id === 'currentPct' ? formatPercent(totals.weight) :
                                                       col.id === 'targetPct' ? formatPercent(totals.targetPct/100) :
                                                       col.id === 'actualTargetValue' ? formatCurrency(totals.targetValue) :
                                                       col.id === 'tradeValue' ? formatCurrency(totals.tradeValue) :
                                                       col.id === 'yield' ? formatPercent(totals.weightedYield / 100) :
                                                       ''}
                                                  </td>
                                              ))}
                                              <td></td>
                                          </tr>
                                      </tfoot>
                                  )}
                              </table>
                          </div>

                          {/* MODULE FOOTER (Modular only) */}
                          {isModularView && (
                              <div className="grid grid-cols-3 gap-4 bg-zinc-950/40 border border-zinc-800 rounded-xl px-6 py-4 shadow-lg">
                                  <div className="flex flex-col">
                                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Recommended Action</span>
                                      <div className="flex items-center gap-2">
                                          <div className={`h-1.5 w-1.5 rounded-full ${group.recommendedDelta !== 0 ? (group.recommendedDelta > 0 ? 'bg-green-500' : 'bg-red-500') : 'bg-zinc-700'}`} />
                                          <span className={`text-sm font-black font-mono ${group.recommendedDelta > 0 ? 'text-green-500' : group.recommendedDelta < 0 ? 'text-red-500' : 'text-zinc-500'}`}>
                                              {group.recommendedDelta > 0 ? 'Target: Buy ' : group.recommendedDelta < 0 ? 'Target: Sell ' : 'Target: On Track'}
                                              {group.recommendedDelta !== 0 && (
                                                  <>
                                                      {formatCurrency(Math.abs(group.recommendedDelta))}
                                                      <span className="text-[10px] ml-1 opacity-60">({Math.abs(group.recommendedDeltaPct).toFixed(2)}%)</span>
                                                  </>
                                              )}
                                          </span>
                                      </div>
                                  </div>
                                  <div className="flex flex-col items-center border-x border-zinc-800/50">
                                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Planned Action</span>
                                      <span className={`text-sm font-black font-mono ${group.plannedDelta > 0 ? 'text-blue-400' : group.plannedDelta < 0 ? 'text-orange-400' : 'text-zinc-500'}`}>
                                          {group.plannedDelta > 0 ? 'Planned: Buy ' : group.plannedDelta < 0 ? 'Planned: Sell ' : 'Planned: None'}
                                          {group.plannedDelta !== 0 && (
                                              <>
                                                  {formatCurrency(Math.abs(group.plannedDelta))}
                                                  <span className="text-[10px] ml-1 opacity-60">({Math.abs(group.plannedDeltaPct).toFixed(2)}%)</span>
                                              </>
                                          )}
                                      </span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                      <span className="text-[9px] font-black text-zinc-600 uppercase tracking-widest mb-1">Remaining</span>
                                      <span className={`text-sm font-black font-mono ${Math.abs(group.remainingDelta) > 1 ? 'text-white' : 'text-zinc-500'}`}>
                                          {group.remainingDelta > 0 ? 'Remaining: Buy ' : group.remainingDelta < 0 ? 'Remaining: Sell ' : 'Remaining: Zero'}
                                          {group.remainingDelta !== 0 && (
                                              <>
                                                  {formatCurrency(Math.abs(group.remainingDelta))}
                                                  <span className="text-[10px] ml-1 opacity-60">({Math.abs(group.remainingDeltaPct).toFixed(2)}%)</span>
                                              </>
                                          )}
                                      </span>
                                  </div>
                              </div>
                          )}
                      </div>
                  )})}
              </div>
          )}
        </div>
      </div>
      {showModelModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 max-w-lg w-full shadow-2xl">
            <h3 className="text-2xl font-black text-white tracking-tighter mb-6">Apply Strategy</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Portfolio Value ($)</label>
                <input 
                  type="number" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 text-white font-mono font-bold focus:outline-none focus:border-blue-500" 
                  value={modelTargetValue} 
                  onChange={e => setModelTargetValue(e.target.value)} 
                  placeholder="0.00" 
                />
              </div>
              <div className="relative group">
                <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Strategy Model</label>
                <div className="relative">
                  <select 
                    value={selectedModelId} 
                    onChange={e => setSelectedModelId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl py-3 px-4 text-white font-bold focus:outline-none focus:border-blue-500 appearance-none cursor-pointer pr-10"
                  >
                    <option value="" disabled>Select a strategy...</option>
                    {models.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-zinc-500">
                    <ChevronDown className="h-4 w-4" />
                  </div>
                </div>
              </div>
              <div className="flex gap-3 mt-8">
                <Button variant="secondary" onClick={() => setShowModelModal(false)} className="flex-1 rounded-xl h-12">Cancel</Button>
                <Button variant="primary" onClick={applyModel} disabled={!selectedModelId} className="flex-1 rounded-xl h-12">Apply</Button>
              </div>
            </div>
          </div>
        </div>
      )}
      {showSettingsModal && (
          <SettingsModal 
            layout={layout} 
            onUpdateLayout={updateLayout} 
            hiddenBuckets={client.settings?.hiddenBuckets || ['coveredCall']}
            onToggleBucket={handleToggleBucket}
            bucketOrder={client.settings?.bucketOrder}
            globalCustomView={globalCustomView}
            onUpdateGlobalCustomView={onUpdateGlobalCustomView}
            activeViewType={activeViewType}
            defaultViewType={defaultViewType}
            setDefaultViewType={setDefaultViewType}
            setHasUnsavedCustomChanges={setHasUnsavedCustomChanges}
            onClose={(newBucketOrder) => {
                onUpdateClient({ 
                    ...client, 
                    settings: { 
                        ...client.settings, 
                        bucketOrder: newBucketOrder 
                    }, 
                    positions, 
                    lastUpdated: new Date().toISOString() 
                });
                setShowSettingsModal(false);
            }} 
          />
      )}
      {showProfileModal && (
          <ClientProfileModal
              client={client}
              onClose={() => setShowProfileModal(false)}
              onUpdateClient={onUpdateClient}
          />
      )}

      {showSaveModal && (
        <div className="fixed inset-0 z-[100] flex items-end justify-center p-8 pointer-events-none">
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="w-full max-w-md bg-zinc-900/80 backdrop-blur-2xl border border-zinc-800 rounded-3xl shadow-2xl p-8 pointer-events-auto flex flex-col"
          >
            <div className="flex items-center gap-6">
              <div className="h-14 w-14 rounded-2xl bg-blue-500/20 flex items-center justify-center text-blue-400">
                <Save className="h-7 w-7" />
              </div>
              <div>
                <h3 className="text-xl font-black text-white tracking-tight">Save Changes</h3>
                <p className="text-zinc-400 text-sm font-medium">Choose how you want to persist these updates.</p>
              </div>
            </div>
            
            <div className="flex gap-4 mt-8">
                <Button onClick={() => {
                    onUpdateClient({...client, positions, tradeFlags: {}, lastUpdated: new Date().toISOString()});
                    setShowSaveModal(false);
                }} className="flex-1 h-12 bg-zinc-900 hover:bg-zinc-800 text-white border border-zinc-800 rounded-xl font-bold flex items-center justify-center transition-all">
                    <Save className="h-4 w-4 mr-2 text-zinc-400" /> Save Only
                </Button>
                <Button onClick={() => handleStageTrades(true)} className="flex-1 h-12 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold flex items-center justify-center shadow-[0_0_15px_rgba(37,99,235,0.2)] transition-all border border-transparent">
                    <FileSpreadsheet className="h-4 w-4 mr-2" /> Export Trades
                </Button>
            </div>
            <button onClick={() => setShowSaveModal(false)} className="w-full mt-4 py-3 text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-colors">Cancel</button>
          </motion.div>
        </div>
      )}
    </div>
  );
};
const ClientDashboard = ({ client, userProfile, getGreeting, onUpdateClient, onBack, models, assetOverrides, setAssetOverrides, onNavigate, viewPreferences, setViewPreferences, globalCustomView, onUpdateGlobalCustomView, hasUnsavedCustomChanges, setHasUnsavedCustomChanges, activeViewType, setActiveViewType, defaultViewType, setDefaultViewType }: any) => {
    const normalizedClient = useMemo(() => {
        if (client.accounts) return client;
        return {
            ...client,
            accounts: [{
                id: generateId(),
                name: 'Primary Portfolio',
                positions: client.positions || [],
                lastUpdated: client.lastUpdated
            }]
        };
    }, [client]);

    const [activeTab, setActiveTab] = useState('overview'); 
    const [isEditingAccount, setIsEditingAccount] = useState(false);
    const [newAccountName, setNewAccountName] = useState("");
    const [isEditingClient, setIsEditingClient] = useState(false);
    const [tempClientName, setTempClientName] = useState(client.name);
    const clientInputRef = useRef(null);

    const handleSaveClientName = () => { 
        if (tempClientName.trim() && tempClientName !== client.name) {
            onUpdateClient({ ...client, name: tempClientName.trim(), lastUpdated: new Date().toISOString() }); 
        }
        setIsEditingClient(false); 
    };

    const aggregatedPositions = useMemo(() => {
        if (!normalizedClient.accounts) return [];
        const map = new Map();
        
        normalizedClient.accounts.forEach(acc => {
            (acc.positions || []).forEach(pos => {
                const existing = map.get(pos.symbol);
                if (existing) {
                    existing.quantity += (Number(pos.quantity) || 0);
                    existing.currentValue += (Number(pos.currentValue) || 0);
                    if (pos.metadata) {
                        existing.metadata = { ...(existing.metadata || {}), ...pos.metadata };
                    }
                } else {
                    map.set(pos.symbol, { 
                        ...pos, 
                        quantity: Number(pos.quantity) || 0, 
                        currentValue: Number(pos.currentValue) || 0,
                        metadata: pos.metadata ? { ...pos.metadata } : null
                    });
                }
            });
        });
        return Array.from(map.values());
    }, [normalizedClient]);

    const handleCreateAccount = () => {
        const newAcc = { 
            id: generateId(), 
            name: newAccountName || 'New Account', 
            positions: [],
            lastUpdated: new Date().toISOString()
        };
        const updatedClient = { 
            ...normalizedClient, 
            accounts: [...normalizedClient.accounts, newAcc],
            lastUpdated: new Date().toISOString()
        };
        onUpdateClient(updatedClient);
        setNewAccountName("");
        setIsEditingAccount(false);
        setActiveTab(newAcc.id);
    };

    const handleUpdateData = (updatedData) => {
        const currentTimestamp = updatedData.lastUpdated || new Date().toISOString();
        const { stagedTrades, tradeFlags, accountNumber, ...rest } = updatedData;
        
        let updatedClient = { 
            ...normalizedClient, 
            stagedTrades: stagedTrades !== undefined ? stagedTrades : (normalizedClient.stagedTrades || []),
            tradeFlags: tradeFlags !== undefined ? tradeFlags : (normalizedClient.tradeFlags || {}),
            lastUpdated: currentTimestamp 
        };

        if (activeTab === 'overview') {
             // Update allocation targets and settings for household
             updatedClient.allocationTargets = rest.allocationTargets;
             updatedClient.settings = rest.settings;
             
             if (rest.positions) {
                 const updates = new Map();
                 rest.positions.forEach(p => {
                     updates.set(p.symbol, { 
                         price: p.price, 
                         yield: p.yield, 
                         metadata: p.metadata 
                     });
                 });

                 updatedClient.accounts = updatedClient.accounts.map(acc => ({
                     ...acc,
                     positions: (acc.positions || []).map(pos => {
                         const up = updates.get(pos.symbol);
                         if (up) {
                             return {
                                 ...pos,
                                 price: up.price !== undefined ? up.price : pos.price,
                                 yield: up.yield !== undefined ? up.yield : pos.yield,
                                 metadata: { ...pos.metadata, ...up.metadata } 
                             };
                         }
                         return pos;
                     })
                 }));
             }
        } else {
            // Update specific account data including accountNumber
            updatedClient.accounts = normalizedClient.accounts.map(acc => 
                acc.id === activeTab ? { ...acc, ...rest, accountNumber: accountNumber !== undefined ? accountNumber : acc.accountNumber, lastUpdated: currentTimestamp } : acc
            );
        }
        onUpdateClient(updatedClient);
    };
    
    const handleDeleteAccount = (accId) => {
        const updatedAccounts = normalizedClient.accounts.filter(a => a.id !== accId);
        onUpdateClient({ 
            ...normalizedClient, 
            accounts: updatedAccounts,
            lastUpdated: new Date().toISOString()
        });
        setActiveTab('overview');
    };

    const activeAccount = normalizedClient.accounts.find(a => a.id === activeTab);
    const portfolioData = activeTab === 'overview' 
        ? { 
            ...normalizedClient,
            name: normalizedClient.name + ' (Household)', 
            positions: aggregatedPositions, 
            id: 'overview'
          }
        : {
            ...activeAccount,
            stagedTrades: normalizedClient.stagedTrades || [],
            tradeFlags: normalizedClient.tradeFlags || {}
        };

    return (
        <div className="flex flex-col h-screen bg-zinc-950 overflow-hidden">
            <div className="bg-zinc-950/80 backdrop-blur-md border-b border-zinc-800 pt-6 px-8 shrink-0 z-20">
               <div className="flex items-center gap-4 mb-6">
                   <Button variant="ghost" size="icon" onClick={onBack} className="rounded-full h-10 w-10"><ArrowRight className="rotate-180 h-5 w-5"/></Button>
                   <div className="flex items-center gap-3 group">
                       {isEditingClient ? (
                           <div className="flex items-center gap-2">
                               <input ref={clientInputRef} autoFocus className="bg-zinc-900 border border-blue-500 text-3xl font-black tracking-tighter text-white rounded px-2 py-1 focus:outline-none w-64" value={tempClientName} onChange={e => setTempClientName(e.target.value)} onBlur={handleSaveClientName} onKeyDown={e => e.key === 'Enter' && handleSaveClientName()} />
                               <button onClick={handleSaveClientName} className="text-green-500 hover:text-green-400"><Check className="h-6 w-6" /></button>
                           </div>
                       ) : (
                           <>
                               <div className="flex flex-col">
                                   <div className="flex items-center gap-2">
                                       <h1 className="text-3xl font-black text-white tracking-tighter">{client.name}</h1>
                                       <button onClick={() => { setIsEditingClient(true); setTempClientName(client.name); }} className="text-zinc-600 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-opacity"><Pencil className="h-5 w-5" /></button>
                                   </div>
                               </div>
                           </>
                       )}
                   </div>
               </div>
               <div className="flex items-center gap-2 overflow-x-auto custom-scrollbar pb-0">
                   <button 
                       onClick={() => setActiveTab('overview')}
                       className={`px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all ${activeTab === 'overview' ? 'border-blue-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                   >
                       Overview
                   </button>
                   {normalizedClient.accounts.map(acc => {
                       const hasFlags = acc.positions && acc.positions.some((p: any) => client.tradeFlags?.[p.symbol] === 'buy' || client.tradeFlags?.[p.symbol] === 'sell');
                       return (
                       <div key={acc.id} className="group relative flex items-center">
                           <button 
                               onClick={() => setActiveTab(acc.id)}
                               className={`px-6 py-3 text-xs font-bold uppercase tracking-widest border-b-2 transition-all whitespace-nowrap flex items-center gap-2 ${activeTab === acc.id ? 'border-blue-500 text-white' : 'border-transparent text-zinc-500 hover:text-zinc-300'}`}
                           >
                               {(acc.accountType === 'Money Market' || acc.isMoneyMarket) && <Banknote className="h-3 w-3 text-green-500" />}
                               {acc.accountType === 'Model Portfolio' && <Layers className="h-3 w-3 text-blue-500" />}
                               {acc.accountType === 'Bespoke Portfolio' && <Sparkles className="h-3 w-3 text-purple-500" />}
                               {acc.accountType === 'Bond Ladder' && <LayoutList className="h-3 w-3 text-orange-500" />}
                               {acc.name}
                               {hasFlags && <div className="h-1.5 w-1.5 rounded-full bg-blue-500 shadow-[0_0_6px_rgba(59,130,246,0.8)] animate-pulse ml-1" />}
                           </button>
                       </div>
                       );
                   })}
                   <div className="ml-4 flex items-center gap-2 pb-2">
                       {isEditingAccount ? (
                           <div className="flex items-center bg-zinc-900 rounded-lg p-1 border border-zinc-800">
                               <input autoFocus className="bg-transparent text-xs text-white px-2 outline-none w-32" placeholder="Account Name" value={newAccountName} onChange={e => setNewAccountName(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleCreateAccount()} />
                               <button onClick={handleCreateAccount} className="p-1 text-green-500 hover:bg-zinc-800 rounded"><Check className="h-3 w-3"/></button>
                               <button onClick={() => setIsEditingAccount(false)} className="p-1 text-zinc-500 hover:bg-zinc-800 rounded"><X className="h-3 w-3"/></button>
                           </div>
                       ) : (
                           <button onClick={() => setIsEditingAccount(true)} className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-blue-500 hover:text-blue-400 px-3 py-1 rounded-full hover:bg-blue-500/10 transition-colors">
                               <PlusCircle className="h-3 w-3" /> Add Account
                           </button>
                       )}
                   </div>
               </div>
            </div>
            
            <div className="flex-1 flex flex-col min-h-0">
                <Rebalancer 
                    key={activeTab} 
                    client={portfolioData}
                    userProfile={userProfile}
                    getGreeting={getGreeting}
                    onUpdateClient={handleUpdateData}
                    onBack={onBack}
                    models={models}
                    assetOverrides={assetOverrides}
                    setAssetOverrides={setAssetOverrides}
                    isAggregated={activeTab === 'overview'}
                    onDeleteAccount={activeTab !== 'overview' ? () => handleDeleteAccount(activeTab) : undefined}
                    onNavigate={onNavigate}
                    viewPreferences={viewPreferences}
                    setViewPreferences={setViewPreferences}
                    globalCustomView={globalCustomView}
                    onUpdateGlobalCustomView={onUpdateGlobalCustomView}
                    hasUnsavedCustomChanges={hasUnsavedCustomChanges}
                    setHasUnsavedCustomChanges={setHasUnsavedCustomChanges}
                    activeViewType={activeViewType}
                    setActiveViewType={setActiveViewType}
                    defaultViewType={defaultViewType}
                    setDefaultViewType={setDefaultViewType}
                />
            </div>
        </div>
    );
};

const ModelManager = ({ models, onUpdateModels }) => {
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState(null); 
  const [modelName, setModelName] = useState('');
  const [defaultBench, setDefaultBench] = useState('SPY');
  const [allocations, setAllocations] = useState([{ symbol: '', percent: '', description: '' }]);
  const [isSaving, setIsSaving] = useState(false);
  const [backtestModel, setBacktestModel] = useState(null); 
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);

  const handleAddRow = () => setAllocations([...allocations, { symbol: '', percent: '', description: '' }]);
  const handleRemoveRow = (idx) => setAllocations(allocations.filter((_, i) => i !== idx));
  const handleChange = (idx, field, val) => {
    const next = [...allocations];
    if (field === 'symbol') { 
        next[idx][field] = val.toUpperCase(); 
        next[idx].description = ''; 
    } else { 
        next[idx][field] = val; 
    }
    setAllocations(next);
  };

  const saveModel = async () => {
    if (!modelName.trim()) return;
    setIsSaving(true);
    const finnhubKey = getFinnhubKeys()[0]; 
    try {
        const enriched = await Promise.all(allocations.filter(a => a.symbol.trim() !== '').map(async (a) => {
            if (a.description) return {...a, percent: parseFloat(a.percent)}; 
            const res = await fetch(`https://finnhub.io/api/v1/stock/profile2?symbol=${a.symbol.toUpperCase()}&token=${finnhubKey}`).then(r => r.json());
            return { ...a, description: res.name || a.symbol, percent: parseFloat(a.percent) };
        }));
        const modelData = { name: modelName, defaultBenchmark: defaultBench, allocations: enriched };
        if (editingId) { 
            onUpdateModels(models.map(m => m.id === editingId ? { ...m, ...modelData } : m));
        } else { 
            onUpdateModels([...models, { id: generateId(), ...modelData }]);
        }
        setIsCreating(false); setEditingId(null); setModelName(''); setAllocations([{ symbol: '', percent: '', description: '' }]);
    } catch (error) { } finally { setIsSaving(false); }
  };

  const handleDeleteClick = (id) => {
    if (confirmDeleteId === id) {
      onUpdateModels(models.filter(m => m.id !== id));
      setConfirmDeleteId(null);
    } else {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId(null), 3000);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-12 space-y-8 pb-24">
      <GlobalStyles />
      <div className="flex justify-between items-end">
        <div><h1 className="text-4xl font-black text-white tracking-tighter">Models</h1><p className="text-zinc-500 text-lg mt-2 font-medium">Define your target allocations.</p></div>
        <div className="flex gap-2">
            {!isCreating && <Button onClick={() => setIsCreating(true)} className="rounded-xl px-6 h-12 uppercase text-[10px] tracking-widest font-black"><Plus className="h-4 w-4 mr-2" /> Create Model</Button>}
        </div>
      </div>
      {isCreating && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-8 mb-8 shadow-2xl">
          <div className="flex justify-between items-start mb-6"><h3 className="text-xl font-black text-white">{editingId ? 'Edit Strategy' : 'New Strategy'}</h3><button onClick={() => setIsCreating(false)} className="text-zinc-500 hover:text-white"><X className="h-5 w-5" /></button></div>
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Strategy Name</label><input className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-bold focus:outline-none focus:border-blue-500" value={modelName} onChange={e => setModelName(e.target.value)} /></div>
                <div><label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Default Benchmark</label><select className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-bold focus:outline-none focus:border-blue-500" value={defaultBench} onChange={e => setDefaultBench(e.target.value)}>{BENCHMARK_OPTIONS.map(opt => <option key={opt.id} value={opt.id}>{opt.label}</option>)}</select></div>
            </div>
            <div className="space-y-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500">Allocations</label>
              {allocations.map((alloc, idx) => (
                <div key={idx} className="flex gap-4 items-center">
                  <input className="flex-1 bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white font-mono uppercase" placeholder="Ticker" value={alloc.symbol} onChange={e => handleChange(idx, 'symbol', e.target.value)} />
                  <div className="relative w-32 border border-zinc-800 rounded-xl overflow-hidden focus-within:border-blue-500 bg-zinc-950"><input type="number" className="w-full bg-transparent px-4 py-4 text-right text-white font-mono text-lg focus:outline-none" value={alloc.percent} onChange={e => handleChange(idx, 'percent', e.target.value)} /><span className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-600 font-bold pointer-events-none">%</span></div>
                  <button onClick={() => handleRemoveRow(idx)} className="text-zinc-600 hover:text-red-500 p-2"><Trash2 className="h-4 w-4" /></button>
                </div>
              ))}
              <button onClick={handleAddRow} className="text-blue-500 text-xs font-bold uppercase tracking-widest hover:text-blue-400 mt-2 flex items-center gap-1"><PlusCircle className="h-3 w-3" /> Add Asset</button>
            </div>
            <div className="flex justify-end pt-4 border-t border-zinc-800"><Button onClick={saveModel} disabled={!modelName || isSaving} loading={isSaving} className="rounded-xl px-8">Save Strategy</Button></div>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {models.map(m => (
          <div key={m.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 hover:border-zinc-700 transition-all">
            <div className="flex justify-between items-start mb-4">
              <div className="h-10 w-10 bg-zinc-800 rounded-lg flex items-center justify-center text-blue-500"><Layers className="h-5 w-5" /></div>
              <div className="flex items-center gap-1">
                <button onClick={() => setBacktestModel(m)} className="text-zinc-600 hover:text-blue-400 p-2"><LineChart className="h-4 w-4" /></button>
                <button onClick={() => { setModelName(m.name); setDefaultBench(m.defaultBenchmark); setAllocations(m.allocations.map(a=>({...a, percent: a.percent.toString()}))); setEditingId(m.id); setIsCreating(true); }} className="text-zinc-600 hover:text-white p-2"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => handleDeleteClick(m.id)} className={`p-2 rounded-lg transition-colors ${confirmDeleteId === m.id ? 'bg-red-500 text-white' : 'text-zinc-600 hover:text-red-500'}`}>{confirmDeleteId === m.id ? <Check className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}</button>
              </div>
            </div>
            <h3 className="text-xl font-black text-white tracking-tight mb-4">{m.name}</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2 bg-zinc-950/50 p-3 rounded-xl border border-zinc-800/50 custom-scrollbar">
              {m.allocations.map((a, i) => (
                <div key={i} className="flex justify-between text-xs items-center py-1 border-b border-zinc-800/30 last:border-0"><div className="flex flex-col"><span className="font-bold text-white">{a.symbol}</span><span className="text-[9px] text-zinc-500 truncate max-w-[120px]">{a.description}</span></div><span className="font-mono text-zinc-300 font-bold">{a.percent}%</span></div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {backtestModel && <BacktestModal model={backtestModel} onClose={() => setBacktestModel(null)} />}
    </div>
  );
};

const AddClientModal = ({ onClose, onSave }) => {
    const [firstName, setFirstName] = useState('');
    const [lastName, setLastName] = useState('');
    const [nickname, setNickname] = useState('');
    const [dob, setDob] = useState('');
    const [phone, setPhone] = useState('');
    const [email, setEmail] = useState('');
    const [address, setAddress] = useState('');
    const [accountNumber, setAccountNumber] = useState('');

    const handleSave = () => {
        if (!firstName.trim() || !lastName.trim()) {
            alert("First Name and Last Name are required.");
            return;
        }
        const name = `${firstName.trim()} ${lastName.trim()}`;
        const profile = {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            nickname: nickname.trim(),
            dob: dob.trim(),
            phone: phone.trim(),
            email: email.trim(),
            address: address.trim(),
            accountNumber: accountNumber.trim()
        };
        onSave({ name, profile });
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
            <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-2xl flex flex-col shadow-2xl overflow-hidden">
                <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/20 text-blue-400 rounded-lg">
                            <User className="h-5 w-5" />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-white tracking-tight">Add New Client</h2>
                            <p className="text-xs text-zinc-500 font-medium">Enter client profile details</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors">
                        <X className="h-5 w-5" />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto custom-scrollbar">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Account Number</label>
                            <input type="text" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="e.g. 123456789" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Nickname</label>
                            <input type="text" value={nickname} onChange={e => setNickname(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="Janey" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">First Name *</label>
                            <input type="text" value={firstName} onChange={e => setFirstName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="Jane" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Last Name *</label>
                            <input type="text" value={lastName} onChange={e => setLastName(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="Doe" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Date of Birth</label>
                            <input type="date" value={dob} onChange={e => setDob(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Phone Number</label>
                            <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="(555) 123-4567" />
                        </div>
                        <div className="space-y-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Email Address</label>
                            <input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="jane@example.com" />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                            <label className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Mailing Address</label>
                            <input type="text" value={address} onChange={e => setAddress(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors" placeholder="123 Main St, City, ST 12345" />
                        </div>
                    </div>
                </div>
                <div className="p-6 border-t border-zinc-800 bg-zinc-900/50 flex justify-end gap-3">
                    <button onClick={onClose} className="px-6 py-2.5 text-sm font-bold text-zinc-400 hover:text-white transition-colors">Cancel</button>
                    <Button onClick={handleSave} className="px-8 py-2.5 rounded-xl">Save Client</Button>
                </div>
            </div>
        </div>
    );
};

const ClientList = ({ clients, onCreateClient, onSelectClient, onDeleteClient, onImportClients, tierSettings }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'recent', direction: 'desc' });
  const [viewMode, setViewMode] = useState('grid');
  const [tierFilter, setTierFilter] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);

  const getClientValue = (client) => {
    let total = 0;
    if (client.accounts) {
         client.accounts.forEach(acc => {
             (acc.positions || []).forEach(p => total += (Number(p.currentValue) || 0));
         });
    } else if (client.positions) {
         client.positions.forEach(p => total += (Number(p.currentValue) || 0));
    }
    return total;
  };

  const handleSortToggle = (key) => {
    setSortConfig(prev => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      let defaultDir = 'asc';
      if (key === 'recent' || key === 'value' || key === 'tierScore') defaultDir = 'desc';
      return { key, direction: defaultDir };
    });
  };

  const sortedClients = useMemo(() => {
      let withValues = clients.map(c => ({
          ...c,
          totalValue: getClientValue(c)
      }));

      // Calculate Tiers
      if (tierSettings.mode === 'absolute') {
          withValues = withValues.map(c => {
              let tier = 'F';
              let score = 1;
              if (c.totalValue >= tierSettings.thresholds.A) { tier = 'A'; score = 5; }
              else if (c.totalValue >= tierSettings.thresholds.B) { tier = 'B'; score = 4; }
              else if (c.totalValue >= tierSettings.thresholds.C) { tier = 'C'; score = 3; }
              else if (c.totalValue >= tierSettings.thresholds.D) { tier = 'D'; score = 2; }
              return { ...c, tier, tierScore: score };
          });
      } else {
          const sortedByValue = [...withValues].sort((a, b) => b.totalValue - a.totalValue);
          const total = sortedByValue.length;
          withValues = withValues.map(c => {
              const index = sortedByValue.findIndex(sc => sc.id === c.id);
              const rank = total > 0 ? (index / total) * 100 : 100;
              let tier = 'F';
              let score = 1;
              if (rank <= tierSettings.thresholds.A) { tier = 'A'; score = 5; }
              else if (rank <= tierSettings.thresholds.B) { tier = 'B'; score = 4; }
              else if (rank <= tierSettings.thresholds.C) { tier = 'C'; score = 3; }
              else if (rank <= tierSettings.thresholds.D) { tier = 'D'; score = 2; }
              return { ...c, tier, tierScore: score };
          });
      }

      let filtered = withValues;
      if (tierFilter !== 'All') {
          filtered = filtered.filter(c => c.tier === tierFilter);
      }

      return filtered.sort((a, b) => {
          const dir = sortConfig.direction === 'asc' ? 1 : -1;
          
          if (sortConfig.key === 'recent') {
              const dateA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
              const dateB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
              return (dateA - dateB) * dir;
          }
          if (sortConfig.key === 'value') {
              return (a.totalValue - b.totalValue) * dir;
          }
          if (sortConfig.key === 'tierScore') {
              return (a.tierScore - b.tierScore) * dir;
          }
          return a.name.localeCompare(b.name) * dir;
      });
  }, [clients, sortConfig, tierSettings, tierFilter]);

  const TierBadge = ({ tier }: { tier: string }) => {
      const tierIcons: Record<string, string> = {
          A: '/ACG Lion Black SVG.svg',
          B: '/ACG Lion Gold SVG.svg',
          C: '/ACG Lion Silver SVG.svg',
          D: '/ACG Lion Bronze SVG.svg',
          F: '/ACG Lion Blue SVG.svg'
      };
      return (
          <div className="h-full w-full flex items-center justify-center overflow-hidden">
              <img 
                  src={tierIcons[tier] || tierIcons.F} 
                  alt={`Tier ${tier}`}
                  className="h-full w-full object-contain p-0.5"
                  onError={(e) => {
                      // Fallback if image fails to load
                      e.currentTarget.style.display = 'none';
                      const fallback = document.createElement('div');
                      fallback.className = "h-full w-full rounded-full bg-zinc-800 flex items-center justify-center text-zinc-500 font-black text-xs";
                      fallback.innerText = tier;
                      if (e.currentTarget.parentNode) {
                          e.currentTarget.parentNode.appendChild(fallback);
                      }
                  }}
              />
          </div>
      );
  };

  return (
    <div 
        className="max-w-7xl mx-auto p-8 md:p-12 space-y-12 pb-24 relative"
    >
      <GlobalStyles />
      <div className="flex flex-col md:flex-row justify-between items-end gap-6">
        <div><h1 className="text-4xl font-black text-white tracking-tighter">Portfolios</h1><p className="text-zinc-500 text-base mt-2 font-medium">Quant-based rebalancing & allocation tools.</p></div>
        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
            <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl p-1 h-12 items-center">
                 <button 
                    onClick={() => setViewMode('grid')} 
                    className={`h-full px-3 rounded-lg flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all ${viewMode === 'grid' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title="Grid View"
                >
                    <LayoutGrid className="h-4 w-4" />
                </button>
                 <button 
                    onClick={() => setViewMode('list')} 
                    className={`h-full px-3 rounded-lg flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all ${viewMode === 'list' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title="List View"
                >
                    <LayoutList className="h-4 w-4" />
                </button>
            </div>

            <div className="flex bg-zinc-900 border border-zinc-800 rounded-xl p-1 h-12 items-center">
                <button 
                    onClick={() => handleSortToggle('recent')} 
                    className={`h-full px-3 rounded-lg flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all ${sortConfig.key === 'recent' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={sortConfig.direction === 'desc' ? "Newest First" : "Oldest First"}
                >
                    <Clock className="h-4 w-4" />
                    {sortConfig.key === 'recent' && (sortConfig.direction === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                </button>
                <button 
                    onClick={() => handleSortToggle('name')} 
                    className={`h-full px-3 rounded-lg flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all ${sortConfig.key === 'name' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={sortConfig.direction === 'asc' ? "Name: A-Z" : "Name: Z-A"}
                >
                    {sortConfig.key === 'name' && sortConfig.direction === 'desc' ? <ArrowUpAZ className="h-4 w-4" /> : <ArrowDownAZ className="h-4 w-4" />}
                </button>
                <button 
                    onClick={() => handleSortToggle('value')} 
                    className={`h-full px-3 rounded-lg flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all ${sortConfig.key === 'value' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={sortConfig.direction === 'desc' ? "Value: High to Low" : "Value: Low to High"}
                >
                    {sortConfig.key === 'value' && sortConfig.direction === 'asc' ? <ArrowUpNarrowWide className="h-4 w-4" /> : <ArrowDownWideNarrow className="h-4 w-4" />}
                </button>
                <button 
                    onClick={() => handleSortToggle('tierScore')} 
                    className={`h-full px-3 rounded-lg flex items-center gap-2 text-xs font-bold uppercase tracking-widest transition-all ${sortConfig.key === 'tierScore' ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}
                    title={sortConfig.direction === 'desc' ? "Tier: A to F" : "Tier: F to A"}
                >
                    <Star className="h-4 w-4" />
                    {sortConfig.key === 'tierScore' && (sortConfig.direction === 'desc' ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                </button>
            </div>

            <div className="relative">
                <select
                    value={tierFilter}
                    onChange={(e) => setTierFilter(e.target.value)}
                    className="appearance-none bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white px-4 py-2 pr-10 h-12 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-zinc-700"
                >
                    <option value="All">All Tiers</option>
                    <option value="A">Black Tier</option>
                    <option value="B">Gold Tier</option>
                    <option value="C">Silver Tier</option>
                    <option value="D">Bronze Tier</option>
                    <option value="F">Blue Tier</option>
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500 pointer-events-none" />
            </div>
            
            <div className="flex gap-3 bg-zinc-900/50 p-1.5 rounded-2xl border border-zinc-800 shadow-2xl w-full md:w-auto">
                <Button onClick={() => setShowAddModal(true)} className="rounded-xl px-6 h-12 flex items-center"><Plus className="h-4 w-4 mr-2" /> Add Client</Button>
            </div>
        </div>
      </div>

      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {sortedClients.map(c => {
                const hasFlags = c.tradeFlags && Object.values(c.tradeFlags).some(f => f === 'buy' || f === 'sell');
                return (
                <Card key={c.id} className="group relative border-zinc-800 hover:border-blue-500/50 transition-all rounded-2xl" onClick={() => onSelectClient(c.id)}>
                    {hasFlags && <div className="absolute top-4 right-4 h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse" />}
                    <div className="flex justify-between items-start">
                        <div className="h-12 w-12 rounded-xl flex items-center justify-center transition-colors">
                             <TierBadge tier={c.tier} />
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); onDeleteClient(c.id); }} className="text-zinc-800 hover:text-red-500 transition-colors p-2">
                             <Trash2 className="h-4 w-4" />
                        </button>
                    </div>
                    
                    <div className="mt-6">
                        <h3 className="font-black text-xl text-zinc-100 tracking-tight leading-tight mb-1">{c.name}</h3>
                        <div className="text-2xl font-mono font-bold text-white">{formatCurrency(c.totalValue)}</div>
                    </div>

                    <div className="mt-6 pt-6 border-t border-zinc-800/50 text-xs text-zinc-500 flex justify-between items-center font-bold uppercase tracking-widest">
                        <span>{c.accounts ? c.accounts.length + ' Accounts' : '1 Account'}</span>
                        <span className="text-blue-500 group-hover:translate-x-1 transition-transform flex items-center gap-2">
                            {c.lastUpdated && (
                                <span className="text-[9px] text-zinc-600 font-mono normal-case tracking-normal hidden sm:inline">
                                     {new Date(c.lastUpdated).toLocaleDateString()}
                                </span>
                            )}
                            Configure →
                        </span>
                    </div>
                </Card>
                );
            })}
        </div>
      ) : (
        <div className="bg-zinc-900/30 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl">
             <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                    <thead className="bg-zinc-950 border-b border-zinc-800 text-[10px] font-black uppercase tracking-widest text-zinc-500">
                        <tr>
                             <th className="p-6">Client Name</th>
                            <th className="p-6 text-right">Accounts</th>
                            <th className="p-6 text-right">Total Value</th>
                            <th className="p-6 text-right">Last Updated</th>
                            <th className="p-6 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                         {sortedClients.map(c => {
                            const hasFlags = c.tradeFlags && Object.values(c.tradeFlags).some(f => f === 'buy' || f === 'sell');
                            return (
                            <tr key={c.id} onClick={() => onSelectClient(c.id)} className="hover:bg-zinc-900 cursor-pointer group transition-colors">
                                <td className="p-6 font-bold text-white flex items-center gap-4 relative">
                                     <div className="h-8 w-8 rounded-lg flex items-center justify-center transition-colors">
                                        <TierBadge tier={c.tier} />
                                     </div>
                                    {c.name}
                                    {hasFlags && <div className="h-2 w-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)] animate-pulse ml-2" />}
                                </td>
                                <td className="p-6 text-right font-mono">{c.accounts ? c.accounts.length : 1}</td>
                                <td className="p-6 text-right font-mono font-bold text-white">{formatCurrency(c.totalValue)}</td>
                                <td className="p-6 text-right text-xs text-zinc-500 font-mono">
                                     {c.lastUpdated ? new Date(c.lastUpdated).toLocaleDateString() : '--'}
                                </td>
                                <td className="p-6 text-right">
                                     <button 
                                        onClick={(e) => { e.stopPropagation(); onDeleteClient(c.id); }} 
                                        className="text-zinc-600 hover:text-red-500 transition-colors p-2 rounded-lg hover:bg-zinc-800"
                                    >
                                         <Trash2 className="h-4 w-4" />
                                    </button>
                                </td>
                             </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
             {sortedClients.length === 0 && (
                <div className="p-12 text-center text-zinc-500 font-medium">No clients found. Create one to get started.</div>
            )}
        </div>
      )}
      {showAddModal && <AddClientModal onClose={() => setShowAddModal(false)} onSave={({ name, profile }) => { onCreateClient({ name, profile }); setShowAddModal(false); }} />}
    </div>
  );
};

const FirmOverview = ({ clients, assetOverrides, setAssetOverrides, onUpdateClient }: any) => {
    const [activeTab, setActiveTab] = useState('All');
    const [firmViewMode, setFirmViewMode] = useState('performance');
    const [sortConfig, setSortConfig] = useState({ key: 'totalValue', direction: 'desc' });
    const [expandedAsset, setExpandedAsset] = useState<string | null>(null);
    const [subSort, setSubSort] = useState({ key: 'currentValue', direction: 'desc' });
    const [assets, setAssets] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [progress, setProgress] = useState('');
    const [refreshingAssets, setRefreshingAssets] = useState(new Set());
    const [visibleColumns, setVisibleColumns] = useState<any>({
        symbol: true, description: true, totalValue: true, pctAUM: true, clientOwnership: false,
        size: true, style: true, sector: true, securityType: true,
        'perf.1D': true, 'perf.1M': true, 'perf.3M': true, 'perf.6M': true, 'perf.YTD': true, 'perf.1Y': true, 'perf.3Y': true, 'perf.5Y': true
    });
    const [showColMenu, setShowColMenu] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [addClientSearch, setAddClientSearch] = useState('');
    const [showPredictiveMenu, setShowPredictiveMenu] = useState(false);

    // Dynamic Column Switching based on View Mode
    useEffect(() => {
        if (firmViewMode === 'tagging') {
            setVisibleColumns({
                symbol: true, description: true, size: true, style: true, sector: true, securityType: true,
                totalValue: false, pctAUM: false, clientOwnership: false, 'perf.1D': false, 'perf.1M': false, 'perf.3M': false, 'perf.6M': false, 'perf.YTD': false, 'perf.1Y': false, 'perf.3Y': false, 'perf.5Y': false
            });
        } else if (firmViewMode === 'performance') {
            setVisibleColumns({
                symbol: true, totalValue: true, pctAUM: true, 'perf.1D': true, 'perf.1M': true, 'perf.3M': true, 'perf.6M': true, 'perf.YTD': true, 'perf.1Y': true, 'perf.3Y': true, 'perf.5Y': true,
                description: false, size: false, style: false, sector: false, securityType: false, clientOwnership: false
            });
        } else if (firmViewMode === 'ownership') {
            setVisibleColumns({
                symbol: true, clientOwnership: true, pctAUM: true, 'perf.YTD': true, 'perf.1Y': true, 'perf.3Y': true,
                description: false, totalValue: false, size: false, style: false, sector: false, securityType: false, 'perf.1D': false, 'perf.1M': false, 'perf.3M': false, 'perf.6M': false, 'perf.5Y': false
            });
        }
    }, [firmViewMode]);
    
    useEffect(() => {
        const currentClientHash = clients.map((c: any) => c.id + '-' + c.lastUpdated).join('|');
        // If cache exists, clients haven't changed, and it's less than 5 minutes old
        if (globalFirmOverviewCache.assets.length > 0 && 
            globalFirmOverviewCache.clientHash === currentClientHash &&
            Date.now() - globalFirmOverviewCache.lastUpdated < 5 * 60 * 1000) {
            
            setAssets(globalFirmOverviewCache.assets);
            setLoading(false);
            return;
        }

        let totalFirmAUM = 0;
        const assetMap = new Map();

        clients.forEach((client: any) => {
            const accounts = client.accounts || [{ positions: client.positions || [] }];
            accounts.forEach((acc: any) => {
                const positions = acc.positions || [];
                const accountTotal = positions.reduce((sum: number, p: any) => sum + (Number(p.currentValue) || 0), 0);

                positions.forEach((p: any) => {
                    const val = Number(p.currentValue) || 0;
                    totalFirmAUM += val;

                    const symbol = p.symbol.toUpperCase();
                    if (CASH_TICKERS.some(t => symbol.includes(t)) || (p.description && p.description.toUpperCase().includes('CASH')) || p.metadata?.assetClass === 'Cash') {
                        return;
                    }

                    if (!assetMap.has(symbol)) {
                        let bucket = assetOverrides[symbol]?.bucket;
                        
                        if (!bucket) {
                            const isCc = isCoveredCall(p);
                            const isBondPos = isBond(symbol, p.description);
                            const isFund = (symbol.length === 5 && symbol.endsWith('X')) || (p.description && /\b(ETF|FUND|TRUST)\b/i.test(p.description));
                            const isFi = p.metadata?.assetClass === 'Fixed Income' || p.metadata?.assetClass === 'Municipal Bond';

                            if (isCc) {
                                bucket = 'Covered Call';
                            } else if (isBondPos) {
                                bucket = 'Bond';
                            } else if (isFund) {
                                bucket = isFi ? 'Bond Fund' : 'Equity Fund';
                            } else {
                                bucket = 'Stock';
                            }
                        }

                        assetMap.set(symbol, {
                            symbol,
                            description: p.description,
                            bucket,
                            totalValue: 0,
                            pctAUM: 0,
                            perf: { '1D': null, '1M': null, '3M': null, '6M': null, 'YTD': null, '1Y': null, '3Y': null, '5Y': null },
                            metadata: p.metadata,
                            owners: [],
                            clientOwnership: 0
                        });
                    }
                    
                    const existing = assetMap.get(symbol);
                    existing.totalValue += val;
                    existing.owners.push({
                        clientId: client.id,
                        clientName: client.name,
                        accountId: acc.id,
                        accountName: acc.name,
                        quantity: p.quantity,
                        currentValue: val,
                        costBasis: p.costBasis || val,
                        pctOfAccount: accountTotal > 0 ? (val / accountTotal) * 100 : 0,
                        unrealizedGL: val - (p.costBasis || val),
                        unrealizedGLPct: (p.costBasis || val) > 0 ? (val - (p.costBasis || val)) / (p.costBasis || val) : 0,
                        tradeFlag: client.tradeFlags?.[symbol] || 'Hold'
                    });
                });
            });
        });

        Array.from(assetMap.values()).forEach((a: any) => {
            const uniqueClients = new Set(a.owners.map((o: any) => o.clientId));
            a.clientOwnership = uniqueClients.size;
        });

        const uniqueAssets = Array.from(assetMap.values()).map((a: any) => ({
            ...a,
            pctAUM: totalFirmAUM > 0 ? (a.totalValue / totalFirmAUM) * 100 : 0
        }));

        setAssets(uniqueAssets);
        fetchPerformance(uniqueAssets);
    }, [clients]);

    const fetchPerformance = async (uniqueAssets: any[]) => {
        setLoading(true);
        setProgress('Fetching historical data...');
        const end = Math.floor(Date.now() / 1000);
        const start = end - (5 * 365 * 24 * 60 * 60);
        
        const toFetch = uniqueAssets.filter(a => a.bucket !== 'Bonds');
        const batchSize = 15;
        const dataCache: any = {};
        const inFlightRequests = new Map();

        for (let i = 0; i < toFetch.length; i += batchSize) {
            const batch = toFetch.slice(i, i + batchSize);
            setProgress(`Fetching assets... ${i}/${toFetch.length}`);
            await Promise.allSettled(batch.map(async (a) => {
                try { await fetchTiingoGlobal(a.symbol, start, dataCache, inFlightRequests); } catch(e) {}
            }));
        }

        const now = Date.now();
        const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
        
        const getReturn = (data: any, targetTimeMs: number) => {
            if (!data || !data.t || data.t.length < 2) return null;
            
            // Time Traveler Math: Anchor to the LATEST data point, not "now"
            const latestTimeSec = data.t[data.t.length - 1];
            const currentClose = data.c[data.c.length - 1];
            
            // Calculate the delta based on the requested targetTimeMs relative to REAL TIME
            // We need to convert the "targetTimeMs" (which was calculated as Date.now() - X)
            // back into a relative offset from the data's latest point.
            
            // Actually, a cleaner way is to recalculate targetTimeSec based on the timeframe logic
            // But since this function receives `targetTimeMs` as an argument, we need to infer the offset.
            // OR, we can just ignore targetTimeMs and pass the 'timeframe' string?
            // The current architecture passes calculated timestamps. 
            // Let's calculate the "lookback seconds" from Date.now() and apply it to latestTimeSec.
            
            const lookbackMs = Date.now() - targetTimeMs;
            const targetTimeSec = latestTimeSec - (lookbackMs / 1000);
            
            let closestIdx = -1;
            let minDiff = Infinity;
            for (let i = 0; i < data.t.length; i++) {
                const diff = Math.abs(data.t[i] - targetTimeSec);
                if (diff < minDiff) {
                    minDiff = diff;
                    closestIdx = i;
                }
            }
            
            if (closestIdx === -1 || minDiff > 7 * 24 * 60 * 60) return null;
            
            const historicalClose = data.c[closestIdx];
            if (!historicalClose) return null;
            return (currentClose / historicalClose) - 1;
        };

        const updatedAssets = uniqueAssets.map(a => {
            if (a.bucket === 'Bonds') return a;
            const cleanSymbol = a.symbol.toUpperCase().replace(/[\.\/]/g, '-');
            const data = dataCache[cleanSymbol];
            if (!data || !data.c || data.c.length < 2) {
                return {
                    ...a,
                    perf: { '1D': null, '1M': null, '3M': null, '6M': null, 'YTD': null, '1Y': null, '3Y': null, '5Y': null }
                };
            }
            
            const currentClose = data.c[data.c.length - 1];
            const prevClose = data.c[data.c.length - 2];
            
            return {
                ...a,
                perf: {
                    '1D': prevClose ? (currentClose / prevClose) - 1 : null,
                    '1M': getReturn(data, now - (30 * 24 * 60 * 60 * 1000)),
                    '3M': getReturn(data, now - (90 * 24 * 60 * 60 * 1000)),
                    '6M': getReturn(data, now - (180 * 24 * 60 * 60 * 1000)),
                    'YTD': getReturn(data, ytdStart),
                    '1Y': getReturn(data, now - (365 * 24 * 60 * 60 * 1000)),
                    '3Y': getReturn(data, now - (3 * 365 * 24 * 60 * 60 * 1000)),
                    '5Y': getReturn(data, now - (5 * 365 * 24 * 60 * 60 * 1000)),
                }
            };
        });

        globalFirmOverviewCache = {
            assets: updatedAssets,
            lastUpdated: Date.now(),
            clientHash: clients.map((c: any) => c.id + '-' + c.lastUpdated).join('|')
        };
        setAssets(updatedAssets);
        setLoading(false);
    };

    const handleOverrideChange = (symbol: string, field: string, value: string) => {
        const currentOverrides = assetOverrides[symbol] || {};
        let newOverrides = { ...currentOverrides };
        
        if (field === 'size' || field === 'style_factor') {
            const asset = assets.find(a => a.symbol === symbol);
            const currentFullStyle = currentOverrides.style || asset?.metadata?.style || 'Mid-Core';
            const parts = currentFullStyle.split('-');
            const curSize = parts[0];
            const curFactor = parts.length > 1 ? parts[1] : 'Core';
            
            const newSize = field === 'size' ? value : (curSize || 'Mid');
            const newFactor = field === 'style_factor' ? value : (curFactor || 'Core');
            
            newOverrides.style = `${newSize}-${newFactor}`;
        } else {
            newOverrides[field] = value;
        }
        
        setAssetOverrides((prev: any) => ({ ...prev, [symbol]: newOverrides }));
    };

    const handleSort = (key: string) => {
        setSortConfig(prev => ({
            key,
            direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
        }));
    };

    const handleBulkAction = (symbol: string, action: string, owners: any[]) => {
        owners.forEach((owner: any) => {
            const client = clients.find((c: any) => c.id === owner.clientId);
            if (client) {
                onUpdateClient({
                    ...client,
                    tradeFlags: { ...(client.tradeFlags || {}), [symbol]: action.toLowerCase() }
                });
            }
        });
    };

    const handleRefreshAsset = async (symbol: string) => {
        setRefreshingAssets(prev => new Set(prev).add(symbol));
        try {
            // 1. Purge Cache
            const cleanSymbol = symbol.toUpperCase().replace(/[\.\/]/g, '-');
            localStorage.removeItem(`tiingo_${cleanSymbol}_5Y`);

            // 2. Fetch fresh data using the global fetchTiingo
            const end = Math.floor(Date.now() / 1000);
            const start = end - (5 * 365 * 24 * 60 * 60);
            const data = await fetchTiingoGlobal(symbol, start);
            
            // 3. Recalculate Performance Math
            if (data && data.c && data.c.length > 1) {
                const now = Date.now();
                const ytdStart = new Date(new Date().getFullYear(), 0, 1).getTime();
                
                const latestTimeSec = data.t[data.t.length - 1];
                const currentClose = data.c[data.c.length - 1];
                const prevClose = data.c[data.c.length - 2];
                
                const getReturn = (targetTimeMs: number) => {
                    const lookbackMs = Date.now() - targetTimeMs;
                    const targetTimeSec = latestTimeSec - (lookbackMs / 1000);
                    let closestIdx = -1;
                    let minDiff = Infinity;
                    for (let i = 0; i < data.t.length; i++) {
                        const diff = Math.abs(data.t[i] - targetTimeSec);
                        if (diff < minDiff) { minDiff = diff; closestIdx = i; }
                    }
                    if (closestIdx === -1 || minDiff > 7 * 24 * 60 * 60) return null;
                    const historicalClose = data.c[closestIdx];
                    if (!historicalClose) return null;
                    return (currentClose / historicalClose) - 1;
                };
                const newPerf = {
                    '1D': prevClose ? (currentClose / prevClose) - 1 : null,
                    '1M': getReturn(now - (30 * 24 * 60 * 60 * 1000)),
                    '3M': getReturn(now - (90 * 24 * 60 * 60 * 1000)),
                    '6M': getReturn(now - (180 * 24 * 60 * 60 * 1000)),
                    'YTD': getReturn(ytdStart),
                    '1Y': getReturn(now - (365 * 24 * 60 * 60 * 1000)),
                    '3Y': getReturn(now - (3 * 365 * 24 * 60 * 60 * 1000)),
                    '5Y': getReturn(now - (5 * 365 * 24 * 60 * 60 * 1000)),
                };
                
                // 4. Update the specific row
                setAssets(prev => {
                    const nextAssets = prev.map(a => a.symbol === symbol ? { ...a, perf: newPerf } : a);
                    if (typeof globalFirmOverviewCache !== 'undefined') {
                        globalFirmOverviewCache.assets = nextAssets;
                    }
                    return nextAssets;
                });
            } else {
                setAssets(prev => {
                    const nextAssets = prev.map(a => a.symbol === symbol ? { ...a, perf: { '1D': null, '1M': null, '3M': null, '6M': null, 'YTD': null, '1Y': null, '3Y': null, '5Y': null } } : a);
                    if (typeof globalFirmOverviewCache !== 'undefined') {
                        globalFirmOverviewCache.assets = nextAssets;
                    }
                    return nextAssets;
                });
            }
        } catch (e) {
            console.error("Refresh failed", e);
        } finally {
            setRefreshingAssets(prev => {
                const next = new Set(prev);
                next.delete(symbol);
                return next;
            });
        }
    };

    const sortedAssets = useMemo(() => {
        const filtered = assets.filter(a => {
            const currentBucket = assetOverrides[a.symbol]?.bucket || a.bucket;
            return activeTab === 'All' || currentBucket === activeTab;
        });
        if (!sortConfig.key) return filtered;

        return [...filtered].sort((a, b) => {
            let valA = a[sortConfig.key];
            let valB = b[sortConfig.key];
            
            if (sortConfig.key.startsWith('perf.')) {
                const perfKey = sortConfig.key.split('.')[1];
                valA = a.perf[perfKey];
                valB = b.perf[perfKey];
            }

            if (valA === null || valA === undefined) return 1;
            if (valB === null || valB === undefined) return -1;

            if (typeof valA === 'string') {
                return sortConfig.direction === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
            }
            return sortConfig.direction === 'asc' ? valA - valB : valB - valA;
        });
    }, [assets, activeTab, sortConfig, assetOverrides]);

    const renderSortIcon = (key: string) => {
        if (sortConfig.key !== key) return null;
        return sortConfig.direction === 'asc' ? <ChevronUp className="inline h-3 w-3 ml-1" /> : <ChevronDown className="inline h-3 w-3 ml-1" />;
    };

    const formatPerf = (val: any) => {
        if (val === null || val === undefined) return <span className="text-zinc-600">--</span>;
        const num = Number(val) * 100;
        return <span className={num >= 0 ? 'text-green-400' : 'text-red-400'}>{num > 0 ? '+' : ''}{num.toFixed(2)}%</span>;
    };

    const columns = activeTab === 'Bonds' 
        ? [
            { key: 'symbol', label: 'Ticker' },
            { key: 'description', label: 'Asset Name' },
            { key: 'sector', label: 'Sector' },
            { key: 'totalValue', label: 'Total Firm Value ($)' },
            { key: 'pctAUM', label: '% of Firm AUM' },
            { key: 'clientOwnership', label: 'Owners' }
        ]
        : [
            { key: 'symbol', label: 'Ticker' },
            { key: 'description', label: 'Asset Name' },
            { key: 'totalValue', label: 'Total Firm Value ($)' },
            { key: 'pctAUM', label: '% of Firm AUM' },
            { key: 'clientOwnership', label: 'Owners' },
            { key: 'securityType', label: 'Security Type' },
            { key: 'size', label: 'Size' },
            { key: 'style', label: 'Style' },
            { key: 'sector', label: 'Sector' },
            { key: 'perf.1D', label: '1D' },
            { key: 'perf.1M', label: '1M' },
            { key: 'perf.3M', label: '3M' },
            { key: 'perf.6M', label: '6M' },
            { key: 'perf.YTD', label: 'YTD' },
            { key: 'perf.1Y', label: '1Y' },
            { key: 'perf.3Y', label: '3Y' },
            { key: 'perf.5Y', label: '5Y' },
        ];

    const visibleCols = columns.filter(c => visibleColumns[c.key] !== false);

    return (
        <div className="p-8 max-w-7xl mx-auto h-full flex flex-col">
            <div className="mb-8 flex justify-between items-end">
                <div>
                    <h1 className="text-3xl font-black text-white tracking-tighter mb-2">Firm Overview</h1>
                    <p className="text-zinc-500 font-medium">Aggregate position exposure and performance across all clients.</p>
                </div>
                <div className="flex items-center gap-3 relative">
                    <div className="inline-flex items-center bg-zinc-900 border border-zinc-800 rounded-full shadow-lg overflow-hidden h-8">
                        <button 
                            onClick={async () => {
                                setIsRefreshing(true);
                                try {
                                    await fetchPerformance(assets);
                                } finally {
                                    setTimeout(() => setIsRefreshing(false), 750);
                                }
                            }} 
                            className="px-3 h-full hover:bg-zinc-800 text-zinc-500 hover:text-white transition-colors border-r border-zinc-800"
                            title="Refresh Performance"
                            disabled={isRefreshing}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin text-blue-400' : 'text-zinc-400'}`} />
                        </button>
                        <button 
                            onClick={() => setFirmViewMode('tagging')} 
                            className={`px-3 h-full hover:bg-zinc-800 transition-colors border-r border-zinc-800 ${firmViewMode === 'tagging' ? 'text-white bg-zinc-800' : 'text-zinc-500'}`}
                            title="Tagging Mode"
                        >
                            <Tag className="h-3.5 w-3.5" />
                        </button>
                        <button 
                            onClick={() => setFirmViewMode('performance')} 
                            className={`px-3 h-full hover:bg-zinc-800 transition-colors border-r border-zinc-800 ${firmViewMode === 'performance' ? 'text-white bg-zinc-800' : 'text-zinc-500'}`}
                            title="Performance Mode"
                        >
                            <BarChart2 className="h-3.5 w-3.5" />
                        </button>
                        <button 
                            onClick={() => setFirmViewMode('ownership')} 
                            className={`px-3 h-full hover:bg-zinc-800 transition-colors border-r border-zinc-800 ${firmViewMode === 'ownership' ? 'text-white bg-zinc-800' : 'text-zinc-500'}`}
                            title="Ownership View"
                        >
                            <Users className="h-3.5 w-3.5" />
                        </button>
                        <button 
                            onClick={() => setShowColMenu(!showColMenu)} 
                            className={`px-3 h-full hover:bg-zinc-800 transition-colors ${showColMenu ? 'text-white bg-zinc-800' : 'text-zinc-500'}`}
                            title="Column Visibility"
                        >
                            <Settings className="h-3.5 w-3.5" />
                        </button>
                    </div>

                    {showColMenu && (
                        <div className="absolute right-0 top-10 bg-zinc-900 border border-zinc-800 rounded-xl p-4 w-64 shadow-2xl z-50">
                            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-3">Visible Columns</h4>
                            <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                                {Object.keys(visibleColumns).map(key => (
                                    <label key={key} className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer hover:text-white">
                                        <input 
                                            type="checkbox" 
                                            checked={visibleColumns[key]} 
                                            onChange={() => setVisibleColumns(prev => ({ ...prev, [key]: !prev[key] }))}
                                            className="rounded border-zinc-700 bg-zinc-950 text-blue-500 focus:ring-0"
                                        />
                                        {key.replace('perf.', '')}
                                    </label>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex bg-zinc-950 p-1 rounded-xl mb-6 border border-zinc-800 w-fit">
                {['All', 'Stock', 'Equity Fund', 'Covered Call', 'Bond Fund', 'Bond'].map(tab => (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`px-6 py-2 text-xs font-black uppercase tracking-widest rounded-lg transition-all ${activeTab === tab ? 'bg-zinc-800 text-white shadow-md' : 'text-zinc-500 hover:text-zinc-300'}`}
                    >
                        {tab}
                    </button>
                ))}
            </div>

            <div className="flex-1 bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col">
                {loading ? (
                    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-zinc-500">
                        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                        <span className="text-xs font-black uppercase tracking-widest">{progress}</span>
                    </div>
                ) : (
                    <div className="overflow-auto custom-scrollbar flex-1">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-zinc-900 border-b border-zinc-800 z-10">
                                <tr>
                                    {visibleCols.map(col => (
                                        <th 
                                            key={col.key} 
                                            onClick={() => handleSort(col.key)}
                                            className="p-4 text-[10px] font-black uppercase tracking-widest text-zinc-500 cursor-pointer hover:text-zinc-300 transition-colors whitespace-nowrap"
                                        >
                                            {col.label} {renderSortIcon(col.key)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {sortedAssets.map((a, i) => {
                                    const overrides = assetOverrides[a.symbol] || {};
                                    const fullStyle = overrides.style || a.metadata?.style || 'Mid-Core';
                                    const [size, styleFactor] = fullStyle.split('-');
                                    const sector = overrides.sector || a.metadata?.sector || 'Misc';

                                     return (
                                        <React.Fragment key={i}>
                                            <tr onClick={() => {
                                                if (firmViewMode === 'ownership') {
                                                    setExpandedAsset(expandedAsset === a.symbol ? null : a.symbol);
                                                    setAddClientSearch('');
                                                }
                                            }} className={`border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors group ${firmViewMode === 'ownership' ? 'cursor-pointer' : ''}`}>
                                                {visibleCols.map(col => (
                                                    <td key={col.key} className="p-4">
                                                        {col.key === 'symbol' ? (
                                                            <div className="flex items-center gap-2">
                                                                <span className="font-bold text-white">{a.symbol}</span>
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); handleRefreshAsset(a.symbol); }}
                                                                    className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-zinc-800 rounded"
                                                                    disabled={refreshingAssets.has(a.symbol)}
                                                                    title="Force Refresh Data"
                                                                >
                                                                    {refreshingAssets.has(a.symbol) ? <Loader2 className="h-3 w-3 animate-spin text-zinc-400" /> : <RefreshCw className="h-3 w-3 text-zinc-500 hover:text-white" />}
                                                                </button>
                                                            </div>
                                                        ) :
                                                         col.key === 'description' ? <span className="text-zinc-400 text-sm truncate max-w-[200px] block" title={a.description}>{a.description}</span> :
                                                         col.key === 'totalValue' ? <span className="font-mono text-zinc-300">{formatCurrency(a.totalValue)}</span> :
                                                         col.key === 'pctAUM' ? <span className="font-mono text-zinc-300">{a.pctAUM.toFixed(2)}%</span> :
                                                         col.key === 'clientOwnership' ? <span className="font-mono text-zinc-300">{a.clientOwnership}</span> :
                                                         col.key === 'size' ? (
                                                        <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 w-fit">
                                                            {['Small', 'Mid', 'Large'].map(o => {
                                                                const label = o === 'Small' ? 'Sm' : o === 'Mid' ? 'Med' : 'Lg';
                                                                const isActive = (size || 'Mid') === o;
                                                                return (
                                                                    <button 
                                                                        key={o}
                                                                        onClick={() => handleOverrideChange(a.symbol, 'size', o)}
                                                                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-400'}`}
                                                                    >
                                                                        {label}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                     ) :
                                                     col.key === 'style' ? (
                                                        <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 w-fit">
                                                            {['Value', 'Core', 'Growth'].map(o => {
                                                                const isActive = (styleFactor || 'Core') === o;
                                                                return (
                                                                    <button 
                                                                        key={o}
                                                                        onClick={() => handleOverrideChange(a.symbol, 'style_factor', o)}
                                                                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-400'}`}
                                                                    >
                                                                        {o}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                     ) :
                                                     col.key === 'sector' ? (
                                                        <select 
                                                            className="bg-transparent text-xs text-zinc-300 font-medium focus:outline-none focus:text-white cursor-pointer hover:bg-zinc-800 rounded px-1 -ml-1 py-0.5 max-w-[120px]"
                                                            value={sector}
                                                            onChange={(e) => handleOverrideChange(a.symbol, 'sector', e.target.value)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {['Technology', 'Healthcare', 'Financial Services', 'Real Estate', 'Energy', 'Industrials', 'Communication Services', 'Consumer Defensive', 'Consumer Cyclical', 'Utilities', 'Basic Materials', 'Diversified Fund', 'Unclassified'].map(o => <option key={o} value={o} className="bg-zinc-900">{o}</option>)}
                                                        </select>
                                                     ) :
                                                     col.key === 'securityType' ? (
                                                        <div className="flex bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 w-fit">
                                                            {['Stock', 'Equity Fund', 'Covered Call', 'Bond Fund', 'Bond'].map(o => {
                                                                const isActive = (overrides.bucket || a.bucket) === o;
                                                                return (
                                                                    <button 
                                                                        key={o}
                                                                        onClick={() => handleOverrideChange(a.symbol, 'bucket', o)}
                                                                        className={`px-2 py-0.5 text-[10px] font-bold rounded-md transition-all ${isActive ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-400'}`}
                                                                    >
                                                                        {o}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                     ) :
                                                     col.key.startsWith('perf.') ? <span className="font-mono text-sm">{formatPerf(a.perf[col.key.split('.')[1]])}</span> :
                                                     null}
                                                </td>
                                            ))}
                                        </tr>
                                        {expandedAsset === a.symbol && firmViewMode === 'ownership' && (
                                            <tr>
                                                <td colSpan={visibleCols.length} className="p-0">
                                                    <div className="bg-zinc-950/80 inset-shadow p-6 border-b border-zinc-800/50">
                                                        <div className="flex items-center justify-between mb-4">
                                                            <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500">Ownership Details: {a.symbol}</h4>
                                                            <div className="flex items-center gap-3">
                                                                <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">Apply to All:</span>
                                                                <div className="inline-flex bg-zinc-900 rounded-full border border-zinc-800 overflow-hidden">
                                                                    {['Buy', 'Hold', 'Sell'].map(action => (
                                                                        <button
                                                                            key={action}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                handleBulkAction(a.symbol, action, a.owners);
                                                                            }}
                                                                            className="px-3 py-1 text-[10px] font-bold text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 transition-colors"
                                                                        >
                                                                            {action}
                                                                        </button>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        </div>
                                                        <table className="w-full text-left text-sm">
                                                            <thead>
                                                                <tr className="border-b border-zinc-800/50">
                                                                    <th className="p-2 text-zinc-500 font-bold cursor-pointer hover:text-white transition-colors" onClick={() => setSubSort({ key: 'clientName', direction: subSort.key === 'clientName' && subSort.direction === 'asc' ? 'desc' : 'asc' })}>Client Name {subSort.key === 'clientName' ? (subSort.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                                                    <th className="p-2 text-zinc-500 font-bold cursor-pointer hover:text-white transition-colors text-right" onClick={() => setSubSort({ key: 'currentValue', direction: subSort.key === 'currentValue' && subSort.direction === 'asc' ? 'desc' : 'asc' })}>Holdings ($) {subSort.key === 'currentValue' ? (subSort.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                                                    <th className="p-2 text-zinc-500 font-bold cursor-pointer hover:text-white transition-colors text-right" onClick={() => setSubSort({ key: 'pctOfAccount', direction: subSort.key === 'pctOfAccount' && subSort.direction === 'asc' ? 'desc' : 'asc' })}>% of Account {subSort.key === 'pctOfAccount' ? (subSort.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                                                    <th className="p-2 text-zinc-500 font-bold cursor-pointer hover:text-white transition-colors text-right" onClick={() => setSubSort({ key: 'unrealizedGL', direction: subSort.key === 'unrealizedGL' && subSort.direction === 'asc' ? 'desc' : 'asc' })}>$ G/L {subSort.key === 'unrealizedGL' ? (subSort.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                                                    <th className="p-2 text-zinc-500 font-bold cursor-pointer hover:text-white transition-colors text-right" onClick={() => setSubSort({ key: 'unrealizedGLPct', direction: subSort.key === 'unrealizedGLPct' && subSort.direction === 'asc' ? 'desc' : 'asc' })}>% G/L {subSort.key === 'unrealizedGLPct' ? (subSort.direction === 'asc' ? '↑' : '↓') : ''}</th>
                                                                    <th className="p-2 text-zinc-500 font-bold text-center">Action</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {[...a.owners].sort((x, y) => {
                                                                    const valX = x[subSort.key];
                                                                    const valY = y[subSort.key];
                                                                    if (valX < valY) return subSort.direction === 'asc' ? -1 : 1;
                                                                    if (valX > valY) return subSort.direction === 'asc' ? 1 : -1;
                                                                    return 0;
                                                                }).map((owner: any, idx) => {
                                                                    const liveClient = clients.find((c: any) => c.id === owner.clientId);
                                                                    const currentTradeFlag = liveClient?.tradeFlags?.[a.symbol] || 'hold';
                                                                    
                                                                    return (
                                                                        <tr key={idx} className="border-b border-zinc-800/20 hover:bg-zinc-900/50 transition-colors">
                                                                            <td className="p-2 text-white font-medium">{owner.clientName} <span className="text-zinc-600 text-xs ml-2">({owner.accountName})</span></td>
                                                                            <td className="p-2 text-right font-mono text-zinc-300">{formatCurrency(owner.currentValue)}</td>
                                                                            <td className="p-2 text-right font-mono text-zinc-300">{owner.pctOfAccount.toFixed(2)}%</td>
                                                                            <td className={`p-2 text-right font-mono ${owner.unrealizedGL >= 0 ? 'text-green-400' : 'text-red-400'}`}>{owner.unrealizedGL > 0 ? '+' : ''}{formatCurrency(owner.unrealizedGL)}</td>
                                                                            <td className={`p-2 text-right font-mono ${owner.unrealizedGLPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>{owner.unrealizedGLPct > 0 ? '+' : ''}{(owner.unrealizedGLPct * 100).toFixed(2)}%</td>
                                                                            <td className="p-2 text-center">
                                                                                <div className="inline-flex bg-zinc-900 rounded-full border border-zinc-800 overflow-hidden">
                                                                                    {['Buy', 'Hold', 'Sell'].map(action => (
                                                                                        <button
                                                                                            key={action}
                                                                                            onClick={(e) => {
                                                                                                e.stopPropagation();
                                                                                                const clientToUpdate = clients.find((c: any) => c.id === owner.clientId);
                                                                                                if (clientToUpdate) {
                                                                                                    onUpdateClient({
                                                                                                        ...clientToUpdate,
                                                                                                        tradeFlags: { ...(clientToUpdate.tradeFlags || {}), [a.symbol]: action.toLowerCase() }
                                                                                                    });
                                                                                                }
                                                                                            }}
                                                                                            className={`px-3 py-1 text-xs font-bold transition-colors ${currentTradeFlag.toLowerCase() === action.toLowerCase() ? (action === 'Buy' ? 'bg-green-500/20 text-green-400' : action === 'Sell' ? 'bg-red-500/20 text-red-400' : 'bg-zinc-700 text-white') : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'}`}
                                                                                        >
                                                                                            {action}
                                                                                        </button>
                                                                                    ))}
                                                                                </div>
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                        <div className="mt-4">
                                                            <div className="relative w-full max-w-sm">
                                                                <input 
                                                                    type="text"
                                                                    placeholder={`Type a name to add a client to ${a.symbol}...`}
                                                                    value={addClientSearch}
                                                                    onChange={(e) => {
                                                                        setAddClientSearch(e.target.value);
                                                                        setShowPredictiveMenu(true);
                                                                    }}
                                                                    onFocus={() => setShowPredictiveMenu(true)}
                                                                    className="w-full bg-zinc-950 border border-zinc-800 text-white px-4 py-2 rounded-xl focus:outline-none focus:border-zinc-700 text-sm"
                                                                />
                                                                {showPredictiveMenu && addClientSearch && (
                                                                    <div className="absolute bottom-full mb-2 w-full bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto custom-scrollbar">
                                                                        {(() => {
                                                                            const nonOwners = clients.filter((c: any) => !a.owners.some((o: any) => o.clientId === c.id));
                                                                            const filteredNonOwners = nonOwners.filter((c: any) => c.name.toLowerCase().includes(addClientSearch.toLowerCase()));
                                                                            
                                                                            if (filteredNonOwners.length > 0) {
                                                                                return filteredNonOwners.map((client: any) => (
                                                                                    <button
                                                                                        key={client.id}
                                                                                        onClick={() => {
                                                                                            const newPosition = {
                                                                                                id: generateId(),
                                                                                                symbol: a.symbol,
                                                                                                description: a.description,
                                                                                                quantity: 0,
                                                                                                price: a.totalValue > 0 ? (a.totalValue / a.owners.reduce((sum: number, o: any) => sum + o.quantity, 0)) : 0,
                                                                                                currentValue: 0,
                                                                                                costBasis: 0,
                                                                                                metadata: a.metadata
                                                                                            };

                                                                                            let updatedClient = { ...client };
                                                                                            
                                                                                            if (updatedClient.accounts && updatedClient.accounts.length > 0) {
                                                                                                const newAccounts = [...updatedClient.accounts];
                                                                                                const primaryAccount = newAccounts[0];
                                                                                                if (!primaryAccount.positions.some((p: any) => p.symbol === a.symbol)) {
                                                                                                    primaryAccount.positions = [...primaryAccount.positions, newPosition];
                                                                                                }
                                                                                                updatedClient.accounts = newAccounts;
                                                                                            } else {
                                                                                                const newPositions = [...(updatedClient.positions || [])];
                                                                                                if (!newPositions.some((p: any) => p.symbol === a.symbol)) {
                                                                                                    newPositions.push(newPosition);
                                                                                                }
                                                                                                updatedClient.positions = newPositions;
                                                                                            }

                                                                                            onUpdateClient({
                                                                                                ...updatedClient,
                                                                                                lastUpdated: new Date().toISOString(),
                                                                                                tradeFlags: { ...(updatedClient.tradeFlags || {}), [a.symbol]: 'buy' }
                                                                                            });
                                                                                            setAddClientSearch('');
                                                                                            setShowPredictiveMenu(false);
                                                                                        }}
                                                                                        className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors border-b border-zinc-800/50 last:border-0"
                                                                                    >
                                                                                        {client.name}
                                                                                    </button>
                                                                                ));
                                                                            } else {
                                                                                return <div className="px-4 py-3 text-sm text-zinc-500 italic">No matching clients found.</div>;
                                                                            }
                                                                        })()}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    );
                                })}
                                {sortedAssets.length === 0 && (
                                    <tr>
                                        <td colSpan={visibleCols.length} className="p-8 text-center text-zinc-500 font-medium">
                                            No assets found in this category.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

const LoginScreen = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      if (isSignUp) await createUserWithEmailAndPassword(auth, email, password);
      else await signInWithEmailAndPassword(auth, email, password);
    } catch (err) {
      setError(err.message.replace('Firebase: ', ''));
    } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative overflow-hidden">
      <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-blue-900/20 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[10%] -right-[10%] w-[40%] h-[40%] rounded-full bg-indigo-900/20 blur-[120px] pointer-events-none" />

      <div className="bg-zinc-900/40 backdrop-blur-2xl border border-zinc-800 rounded-3xl p-8 w-full max-w-md shadow-2xl relative z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="h-16 w-16 rounded-xl overflow-hidden flex items-center justify-center bg-zinc-900 border border-zinc-800 shadow-lg p-1 mb-4">
            <img 
                src="/ACG Lion SVG.svg" 
                alt="ACG Lion Logo" 
                className="h-full w-full object-contain" 
                onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fallback = document.createElement('div');
                    fallback.className = "h-full w-full bg-blue-600 flex items-center justify-center text-white font-black text-xl";
                    fallback.innerText = "IA";
                    if (e.currentTarget.parentNode) {
                        e.currentTarget.parentNode.appendChild(fallback);
                    }
                }}
            />
          </div>
          <h2 className="text-3xl font-black text-white tracking-tighter">Terminal Access</h2>
          <p className="text-zinc-500 font-medium text-sm mt-1">Authenticate to securely load your portfolios.</p>
        </div>
        {error && <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl mb-6 text-center">{error}</div>}
        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Email Address</label>
            <input type="email" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-medium focus:outline-none focus:border-blue-500 transition-colors" value={email} onChange={e => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase tracking-widest text-zinc-500 mb-2">Password</label>
            <input type="password" required className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-white font-medium focus:outline-none focus:border-blue-500 transition-colors" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <Button variant="primary" loading={loading} className="w-full h-12 rounded-xl mt-4">
            {isSignUp ? 'Create Workspace' : 'Secure Login'}
          </Button>
        </form>
        <div className="mt-6 text-center">
          <button onClick={() => { setIsSignUp(!isSignUp); setError(''); }} className="text-xs text-zinc-500 hover:text-white transition-colors">
            {isSignUp ? 'Already have an account? Sign In' : 'Need a workspace? Sign Up'}
          </button>
        </div>
      </div>
    </div>
  );
};

const getBillingInfo = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-11
  
  let currentQuarterStartMonth;
  let nextQuarterStartMonth;
  let nextQuarterYear = year;

  if (month < 3) {
    currentQuarterStartMonth = 0;
    nextQuarterStartMonth = 3;
  } else if (month < 6) {
    currentQuarterStartMonth = 3;
    nextQuarterStartMonth = 6;
  } else if (month < 9) {
    currentQuarterStartMonth = 6;
    nextQuarterStartMonth = 9;
  } else {
    currentQuarterStartMonth = 9;
    nextQuarterStartMonth = 0;
    nextQuarterYear = year + 1;
  }

  const currentQuarterStart = new Date(year, currentQuarterStartMonth, 1);
  const nextQuarterStart = new Date(nextQuarterYear, nextQuarterStartMonth, 1);

  const totalDays = Math.round((nextQuarterStart.getTime() - currentQuarterStart.getTime()) / (1000 * 60 * 60 * 24));
  const daysElapsed = Math.round((now.getTime() - currentQuarterStart.getTime()) / (1000 * 60 * 60 * 24));
  const daysRemaining = totalDays - daysElapsed;

  return {
    nextBillingDate: nextQuarterStart,
    totalDays,
    daysElapsed,
    daysRemaining
  };
};

export default function App() {
  const [defaultViewType, setDefaultViewType] = useState(() => localStorage.getItem('app_default_view') || 'standard');
  const [activeViewType, setActiveViewType] = useState(defaultViewType);
  const [hasUnsavedCustomChanges, setHasUnsavedCustomChanges] = useState(false);
  const [globalCustomView, setGlobalCustomView] = useState(() => {
    try {
      const saved = localStorage.getItem('global_custom_view');
      return saved ? JSON.parse(saved) : {
        name: 'Custom View',
        framework: 'standard', // 'standard' (List) or 'modular'
        isCompact: false,
        columns: DEFAULT_COLUMNS
      };
    } catch (e) {
      return {
        name: 'Custom View',
        framework: 'standard',
        isCompact: false,
        columns: DEFAULT_COLUMNS
      };
    }
  });

  useEffect(() => {
    localStorage.setItem('global_custom_view', JSON.stringify(globalCustomView));
  }, [globalCustomView]);

  useEffect(() => {
    localStorage.setItem('app_default_view', defaultViewType);
  }, [defaultViewType]);

  const [viewPreferences, setViewPreferences] = useState({
    layout: 'standard', // 'standard', 'modular', or 'custom'
    isCompact: false
  });

  const [view, setView] = useState('clients');
  const [isInsightResizingUnlocked, setIsInsightResizingUnlocked] = useState(false);

  const [userProfile, setUserProfile] = useState(() => {
    const saved = localStorage.getItem('user_profile_settings');
    return saved ? JSON.parse(saved) : {
        fullName: '',
        firmName: '',
        email: '',
        password: '',
        crdNumber: '',
        phone: '',
        twoFactorEnabled: false
    };
  });

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 12) return "Good morning";
    if (hour >= 12 && hour < 18) return "Good afternoon";
    return "Good evening";
  };

  const [clients, setClients] = useState<Client[]>([]);
  const [models, setModels] = useState<any[]>([]);
  const [bgLibrary, setBgLibrary] = useState<any[]>([]);
  const [assetOverrides, setAssetOverrides] = useState<any>({});
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [route, setRoute] = useState({ path: '/', params: {} });

  useEffect(() => {
    if (route.path === '/client') {
      setActiveViewType(defaultViewType);
    }
  }, [route.path, route.params.id, defaultViewType]);

  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [customBg, setCustomBg] = useState(() => localStorage.getItem('user_custom_bg') || '');
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('theme_mode') || 'dark');
  const [themeFlavor, setThemeFlavor] = useState(() => localStorage.getItem('theme_flavor') || 'zinc');
  const [accentColor, setAccentColor] = useState(() => localStorage.getItem('theme_accent') || 'blue');
  const [tierSettings, setTierSettings] = useState(() => JSON.parse(localStorage.getItem('tier_settings')) || { mode: 'relative', thresholds: { A: 10, B: 25, C: 50, D: 75 } });
  const [insightThresholds, setInsightThresholds] = useState(() => {
      const stored = JSON.parse(localStorage.getItem('insight_thresholds') || 'null');
      if (stored) {
          if (stored.cashMarginAlert !== undefined && stored.excessCashThreshold === undefined) {
              stored.excessCashThreshold = 10.0;
              delete stored.cashMarginAlert;
          }
          return stored;
      }
      return {
          excessCashThreshold: 10.0,
          fcashExposure: 10,
          taxLossOpportunity: -2000,
          concentrationRisk: 15,
          stalePortfolioDays: 30,
          bondMaturityDays: 60,
          insufficientCash: 0.5
      };
  });
  const [insightLayout, setInsightLayout] = useState(() => {
      try {
          const parsed = JSON.parse(localStorage.getItem('insight_layout') || 'null');
          if (parsed) {
              return Array.isArray(parsed) ? parsed : Object.values(parsed);
          }
          return DEFAULT_INSIGHT_LAYOUT;
      } catch (e) {
          return DEFAULT_INSIGHT_LAYOUT;
      }
  });

  useEffect(() => {
    localStorage.setItem('insight_layout', JSON.stringify(insightLayout));
    if (auth.currentUser) {
      setDoc(doc(db, 'users', auth.currentUser.uid, 'settings', 'insight_layout'), { layout: insightLayout });
    }
  }, [insightLayout]);

  const [user, setUser] = useState<any>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  useEffect(() => {
    if ((import.meta as any).env.DEV) {
      setUser({ uid: 'developer_local_123', email: 'dev@localhost' });
      setIsAuthLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 1. Fetch data from Cloud on Login
  useEffect(() => {
    if (!user) return;

    const loadUserData = async () => {
      setIsDataLoading(true);
      try {
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          setClients(data.clients || []);
          setModels(data.models || []);
          setAssetOverrides(data.assetOverrides || {});
          
          let loadedLibrary = data.bgLibrary || [];
          if (loadedLibrary.length === 0 && customBg) {
              loadedLibrary = [{ id: 'default', url: customBg, timestamp: new Date().toISOString() }];
          }
          setBgLibrary(loadedLibrary);
          
          // --- NEW: Sync Cloud Settings to Local Storage ---
          if (data.settings) {
            if (data.settings.finnhub) localStorage.setItem('user_finnhub_key', data.settings.finnhub);
            if (data.settings.tiingo) localStorage.setItem('user_tiingo_key', data.settings.tiingo);
            if (data.settings.gemini) localStorage.setItem('user_gemini_key', data.settings.gemini);
            if (data.settings.logoDev) localStorage.setItem('user_logo_dev_key', data.settings.logoDev);
            if (data.globalCustomView) { setGlobalCustomView(data.globalCustomView); localStorage.setItem('global_custom_view', JSON.stringify(data.globalCustomView)); }
            if (data.settings.themeMode) { setThemeMode(data.settings.themeMode); localStorage.setItem('theme_mode', data.settings.themeMode); }
            if (data.settings.themeFlavor) { setThemeFlavor(data.settings.themeFlavor); localStorage.setItem('theme_flavor', data.settings.themeFlavor); }
            if (data.settings.themeAccent) { setAccentColor(data.settings.themeAccent); localStorage.setItem('theme_accent', data.settings.themeAccent); }
            if (data.settings.defaultViewType) { setDefaultViewType(data.settings.defaultViewType); localStorage.setItem('app_default_view', data.settings.defaultViewType); }
            if (data.tierSettings) { setTierSettings(data.tierSettings); localStorage.setItem('tier_settings', JSON.stringify(data.tierSettings)); }
            if (data.insightThresholds) { 
                const thresholds = data.insightThresholds;
                if (thresholds.cashMarginAlert !== undefined && thresholds.excessCashThreshold === undefined) {
                    thresholds.excessCashThreshold = 10.0;
                    delete thresholds.cashMarginAlert;
                }
                setInsightThresholds(thresholds); 
                localStorage.setItem('insight_thresholds', JSON.stringify(thresholds)); 
            }
            if (data.insightLayout) {
                setInsightLayout(data.insightLayout);
                localStorage.setItem('insight_layout', JSON.stringify(data.insightLayout));
            }
          }
        } else {
           // Auto-Migration
           const localClients = JSON.parse(localStorage.getItem('rebalance_db_v4') || '[]');
           const localModels = JSON.parse(localStorage.getItem('rebalance_models') || '[]');
           const localOverrides = JSON.parse(localStorage.getItem('rebalance_asset_overrides') || '{}');
           
           const initialSettings = {
               finnhub: localStorage.getItem('user_finnhub_key') || '',
               tiingo: localStorage.getItem('user_tiingo_key') || '',
               gemini: localStorage.getItem('user_gemini_key') || '',
               logoDev: localStorage.getItem('user_logo_dev_key') || '',
               themeMode: localStorage.getItem('theme_mode') || 'dark',
               themeFlavor: localStorage.getItem('theme_flavor') || 'zinc',
               themeAccent: localStorage.getItem('theme_accent') || 'blue',
               defaultViewType: localStorage.getItem('app_default_view') || 'standard'
           };
           
           const initialTierSettings = JSON.parse(localStorage.getItem('tier_settings') || '{"mode":"relative","thresholds":{"A":10,"B":25,"C":50,"D":75}}');
           const initialInsightThresholds = JSON.parse(localStorage.getItem('insight_thresholds') || '{"excessCashThreshold":10.0,"fcashExposure":10,"taxLossOpportunity":-2000,"concentrationRisk":15,"stalePortfolioDays":30,"bondMaturityDays":60,"insufficientCash":0.5}');
           if (initialInsightThresholds.cashMarginAlert !== undefined && initialInsightThresholds.excessCashThreshold === undefined) {
               initialInsightThresholds.excessCashThreshold = 10.0;
               delete initialInsightThresholds.cashMarginAlert;
           }
           const initialGlobalCustomView = JSON.parse(localStorage.getItem('global_custom_view') || JSON.stringify({ name: 'Custom View', framework: 'standard', isCompact: false, columns: DEFAULT_COLUMNS }));
           let initialInsightLayout = JSON.parse(localStorage.getItem('insight_layout') || 'null');
           if (initialInsightLayout) {
               initialInsightLayout = Array.isArray(initialInsightLayout) ? initialInsightLayout : Object.values(initialInsightLayout);
           } else {
               initialInsightLayout = DEFAULT_INSIGHT_LAYOUT;
           }
           
           setClients(localClients);
           setModels(localModels);
           setAssetOverrides(localOverrides);
           setTierSettings(initialTierSettings);
           setInsightThresholds(initialInsightThresholds);
           setGlobalCustomView(initialGlobalCustomView);
           setInsightLayout(initialInsightLayout);
           
           await setDoc(docRef, JSON.parse(JSON.stringify({
               clients: localClients,
               models: localModels,
               assetOverrides: localOverrides,
               settings: initialSettings,
               tierSettings: initialTierSettings,
               insightThresholds: initialInsightThresholds,
               globalCustomView: initialGlobalCustomView,
               insightLayout: initialInsightLayout
           })));
        }
      } catch (error) {
        console.error("Error loading cloud data:", error);
      } finally {
        setIsDataLoading(false);
      }
    };
    loadUserData();
  }, [user]);

  // 2. Save to Cloud on Data Change (Debounced)
  useEffect(() => {
    // Don't save if we aren't logged in, or if we are still downloading the initial data!
    if (!user || isDataLoading) return;

    // Keep local storage synced as an offline backup (immediate)
    localStorage.setItem('rebalance_db_v4', JSON.stringify(clients));
    localStorage.setItem('rebalance_models', JSON.stringify(models));
    localStorage.setItem('rebalance_asset_overrides', JSON.stringify(assetOverrides));
    localStorage.setItem('tier_settings', JSON.stringify(tierSettings));
    localStorage.setItem('insight_thresholds', JSON.stringify(insightThresholds));
    localStorage.setItem('global_custom_view', JSON.stringify(globalCustomView));
    localStorage.setItem('insight_layout', JSON.stringify(insightLayout));
    localStorage.setItem('app_default_view', defaultViewType);

    const timeoutId = setTimeout(async () => {
      try {
        await setDoc(doc(db, "users", user.uid), JSON.parse(JSON.stringify({
          clients,
          models,
          assetOverrides,
          bgLibrary,
          tierSettings,
          insightThresholds,
          globalCustomView,
          insightLayout,
          settings: {
            defaultViewType
          }
        })), { merge: true });
      } catch (e) {
        console.error("Error saving to cloud", e);
      }
    }, 2000); // 2 second debounce to prevent rate limiting

    return () => clearTimeout(timeoutId);
  }, [clients, models, assetOverrides, user, isDataLoading, bgLibrary, globalCustomView, defaultViewType]);

  useEffect(() => {
      const loadCloudBg = async () => {
          if (!user) return;
          try {
              const bgRef = ref(storage, `users/${user.uid}/custom_bg`);
              const url = await getDownloadURL(bgRef);
              setCustomBg(url);
          } catch (e) {
              // If no cloud image exists, check if they have a legacy local one
              const legacy = localStorage.getItem('user_custom_bg');
              if (legacy) setCustomBg(legacy);
          }
      };
      loadCloudBg();
  }, [user]);

  const activeClient = route.path === '/client' ? clients.find(c => c.id === route.params.id) : null;

  useEffect(() => {
    if (route.path === '/client' && !activeClient) setRoute({ path: '/', params: {} });
  }, [route, activeClient]);

  const handleAddToLibrary = async (dataUrl: string) => {
    const uniqueId = generateId();
    const bgRef = ref(storage, `users/${user.uid}/library/${uniqueId}`);
    await uploadString(bgRef, dataUrl, 'data_url');
    const downloadUrl = await getDownloadURL(bgRef);
    
    const newEntry = { id: uniqueId, url: downloadUrl, timestamp: new Date().toISOString() };
    setBgLibrary(prev => [...prev, newEntry]);
    return downloadUrl;
  };

  const handleSelectFromLibrary = (url: string) => {
    setCustomBg(url);
  };

  const handleDeleteFromLibrary = async (id: string) => {
    try {
      const bgRef = ref(storage, `users/${user.uid}/library/${id}`);
      await deleteObject(bgRef);
    } catch (e) {
      console.error("Error deleting from storage", e);
    }
    setBgLibrary(prev => prev.filter(item => item.id !== id));
  };

  const handleUpdateClient = useCallback((updatedClient: Client) => {
    setClients(prev => prev.map(c => c.id === updatedClient.id ? updatedClient : c));
  }, []);

  const handleImportClients = (newClients: Client[]) => {
      setClients(prev => {
          const merged = [...prev];
          newClients.forEach(nc => {
              const existingClientIdx = merged.findIndex(c => c.name === nc.name);
              
              if (existingClientIdx > -1) {
                  const ec = merged[existingClientIdx];
                  // Preserve client-level settings
                  const updatedClient = {
                      ...ec,
                      lastUpdated: new Date().toISOString(),
                      accounts: [...ec.accounts]
                  };
                  nc.accounts.forEach(na => {
                      const existingAccIdx = updatedClient.accounts.findIndex(a => a.accountNumber === na.accountNumber);
                      if (existingAccIdx > -1) {
                          const ea = updatedClient.accounts[existingAccIdx];
                          // Merge Positions: Keep targetPct, targetEdited, and roundingMode from existing positions
                          const mergedPositions = na.positions.map(np => {
                              const ep = ea.positions.find(p => p.symbol === np.symbol);
                              return ep ? { ...np, targetPct: ep.targetPct, targetEdited: ep.targetEdited, roundingMode: ep.roundingMode } : np;
                          });
                          updatedClient.accounts[existingAccIdx] = { ...ea, ...na, positions: mergedPositions, lastUpdated: new Date().toISOString() };
                      } else {
                          updatedClient.accounts.push(na);
                      }
                  });
                  merged[existingClientIdx] = updatedClient;
              } else {
                  merged.push(nc);
              }
          });
          return merged;
      });
  };

  if (isAuthLoading || (user && isDataLoading)) return <div className="h-screen bg-zinc-950 flex items-center justify-center text-zinc-500"><Loader2 className="h-8 w-8 animate-spin" /></div>;
  if (!user) return <LoginScreen />;

  const themeMap = {
    dark: {
      zinc: { primary: '#09090b', secondary: '#18181b' },
      slate: { primary: '#0f172a', secondary: '#1e293b' },
      forest: { primary: '#050505', secondary: '#062016' }
    },
    light: {
      zinc: { primary: '#ffffff', secondary: '#f4f4f5' },
      slate: { primary: '#f8fafc', secondary: '#f1f5f9' },
      soft: { primary: '#fafafa', secondary: '#f0ebe3' }
    }
  };
  const accents = {
    blue: '#3b82f6',
    purple: '#a855f7',
    emerald: '#10b981',
    rose: '#f43f5e',
    amber: '#f59e0b'
  };

  const currentTheme = themeMap[themeMode]?.[themeFlavor] || themeMap.dark.zinc;
  const currentAccent = accents[accentColor] || accents.blue;

  return (
    <div 
      className={`h-screen flex overflow-hidden relative transition-colors duration-500 ${themeMode === 'light' ? 'light-theme-text-adj' : ''}`} 
      style={{ 
        '--bg-primary': currentTheme.primary, 
        '--bg-secondary': currentTheme.secondary,
        '--accent': currentAccent,
        '--accent-glow': `${currentAccent}80`,
        backgroundImage: themeMode === 'custom' && customBg ? `url(${customBg})` : 'none', 
        backgroundSize: 'cover', 
        backgroundPosition: 'center',
        backgroundAttachment: 'fixed',
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-main)'
      }}
    >
        {/* Ambient Background Light for Glass Refraction */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
            {customBg && <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-[2px]" />}
            {!customBg && themeMode !== 'light' && (
                <>
                    <div className="absolute -top-[10%] -left-[5%] w-[40%] h-[40%] rounded-full bg-blue-900/20 blur-[120px]" />
                    <div className="absolute bottom-[20%] -right-[5%] w-[30%] h-[30%] rounded-full bg-indigo-900/10 blur-[120px]" />
                </>
            )}
        </div>
        <GlobalStyles />
        <div className={`
            ${isSidebarExpanded ? 'w-64 items-start px-6' : 'w-20 items-center'} 
            relative flex flex-col py-8 shrink-0 transition-all duration-300 z-50
            bg-zinc-950/40 bg-gradient-to-b from-white/[0.08] to-transparent 
            backdrop-blur-2xl backdrop-saturate-150 
            border-r border-white/10 
            shadow-[inset_1px_1px_0_0_rgba(255,255,255,0.1),4px_0_24px_-8px_rgba(0,0,0,0.5)]
        `}>
            <button 
                onClick={() => setIsSidebarExpanded(!isSidebarExpanded)} 
                className={`w-10 h-10 rounded-xl flex items-center justify-center text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors mb-8 ${isSidebarExpanded ? 'self-end' : ''}`}
            >
                {isSidebarExpanded ? <ChevronLeft className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div className={`flex items-center gap-3 mb-8 ${isSidebarExpanded ? 'self-start' : ''}`}>
                <div className={`h-10 w-10 rounded-xl overflow-hidden flex items-center justify-center shadow-lg border transition-colors duration-200 ${
                    themeMode === 'light' ? 'bg-white border-zinc-200' : 'bg-zinc-900 border-zinc-800'
                }`}>
                    <img 
                        src={themeMode === 'light' ? "/ACG Lion Black SVG.svg" : "/ACG Lion Gold SVG.svg"} 
                        alt="Firm Logo" 
                        className="h-full w-full object-contain p-1.5" 
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            const fallback = document.createElement('div');
                            fallback.className = "h-full w-full bg-blue-600 flex items-center justify-center text-white font-black text-xs";
                            fallback.innerText = "IA";
                            if (e.currentTarget.parentNode) {
                                e.currentTarget.parentNode.appendChild(fallback);
                            }
                        }}
                    />
                </div>
                {isSidebarExpanded && (
                    <div className="flex flex-col">
                        <span className="text-[10px] font-black uppercase tracking-widest text-zinc-500">{getGreeting()},</span>
                        <span className="text-sm font-bold text-white truncate max-w-[140px]">{userProfile.fullName || 'Advisor'}</span>
                    </div>
                )}
            </div>
            <div className="flex flex-col gap-4 w-full px-2 flex-1">
                <button onClick={() => { setView('insights'); setRoute({ path: '/', params: {} }); }} className={`h-12 w-full rounded-xl flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center'} transition-all ${view === 'insights' && route.path !== '/client' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    <Lightbulb className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && <span className="ml-4 font-black uppercase tracking-widest text-xs">Insights</span>}
                </button>
                <button onClick={() => { setView('clients'); setRoute({ path: '/', params: {} }); }} className={`h-12 w-full rounded-xl flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center'} transition-all ${view === 'clients' || route.path === '/client' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    <Users className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && <span className="ml-4 font-black uppercase tracking-widest text-xs">Portfolios</span>}
                </button>
                <button onClick={() => { setView('firm'); setRoute({ path: '/', params: {} }); }} className={`h-12 w-full rounded-xl flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center'} transition-all ${view === 'firm' && route.path !== '/client' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    <Globe className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && <span className="ml-4 font-black uppercase tracking-widest text-xs">Firm Overview</span>}
                </button>
                <button onClick={() => { setView('trades'); setRoute({ path: '/', params: {} }); }} className={`h-12 w-full rounded-xl flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center'} transition-all ${view === 'trades' && route.path !== '/client' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    <FileSpreadsheet className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && <span className="ml-4 font-black uppercase tracking-widest text-xs">Trade Export</span>}
                </button>
                <button onClick={() => { setView('models'); setRoute({ path: '/', params: {} }); }} className={`h-12 w-full rounded-xl flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center'} transition-all ${view === 'models' && route.path !== '/client' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                    <Layers className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && <span className="ml-4 font-black uppercase tracking-widest text-xs">Models</span>}
                </button>
            </div>
            <div className="w-full px-2 mt-auto">
                 <button onClick={() => { setView('settings'); setRoute({ path: '/', params: {} }); }} className={`h-12 w-full rounded-xl flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center'} transition-all ${view === 'settings' ? 'bg-zinc-800 text-blue-400' : 'text-zinc-500 hover:text-white hover:bg-zinc-900'}`}>
                     <Settings className="h-5 w-5 shrink-0" />
                     {isSidebarExpanded && <span className="ml-4 font-black uppercase tracking-widest text-xs">Settings</span>}
                 </button>
                 <button onClick={() => { if (!(import.meta as any).env.DEV) signOut(auth); else alert("Cannot sign out of Developer Bypass mode."); }} className={`h-12 w-full rounded-xl flex items-center ${isSidebarExpanded ? 'justify-start px-4' : 'justify-center'} transition-all text-zinc-500 hover:text-red-400 hover:bg-red-500/10 mt-2`}>
                    <LogOut className="h-5 w-5 shrink-0" />
                    {isSidebarExpanded && <span className="ml-4 font-black uppercase tracking-widest text-xs">Sign Out</span>}
                 </button>
            </div>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
            {route.path === '/client' && activeClient ? (
                <ClientDashboard 
                    client={activeClient} 
                    userProfile={userProfile}
                    getGreeting={getGreeting}
                    models={models} 
                    assetOverrides={assetOverrides}
                    setAssetOverrides={setAssetOverrides}
                    onBack={() => setRoute({ path: '/', params: {} })} 
                    onUpdateClient={handleUpdateClient} 
                    onNavigate={(tabId) => {
                        setRoute({ path: '/', params: {} });
                        setView(tabId);
                    }}
                    viewPreferences={viewPreferences}
                    setViewPreferences={setViewPreferences}
                    globalCustomView={globalCustomView}
                    onUpdateGlobalCustomView={setGlobalCustomView}
                    hasUnsavedCustomChanges={hasUnsavedCustomChanges}
                    setHasUnsavedCustomChanges={setHasUnsavedCustomChanges}
                    activeViewType={activeViewType}
                    setActiveViewType={setActiveViewType}
                    defaultViewType={defaultViewType}
                    setDefaultViewType={setDefaultViewType}
                />
            ) : view === 'settings' ? (
                <GlobalSettingsPage 
                    userProfile={userProfile} setUserProfile={setUserProfile}
                    themeMode={themeMode} setThemeMode={setThemeMode}
                    themeFlavor={themeFlavor} setThemeFlavor={setThemeFlavor}
                    accentColor={accentColor} setAccentColor={setAccentColor}
                    customBg={customBg} setCustomBg={setCustomBg} 
                    bgLibrary={bgLibrary}
                    onAddToLibrary={handleAddToLibrary}
                    onSelectFromLibrary={handleSelectFromLibrary}
                    onDeleteFromLibrary={handleDeleteFromLibrary}
                    user={user} 
                    tierSettings={tierSettings}
                    setTierSettings={setTierSettings}
                    onImportClients={handleImportClients}
                    insightThresholds={insightThresholds}
                    setInsightThresholds={setInsightThresholds}
                />
            ) : view === 'clients' ? (
                <ClientList 
                    clients={clients} 
                    onCreateClient={c => setClients([...clients, { ...c, id: generateId(), accounts: [], lastUpdated: new Date().toISOString() }])} 
                    onSelectClient={id => setRoute({ path: '/client', params: { id } })} 
                    onDeleteClient={id => setClients(clients.filter(c => c.id !== id))} 
                    onImportClients={setClients}
                    tierSettings={tierSettings}
                />
            ) : view === 'models' ? (
                <ModelManager models={models} onUpdateModels={setModels} />
            ) : view === 'trades' ? (
                <TradeManager clients={clients} onUpdateClient={handleUpdateClient} fetchFinnhub={fetchFinnhub} />
            ) : view === 'insights' ? (
                <InsightsDashboard 
                    clients={clients} 
                    insightThresholds={insightThresholds} 
                    insightLayout={insightLayout} 
                    setInsightLayout={setInsightLayout} 
                    isInsightResizingUnlocked={isInsightResizingUnlocked}
                    setIsInsightResizingUnlocked={setIsInsightResizingUnlocked}
                    onUpdateClient={handleUpdateClient} 
                    billingInfo={getBillingInfo()} 
                    defaultLayout={DEFAULT_INSIGHT_LAYOUT} 
                />
            ) : (
                <FirmOverview clients={clients} assetOverrides={assetOverrides} setAssetOverrides={setAssetOverrides} onUpdateClient={handleUpdateClient} />
            )}
        </div>
    </div>
  );
}