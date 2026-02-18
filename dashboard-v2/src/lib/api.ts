/**
 * API client for Revenio Dashboard
 * Connects to the metrics API endpoints
 */

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export interface SummaryData {
  totalCalls: number;
  transferRate: number;
  abandonRate: number;
  avgTimeToTransfer: number;
  inProgressCount: number;
  sentimentCounts: {
    positive: number;
    neutral: number;
    negative: number;
  };
  deltas: {
    totalCalls: number;
    transferRate: number;
    abandonRate: number;
    avgTimeToTransfer: number;
  };
}

export interface DailyData {
  date: string;
  day: string;
  calls: number;
  transfers: number;
  abandoned: number;
}

export interface RecentCall {
  phone: string;
  outcome: string;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  duration: number | null;
  ago: string;
  inProgress: boolean;
}

export interface DashboardData {
  summary: SummaryData;
  daily: DailyData[];
  recent: RecentCall[];
}

export async function fetchSummary(period: string): Promise<SummaryData> {
  const res = await fetch(`${API_BASE}/api/metrics/summary?period=${encodeURIComponent(period)}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchDaily(days = 7): Promise<DailyData[]> {
  const res = await fetch(`${API_BASE}/api/metrics/daily?days=${days}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchRecent(filters: {
  limit?: number;
  sentiment?: string;
  outcome?: string;
  search?: string;
} = {}): Promise<RecentCall[]> {
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.sentiment && filters.sentiment !== 'all') params.set('sentiment', filters.sentiment);
  if (filters.outcome && filters.outcome !== 'all') params.set('outcome', filters.outcome);
  if (filters.search) params.set('search', filters.search);
  
  const res = await fetch(`${API_BASE}/api/metrics/recent?${params}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

export async function fetchAllData(period: string): Promise<DashboardData> {
  const [summary, daily, recent] = await Promise.all([
    fetchSummary(period),
    fetchDaily(7),
    fetchRecent({ limit: 20 }),
  ]);
  
  return { summary, daily, recent };
}
