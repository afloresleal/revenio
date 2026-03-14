import React, { useState, useEffect, useMemo } from 'react';
import { 
  LineChart,
  Line,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  ResponsiveContainer
} from 'recharts';
import { 
  Phone, 
  ArrowUpRight, 
  ArrowDownRight, 
  Activity, 
  Clock, 
  XCircle, 
  CheckCircle2, 
  RefreshCw,
  MoreHorizontal,
  PhoneForwarded,
  Calendar,
  Search,
  Mic,
  Smile,
  Meh,
  Frown,
  Filter,
  X,
  AlertOctagon,
  AlertTriangle,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { fetchAllData, fetchRecent, fetchCallDetail, syncCallDetail } from './src/lib/api';

// --- Types ---
const CDMX_TIMEZONE = 'America/Mexico_City';

type SentimentType = 'positive' | 'neutral' | 'negative';
type OutcomeType = 'transfer_success' | 'abandoned' | 'in_progress' | 'completed' | 'failed';

interface CallDelta {
  totalCalls: number;
  transferRate: number;
  transferConnectedRate: number;
  abandonRate: number;
  avgTimeToTransfer: number;
}

interface SentimentCounts {
  positive: number;
  neutral: number;
  negative: number;
}

interface SummaryData {
  totalCalls: number;
  transferRate: number;
  transferConnectedRate: number;
  transfersInitiated: number;
  transfersConnected: number;
  transferConnectionSuccessRate: number;
  abandonRate: number;
  avgTimeToTransfer: number;
  inProgressCount: number;
  deltas: CallDelta;
  sentimentCounts: SentimentCounts;
}

interface DailyData {
  date: string;
  day: string;
  calls: number;
  transfers: number;
  abandoned: number;
}

interface RecentCall {
  callId: string;
  phone: string;
  assistantId?: string | null;
  transferNumber?: string | null;
  outcome: OutcomeType;
  sentiment: SentimentType | null;
  duration: number | null;
  durationSource?: 'duration_sec' | 'timestamp_fallback' | 'missing';
  startedAt?: string | null;
  transferredAt?: string | null;
  endedAt?: string | null;
  timeToTransferSec?: number | null;
  sellerTalkSec?: number | null;
  sellerTalkSource?: 'post_transfer_duration_sec' | 'timestamp_fallback' | 'missing';
  postTransferDurationSec?: number | null;
  ago: string;
  inProgress?: boolean;
}

interface DashboardData {
  summary: SummaryData;
  daily: DailyData[];
  recent: RecentCall[];
}

// --- Helper Components ---

const StatusBadge: React.FC<{ outcome: OutcomeType }> = ({ outcome }) => {
  switch (outcome) {
    case 'transfer_success':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <CheckCircle2 size={12} />
          Transferido
        </span>
      );
    case 'abandoned':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
          <XCircle size={12} />
          Abandonada
        </span>
      );
    case 'in_progress':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20 animate-pulse">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
          </span>
          En curso
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-600/10 text-red-500 border border-red-500/20">
          <AlertOctagon size={12} />
          Fallo
        </span>
      );
    case 'completed':
    default:
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-700/50 text-slate-400 border border-slate-700">
          <CheckCircle2 size={12} />
          Completada
        </span>
      );
  }
};

const SentimentBadge: React.FC<{ sentiment: SentimentType | null }> = ({ sentiment }) => {
  if (!sentiment) {
    return <span className="text-slate-600 text-xs px-2 select-none">--</span>;
  }

  const config = {
    positive: { icon: Smile, color: 'text-emerald-400', bg: 'bg-emerald-900/30', border: 'border-emerald-500/20', label: 'Positivo' },
    neutral: { icon: Meh, color: 'text-slate-400', bg: 'bg-slate-700/50', border: 'border-slate-600/30', label: 'Neutral' },
    negative: { icon: Frown, color: 'text-rose-400', bg: 'bg-rose-900/30', border: 'border-rose-500/20', label: 'Negativo' },
  };

  const style = config[sentiment];
  const Icon = style.icon;

  return (
    <span 
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ${style.bg} ${style.color} border ${style.border}`}
      aria-label={`Sentiment: ${style.label}`}
    >
      <Icon size={12} aria-hidden="true" />
      {style.label}
    </span>
  );
};

const SkeletonCard = () => (
  <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm animate-pulse h-40">
    <div className="h-8 w-8 bg-slate-800 rounded-full mb-4"></div>
    <div className="h-4 w-24 bg-slate-800 rounded mb-2"></div>
    <div className="h-10 w-16 bg-slate-800 rounded mb-2"></div>
    <div className="h-4 w-32 bg-slate-800 rounded"></div>
  </div>
);

// --- Main Application ---

export default function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState("Hoy");
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());

  // Filters State
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeType | 'all'>('all');
  const [sentimentFilter, setSentimentFilter] = useState<SentimentType | 'all'>('all');
  const [showFullHistory, setShowFullHistory] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedCallId, setExpandedCallId] = useState<string | null>(null);
  const [jsonModalOpen, setJsonModalOpen] = useState(false);
  const [jsonModalCallId, setJsonModalCallId] = useState<string | null>(null);
  const [jsonModalData, setJsonModalData] = useState<Record<string, unknown> | null>(null);
  const [jsonModalLoading, setJsonModalLoading] = useState(false);
  const [jsonModalError, setJsonModalError] = useState<string | null>(null);
  const [callDetails, setCallDetails] = useState<Record<string, Record<string, unknown>>>({});
  const [callDetailLoading, setCallDetailLoading] = useState<Record<string, boolean>>({});
  const [callDetailErrors, setCallDetailErrors] = useState<Record<string, string>>({});
  const [callDetailSyncing, setCallDetailSyncing] = useState<Record<string, boolean>>({});

  // Debounce effect for search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // State for errors
  const [error, setError] = useState<Error | null>(null);

  const formatTimeCDMX = (value: Date) =>
    value.toLocaleTimeString('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZone: CDMX_TIMEZONE,
      hour12: true,
    });

  // Data fetching - real API only
  const fetchData = async () => {
    setLoading(true);
    setError(null);

    // Real API call
    try {
      const dashboardData = await fetchAllData(period);
      setData(dashboardData as DashboardData);
      setLastUpdated(new Date());
    } catch (err) {
      console.error('Failed to fetch data:', err);
      setError(err instanceof Error ? err : new Error('Failed to fetch data'));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // Fetch filtered recent calls when filters change
  useEffect(() => {
    if (!data) return;
    
    const fetchFiltered = async () => {
      try {
        const recent = await fetchRecent({
          limit: showFullHistory ? 100 : 20,
          sentiment: sentimentFilter !== 'all' ? sentimentFilter : undefined,
          outcome: outcomeFilter !== 'all' ? outcomeFilter : undefined,
          search: debouncedSearch || undefined,
          from: dateFrom || undefined,
          to: dateTo || undefined,
        });
        setData(prev => prev ? { ...prev, recent: recent as DashboardData['recent'] } : null);
      } catch (err) {
        console.error('Failed to fetch filtered data:', err);
      }
    };
    
    fetchFiltered();
  }, [debouncedSearch, outcomeFilter, sentimentFilter, showFullHistory, dateFrom, dateTo]);

  useEffect(() => {
    fetchData();
  }, [period]);

  const handleRefresh = () => {
    fetchData();
  };

  const handleClearFilters = () => {
    setSearch("");
    setOutcomeFilter('all');
    setSentimentFilter('all');
    setDateFrom('');
    setDateTo('');
  };

  // Filter Logic
  const filteredCalls = useMemo(() => {
    if (!data) return [];
    
    const filtered = data.recent.filter(call => {
      // Search Filter
      if (debouncedSearch && !call.phone.includes(debouncedSearch)) {
        return false;
      }
      // Outcome Filter
      if (outcomeFilter !== 'all' && call.outcome !== outcomeFilter) {
        return false;
      }
      // Sentiment Filter
      if (sentimentFilter !== 'all' && call.sentiment !== sentimentFilter) {
        return false;
      }
      return true;
    });

    // Default order: newest call first
    return filtered.sort((a, b) => {
      const aTs = new Date(a.startedAt ?? a.endedAt ?? 0).getTime();
      const bTs = new Date(b.startedAt ?? b.endedAt ?? 0).getTime();
      return bTs - aTs;
    });
  }, [data, debouncedSearch, outcomeFilter, sentimentFilter]);

  const getDeltaColor = (value: number, inverse = false) => {
    if (value === 0) return 'text-slate-500';
    const isPositiveGood = !inverse;
    if (value > 0) return isPositiveGood ? 'text-emerald-400' : 'text-rose-400';
    return isPositiveGood ? 'text-rose-400' : 'text-emerald-400';
  };

  const formatDelta = (value: number) => {
    const abs = Math.abs(value * 100).toFixed(0);
    return `${value > 0 ? '+' : ''}${abs}%`;
  };

  const formatSeconds = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '--';
    if (value < 60) return `${value}s`;
    const mins = Math.floor(value / 60);
    const secs = value % 60;
    return `${mins}m ${secs}s`;
  };

  const formatDateTime = (value?: string | null) => {
    if (!value) return '--';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString('es-MX', {
      timeZone: CDMX_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
    });
  };

  const formatSource = (value?: string) => {
    switch (value) {
      case 'duration_sec':
        return 'durationSec (Vapi)';
      case 'post_transfer_duration_sec':
        return 'postTransferDurationSec (Twilio)';
      case 'timestamp_fallback':
        return 'fallback timestamps';
      default:
        return 'sin fuente';
    }
  };

  const loadCallDetail = async (callId: string, force = false) => {
    if (!force && callDetails[callId]) return callDetails[callId];
    setCallDetailLoading(prev => ({ ...prev, [callId]: true }));
    setCallDetailErrors(prev => ({ ...prev, [callId]: '' }));
    try {
      const detail = await fetchCallDetail(callId);
      const normalized = detail as Record<string, unknown>;
      setCallDetails(prev => ({ ...prev, [callId]: normalized }));
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error fetching call detail';
      setCallDetailErrors(prev => ({ ...prev, [callId]: message }));
      throw error;
    } finally {
      setCallDetailLoading(prev => ({ ...prev, [callId]: false }));
    }
  };

  const openJsonModal = async (callId: string) => {
    setJsonModalOpen(true);
    setJsonModalCallId(callId);
    setJsonModalLoading(true);
    setJsonModalError(null);
    setJsonModalData(callDetails[callId] || null);
    try {
      const detail = await loadCallDetail(callId, true);
      setJsonModalData(detail as Record<string, unknown>);
    } catch (error) {
      setJsonModalError(error instanceof Error ? error.message : 'Error fetching call detail');
    } finally {
      setJsonModalLoading(false);
    }
  };

  const handleSyncCallDetail = async (callId: string) => {
    setCallDetailSyncing(prev => ({ ...prev, [callId]: true }));
    try {
      await syncCallDetail(callId);
      await loadCallDetail(callId, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Error syncing call detail';
      setCallDetailErrors(prev => ({ ...prev, [callId]: message }));
    } finally {
      setCallDetailSyncing(prev => ({ ...prev, [callId]: false }));
    }
  };

  if (!data && loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">
        <div className="flex flex-col items-center gap-4">
          <Activity className="animate-spin text-blue-500" size={32} />
          <p className="text-sm font-mono tracking-wide">INITIALIZING SYSTEM...</p>
        </div>
      </div>
    );
  }

  if (!data && error) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center px-4">
        <div className="w-full max-w-2xl rounded-xl border border-rose-500/30 bg-rose-950/20 p-6 text-rose-200">
          <div className="flex items-center gap-2 text-lg font-semibold">
            <AlertTriangle size={20} />
            No se pudieron cargar datos reales
          </div>
          <p className="mt-3 text-sm text-rose-200/90">
            {error.message}
          </p>
          <p className="mt-2 text-xs text-rose-200/70 font-mono">
            Verifica `VITE_API_URL` en Railway y que el endpoint `/api/metrics/summary` responda 200.
          </p>
          <button
            onClick={handleRefresh}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-rose-400/30 px-3 py-2 text-sm text-rose-100 hover:bg-rose-900/30"
          >
            <RefreshCw size={15} />
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  // --- Render Functions ---

  const renderMetricCard = (
    title: string,
    value: string | number,
    subtext: string,
    delta: number,
    icon: React.ReactNode,
    accentColor: string,
    inverseDelta = false
  ) => {
    if (loading) return <SkeletonCard />;

    const deltaColor = getDeltaColor(delta, inverseDelta);
    const DeltaIcon = delta >= 0 ? ArrowUpRight : ArrowDownRight;

    return (
      <div className="group relative bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-lg hover:border-slate-700 hover:scale-[1.01] transition-all duration-300 overflow-hidden">
        {/* Top Accent Gradient */}
        <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-${accentColor}-500 to-transparent opacity-50 group-hover:opacity-100 transition-opacity`}></div>
        
        <div className="flex justify-between items-start mb-4">
          <div className={`p-2.5 rounded-full bg-${accentColor}-500/10 text-${accentColor}-500 border border-${accentColor}-500/20`}>
            {icon}
          </div>
          <div className={`flex items-center gap-1 text-xs font-mono font-medium ${deltaColor} bg-slate-950/50 px-2 py-1 rounded`}>
            {formatDelta(delta)}
            <DeltaIcon size={14} />
          </div>
        </div>

        <h3 className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-1">{title}</h3>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl lg:text-4xl font-mono font-medium text-slate-100">{value}</span>
        </div>
        <p className="text-slate-500 text-xs mt-2">{subtext}</p>
      </div>
    );
  };

  const renderSentimentDistribution = () => {
    if (loading || !data) return <div className="h-12 bg-slate-900 rounded-lg animate-pulse" />;

    const { positive, neutral, negative } = data.summary.sentimentCounts;
    const total = positive + neutral + negative || 1;
    
    const posPct = (positive / total) * 100;
    const neuPct = (neutral / total) * 100;
    const negPct = (negative / total) * 100;

    return (
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-300 shrink-0">
          <span>Sentiment hoy:</span>
        </div>
        
        <div className="flex gap-3 shrink-0">
          <span className="flex items-center gap-1.5 text-xs text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded-full border border-emerald-900/50">
            <Smile size={12} /> {positive}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-slate-400 bg-slate-800 px-2 py-0.5 rounded-full border border-slate-700">
            <Meh size={12} /> {neutral}
          </span>
          <span className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-950/30 px-2 py-0.5 rounded-full border border-rose-900/50">
            <Frown size={12} /> {negative}
          </span>
        </div>

        {/* Stacked Bar */}
        <div className="flex h-2 w-full rounded-full overflow-hidden bg-slate-800">
          <div style={{ width: `${posPct}%` }} className="bg-emerald-500/80" />
          <div style={{ width: `${neuPct}%` }} className="bg-slate-500/50" />
          <div style={{ width: `${negPct}%` }} className="bg-rose-500/80" />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 pb-12 selection:bg-blue-500/30">
      
      {/* --- Header --- */}
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between h-auto sm:h-20 py-4 sm:py-0 gap-4">
            
            {/* Logo & Title */}
            <div className="flex items-center gap-3">
              <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-blue-800 shadow-lg shadow-blue-900/20">
                <Mic className="text-white" size={20} />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight text-white font-sans">
                  Revenio <span className="text-slate-500 font-normal">Voice Metrics</span>
                </h1>
                <p className="text-xs text-slate-500 font-mono">SYSTEM OPERATIONAL</p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-3 w-full sm:w-auto">
              {/* Live Badge - Hidden until in_progress cleanup is done
              {(data?.summary.inProgressCount || 0) > 0 && (
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-mono animate-pulse-fast">
                  <span className="relative flex h-2 w-2">
                     <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                     <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                  </span>
                  {data?.summary.inProgressCount} EN CURSO
                </div>
              )}
              */}

              <div className="h-8 w-[1px] bg-slate-800 mx-1 hidden sm:block"></div>

              {/* Period Selector */}
              <div className="relative group">
                <select 
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  disabled={loading}
                  className="appearance-none bg-slate-900 text-sm text-slate-300 font-medium pl-9 pr-8 py-2 rounded-lg border border-slate-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-none transition-all hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                >
                  <option>Hoy</option>
                  <option>Ayer</option>
                  <option>7 días</option>
                  <option>30 días</option>
                </select>
                <Calendar className="absolute left-3 top-2.5 text-slate-500 pointer-events-none" size={14} />
                <div className="absolute right-3 top-3 pointer-events-none">
                  <div className="w-0 h-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[4px] border-t-slate-500"></div>
                </div>
              </div>

              {/* Refresh */}
              <button 
                onClick={handleRefresh}
                disabled={loading}
                aria-label="Actualizar datos"
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <RefreshCw size={18} className={`transition-transform duration-700 ${loading ? 'animate-spin' : 'group-hover:rotate-180'}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* --- Timestamp --- */}
        <div className="flex justify-end items-center -mt-4 mb-2">
            <span className="text-xs font-mono text-slate-500">
                Última actualización (CDMX): {formatTimeCDMX(lastUpdated)}
            </span>
        </div>

        {/* --- Metrics Grid --- */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {renderMetricCard(
            "Llamadas Totales",
            data?.summary.totalCalls || 0,
            "vs periodo anterior",
            data?.summary.deltas.totalCalls || 0,
            <Phone size={20} />,
            "blue"
          )}
          {renderMetricCard(
            "Tasa de Transfer (Conectada)",
            `${((data?.summary.transferConnectedRate || 0) * 100).toFixed(0)}%`,
            `${data?.summary.transfersConnected || 0} de ${data?.summary.transfersInitiated || 0} transferidas`,
            data?.summary.deltas.transferConnectedRate || 0,
            <PhoneForwarded size={20} />,
            "emerald"
          )}
          {renderMetricCard(
            "Tasa de Abandono",
            `${((data?.summary.abandonRate || 0) * 100).toFixed(0)}%`,
            `(${Math.round((data?.summary.totalCalls || 47) * (data?.summary.abandonRate || 0.12))} de ${data?.summary.totalCalls})`,
            data?.summary.deltas.abandonRate || 0,
            <XCircle size={20} />,
            "rose",
            true // inverse logic: positive delta is bad
          )}
          {renderMetricCard(
            "Tiempo a Transfer",
            `${data?.summary.avgTimeToTransfer}s`,
            "promedio global",
            data?.summary.deltas.avgTimeToTransfer || 0,
            <Clock size={20} />,
            "amber",
            true // inverse logic: positive delta (more time) is bad
          )}
        </section>

        {/* --- Sentiment Distribution Bar --- Hidden for now
        {renderSentimentDistribution()}
        */}

        {/* --- Calls Detail (Priority Section) --- */}
        <div className={`bg-slate-900 border border-slate-800 rounded-xl shadow-sm flex flex-col overflow-hidden ${showFullHistory ? 'h-auto max-h-[80vh]' : 'h-[560px]'}`}>
            <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-slate-100 font-sans">Detalle de llamadas</h3>
                      {(data?.summary.inProgressCount || 0) > 0 && (
                          <span className="flex h-2 w-2 relative">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                          </span>
                      )}
                  </div>
                  <button className="text-slate-500 hover:text-white transition-colors">
                      <MoreHorizontal size={18} />
                  </button>
                </div>
                
                {/* --- Filters Bar --- */}
                <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
                  <div className="relative col-span-1 md:col-span-2">
                    <div className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none">
                      {search !== debouncedSearch ? (
                        <div className="w-3.5 h-3.5 border-2 border-slate-500 border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        <Search className="h-3.5 w-3.5 text-slate-500" />
                      )}
                    </div>
                    <input
                      type="text"
                      className="block w-full pl-8 pr-3 py-1.5 bg-slate-800 border border-slate-700 rounded-lg text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500/50 focus:border-blue-500 transition-colors"
                      placeholder="Buscar teléfono..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      aria-label="Buscar teléfono"
                    />
                  </div>

                  <select
                    className="col-span-1 bg-slate-800 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                    value={outcomeFilter}
                    onChange={(e) => setOutcomeFilter(e.target.value as OutcomeType | 'all')}
                    aria-label="Filtrar por estado"
                  >
                    <option value="all">Estado: Todos</option>
                    <option value="transfer_success">Transferido</option>
                    <option value="abandoned">Abandonado</option>
                    <option value="in_progress">En curso</option>
                    <option value="completed">Completado</option>
                    <option value="failed">Fallo</option>
                  </select>

                  <select
                    className="col-span-1 bg-slate-800 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                    value={sentimentFilter}
                    onChange={(e) => setSentimentFilter(e.target.value as SentimentType | 'all')}
                    aria-label="Filtrar por sentiment"
                  >
                    <option value="all">Sent: Todos</option>
                    <option value="positive">😊 Positivo</option>
                    <option value="neutral">😐 Neutral</option>
                    <option value="negative">😟 Negativo</option>
                  </select>

                  <input
                    type="date"
                    className="col-span-1 bg-slate-800 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    aria-label="Fecha desde"
                  />

                  <input
                    type="date"
                    className="col-span-1 bg-slate-800 border border-slate-700 rounded-lg py-1.5 px-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500 cursor-pointer"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    aria-label="Fecha hasta"
                  />
                </div>
            </div>

            <div className="overflow-y-auto flex-1 p-3 space-y-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
              {loading ? (
                <div className="space-y-3 p-2">
                    <div className="flex justify-center py-4">
                      <span className="text-xs text-slate-500 animate-pulse">Cargando llamadas...</span>
                    </div>
                    {[...Array(6)].map((_, i) => (
                        <div key={i} className="h-20 bg-slate-800/50 rounded-lg animate-pulse"></div>
                    ))}
                </div>
              ) : filteredCalls.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center p-8 text-center text-slate-500">
                  <Filter className="h-8 w-8 mb-3 opacity-50" />
                  <p className="text-sm font-medium">Sin resultados</p>
                  <p className="text-xs mt-1 mb-3 opacity-70">No hay llamadas con estos filtros</p>
                  <button 
                    onClick={handleClearFilters}
                    className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors"
                  >
                    <X size={12} /> Limpiar filtros
                  </button>
                </div>
              ) : (
                filteredCalls.map((call) => {
                  const isOpen = expandedCallId === call.callId;
                  const detail = callDetails[call.callId];
                  const detailLoading = !!callDetailLoading[call.callId];
                  const detailError = callDetailErrors[call.callId];
                  const transcript = typeof detail?.transcript === 'string' ? detail.transcript : '';
                  const recordingUrl = typeof detail?.recordingUrl === 'string' ? detail.recordingUrl : '';
                  const shouldShowSyncButton = !call.transferNumber || !recordingUrl;
                  return (
                    <div key={call.callId} className="border border-slate-800 rounded-lg bg-slate-900/70 overflow-hidden">
                      <button
                        className="w-full px-3 py-3 hover:bg-slate-800/50 transition-colors"
                        onClick={() => {
                          const nextOpen = isOpen ? null : call.callId;
                          setExpandedCallId(nextOpen);
                          if (nextOpen) {
                            loadCallDetail(nextOpen).catch(() => undefined);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-left">
                            <div className="font-mono text-sm text-slate-200">{call.phone}</div>
                            <div className="text-[11px] text-slate-500">{call.ago}</div>
                          </div>
                          <div className="hidden md:flex items-center gap-3">
                            <StatusBadge outcome={call.outcome} />
                            <SentimentBadge sentiment={call.sentiment} />
                            <span className="font-mono text-xs text-slate-400 min-w-[70px] text-right">
                              Dur: {formatSeconds(call.duration)}
                            </span>
                          </div>
                          <div className="md:hidden flex items-center gap-2">
                            <span className="font-mono text-xs text-slate-400">{formatSeconds(call.duration)}</span>
                          </div>
                          {isOpen ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                        </div>
                      </button>
                      {isOpen && (
                        <div className="border-t border-slate-800 bg-slate-950/50 px-3 py-3">
                          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Call ID</div>
                              <div className="font-mono text-slate-300 break-all">{call.callId || '--'}</div>
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Agente virtual</div>
                              <div className="font-mono text-slate-300 break-all">{call.assistantId || '--'}</div>
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Vendedor (transfer)</div>
                              <div className="font-mono text-slate-300">{call.transferNumber || '--'}</div>
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Duración total</div>
                              <div className="font-mono text-slate-300">{formatSeconds(call.duration)}</div>
                              <div className="text-[11px] text-slate-500 mt-1">Fuente: {formatSource(call.durationSource)}</div>
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Tiempo a transfer</div>
                              <div className="font-mono text-slate-300">{formatSeconds(call.timeToTransferSec)}</div>
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Tiempo con vendedor</div>
                              <div className="font-mono text-slate-300">{formatSeconds(call.sellerTalkSec)}</div>
                              <div className="text-[11px] text-slate-500 mt-1">Fuente: {formatSource(call.sellerTalkSource)}</div>
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Inicio</div>
                              <div className="font-mono text-slate-300">{formatDateTime(call.startedAt)}</div>
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-2">
                              <div className="text-slate-500">Fin</div>
                              <div className="font-mono text-slate-300">{formatDateTime(call.endedAt)}</div>
                            </div>
                          </div>
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => openJsonModal(call.callId)}
                              className="text-xs px-2 py-1 rounded border border-blue-700/60 text-blue-300 hover:bg-blue-900/20"
                            >
                              Ver JSON completo
                            </button>
                          </div>
                          {shouldShowSyncButton && (
                            <div className="mt-2">
                              <button
                                onClick={() => handleSyncCallDetail(call.callId)}
                                disabled={!!callDetailSyncing[call.callId]}
                                className="text-xs px-2 py-1 rounded border border-amber-700/60 text-amber-300 hover:bg-amber-900/20 disabled:opacity-60 disabled:cursor-not-allowed"
                              >
                                {callDetailSyncing[call.callId] ? 'Sincronizando...' : 'Reintentar sync transcript/audio'}
                              </button>
                            </div>
                          )}
                          <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-3">
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-3">
                              <div className="text-slate-500 text-xs mb-2">Transcript</div>
                              {detailLoading ? (
                                <div className="text-xs text-slate-400">Cargando transcript...</div>
                              ) : detailError ? (
                                <div className="text-xs text-rose-300">{detailError}</div>
                              ) : transcript ? (
                                <p className="text-xs text-slate-300 whitespace-pre-wrap max-h-44 overflow-y-auto scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
                                  {transcript}
                                </p>
                              ) : (
                                <div className="text-xs text-slate-500">Sin transcript disponible.</div>
                              )}
                            </div>
                            <div className="rounded-md border border-slate-800 bg-slate-900/80 p-3">
                              <div className="text-slate-500 text-xs mb-2">Audio</div>
                              {detailLoading ? (
                                <div className="text-xs text-slate-400">Cargando audio...</div>
                              ) : recordingUrl ? (
                                <audio controls preload="none" className="w-full">
                                  <source src={recordingUrl} />
                                  Tu navegador no soporta audio.
                                </audio>
                              ) : (
                                <div className="text-xs text-slate-500">Sin audio disponible.</div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {/* Table Footer */}
            <div className="p-3 border-t border-slate-800 bg-slate-900 text-center shrink-0">
                <button 
                  onClick={() => setShowFullHistory(!showFullHistory)}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                >
                    {showFullHistory ? 'Ver menos' : 'Ver historial completo'}
                </button>
            </div>
          </div>

        {/* --- Volume Chart (Secondary Row) --- */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h3 className="text-base font-semibold text-slate-100 font-sans">Volumen últimos 7 días</h3>
              <p className="text-xs text-slate-500 mt-1">Comparativa de tráfico y resolución</p>
            </div>
          </div>

          <div className="h-[300px] w-full">
            {loading ? (
              <div className="h-full w-full flex items-end gap-2 animate-pulse px-4 pb-8">
                  {[...Array(7)].map((_, i) => (
                      <div key={i} className="flex-1 bg-slate-800 rounded-t-sm" style={{height: `${Math.random() * 60 + 20}%`}}></div>
                  ))}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data?.daily} margin={{ top: 20, right: 20, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" opacity={0.4} />
                  <XAxis
                      dataKey="day"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#94a3b8', fontSize: 12, fontFamily: 'Outfit' }}
                      dy={10}
                  />
                  <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: '#64748b', fontSize: 12, fontFamily: 'JetBrains Mono' }}
                  />
                  <Tooltip
                      cursor={{ stroke: '#334155', strokeWidth: 1 }}
                      contentStyle={{
                          backgroundColor: '#1e293b',
                          borderColor: '#334155',
                          borderRadius: '8px',
                          boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                          color: '#f1f5f9',
                          fontFamily: 'JetBrains Mono'
                      }}
                      itemStyle={{ fontSize: '12px' }}
                      labelStyle={{ color: '#94a3b8', fontSize: '12px', marginBottom: '8px', fontFamily: 'Outfit' }}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    iconType="circle"
                    wrapperStyle={{ paddingBottom: '20px', fontSize: '12px', fontFamily: 'Outfit', color: '#94a3b8' }}
                  />
                  <Line type="monotone" dataKey="calls" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4, fill: '#3b82f6', strokeWidth: 0 }} activeDot={{ r: 6 }} name="Total" />
                  <Line type="monotone" dataKey="transfers" stroke="#22c55e" strokeWidth={2} dot={{ r: 4, fill: '#22c55e', strokeWidth: 0 }} activeDot={{ r: 6 }} name="Transfer" />
                  <Line type="monotone" dataKey="abandoned" stroke="#ef4444" strokeWidth={2} dot={{ r: 4, fill: '#ef4444', strokeWidth: 0 }} activeDot={{ r: 6 }} name="Abandono" />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {jsonModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-4xl max-h-[85vh] overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
                <div>
                  <h4 className="text-sm font-semibold text-slate-100">JSON de llamada</h4>
                  <p className="text-xs text-slate-500 font-mono">{jsonModalCallId || '--'}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setJsonModalOpen(false)}
                    className="text-xs px-2 py-1 rounded border border-slate-700 text-slate-300 hover:bg-slate-800"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
              <div className="p-4 overflow-auto max-h-[70vh]">
                {jsonModalLoading ? (
                  <div className="text-xs text-slate-400 font-mono">Cargando...</div>
                ) : jsonModalError ? (
                  <div className="text-xs text-rose-300 font-mono">{jsonModalError}</div>
                ) : (
                  <pre className="text-xs leading-5 text-slate-200 font-mono whitespace-pre-wrap break-words">
                    {JSON.stringify(jsonModalData, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
