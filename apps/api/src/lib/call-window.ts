type CallWindowSettings = {
  enabled: boolean;
  timezone: string;
  startHour: number;
  endHour: number;
  activeWeekdays: number[]; // 0=Sun ... 6=Sat
  applyToRoundRobinFailover: boolean;
};

type CallWindowEvaluation = {
  allowed: boolean;
  reason: 'outside_hours' | 'inactive_weekday' | 'disabled';
  timezone: string;
  currentHour: number;
  currentWeekday: number;
  settings: CallWindowSettings;
};

const DEFAULT_TIMEZONE = (process.env.BUSINESS_TZ || 'America/Mexico_City').trim();
const DEFAULT_START_HOUR = clampHour(Number(process.env.BUSINESS_START_HOUR ?? 7), 7);
const DEFAULT_END_HOUR = clampHour(Number(process.env.BUSINESS_END_HOUR ?? 22), 22);
const DEFAULT_ACTIVE_WEEKDAYS = parseWeekdaysEnv(process.env.BUSINESS_DAYS) ?? [0, 1, 2, 3, 4, 5, 6];
const DEFAULT_FAILOVER_POLICY = parseBooleanEnv(process.env.BUSINESS_APPLY_TO_RR_FAILOVER, true);
const DEFAULT_ENABLED = parseBooleanEnv(process.env.BUSINESS_HOURS_ENABLED, true);

const defaultSettings: CallWindowSettings = {
  enabled: DEFAULT_ENABLED,
  timezone: DEFAULT_TIMEZONE,
  startHour: DEFAULT_START_HOUR,
  endHour: DEFAULT_END_HOUR,
  activeWeekdays: DEFAULT_ACTIVE_WEEKDAYS,
  applyToRoundRobinFailover: DEFAULT_FAILOVER_POLICY,
};

let runtimeSettings: CallWindowSettings = { ...defaultSettings };

function parseBooleanEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function clampHour(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const n = Math.trunc(value);
  if (n < 0) return 0;
  if (n > 23) return 23;
  return n;
}

function uniqueSortedWeekdays(input: number[]): number[] {
  const normalized = input
    .map((n) => Math.trunc(n))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
  return Array.from(new Set(normalized)).sort((a, b) => a - b);
}

function parseWeekdaysEnv(raw: string | undefined): number[] | null {
  if (!raw || !raw.trim()) return null;
  const parsed = raw
    .split(',')
    .map((token) => Number.parseInt(token.trim(), 10))
    .filter((n) => Number.isFinite(n));
  const normalized = uniqueSortedWeekdays(parsed);
  return normalized.length ? normalized : null;
}

function getDateInTimezone(timezone: string): Date {
  return new Date(new Date().toLocaleString('en-US', { timeZone: timezone }));
}

function validateTimezone(value: string): string {
  const candidate = value.trim();
  if (!candidate) return defaultSettings.timezone;
  try {
    // Will throw for invalid time zones.
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date());
    return candidate;
  } catch {
    return defaultSettings.timezone;
  }
}

function isHourWithinWindow(currentHour: number, startHour: number, endHour: number): boolean {
  if (startHour === endHour) return true; // all-day window
  if (startHour < endHour) return currentHour >= startHour && currentHour < endHour;
  // Overnight window, e.g. 22 -> 6
  return currentHour >= startHour || currentHour < endHour;
}

export function getCallWindowSettings(): CallWindowSettings {
  return {
    ...runtimeSettings,
    activeWeekdays: [...runtimeSettings.activeWeekdays],
  };
}

export function updateCallWindowSettings(
  patch: Partial<CallWindowSettings>
): CallWindowSettings {
  const next: CallWindowSettings = {
    ...runtimeSettings,
    ...patch,
  };

  if (patch.timezone !== undefined) next.timezone = validateTimezone(String(patch.timezone));
  if (patch.startHour !== undefined) next.startHour = clampHour(Number(patch.startHour), runtimeSettings.startHour);
  if (patch.endHour !== undefined) next.endHour = clampHour(Number(patch.endHour), runtimeSettings.endHour);
  if (patch.enabled !== undefined) next.enabled = Boolean(patch.enabled);
  if (patch.applyToRoundRobinFailover !== undefined) {
    next.applyToRoundRobinFailover = Boolean(patch.applyToRoundRobinFailover);
  }
  if (patch.activeWeekdays !== undefined) {
    const normalized = uniqueSortedWeekdays(Array.isArray(patch.activeWeekdays) ? patch.activeWeekdays : []);
    next.activeWeekdays = normalized.length ? normalized : [...defaultSettings.activeWeekdays];
  }

  runtimeSettings = {
    ...next,
    activeWeekdays: [...next.activeWeekdays],
  };
  return getCallWindowSettings();
}

export function resetCallWindowSettings(): CallWindowSettings {
  runtimeSettings = { ...defaultSettings, activeWeekdays: [...defaultSettings.activeWeekdays] };
  return getCallWindowSettings();
}

export function evaluateCallWindow(now: Date = new Date()): CallWindowEvaluation {
  const settings = getCallWindowSettings();
  if (!settings.enabled) {
    return {
      allowed: true,
      reason: 'disabled',
      timezone: settings.timezone,
      currentHour: -1,
      currentWeekday: -1,
      settings,
    };
  }

  const zoned = getDateInTimezone(settings.timezone);
  const currentHour = zoned.getHours();
  const currentWeekday = zoned.getDay();
  const weekdayAllowed = settings.activeWeekdays.includes(currentWeekday);
  const hourAllowed = isHourWithinWindow(currentHour, settings.startHour, settings.endHour);
  const allowed = weekdayAllowed && hourAllowed;

  return {
    allowed,
    reason: !weekdayAllowed ? 'inactive_weekday' : !hourAllowed ? 'outside_hours' : 'disabled',
    timezone: settings.timezone,
    currentHour,
    currentWeekday,
    settings,
  };
}

export function canStartOutboundCall(now: Date = new Date()): CallWindowEvaluation {
  return evaluateCallWindow(now);
}

export function canRunRoundRobinFailover(now: Date = new Date()): CallWindowEvaluation {
  const evaluation = evaluateCallWindow(now);
  if (!evaluation.settings.applyToRoundRobinFailover) {
    return {
      ...evaluation,
      allowed: true,
    };
  }
  return evaluation;
}
