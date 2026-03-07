const pad = (n, d = 2) => String(n).padStart(d, '0');

export function detectUnit(val) {
  if (val < 1e12) return 'seconds';
  if (val < 1e15) return 'milliseconds';
  return 'nanoseconds';
}

export function toMs(val, unit) {
  if (unit === 'seconds') return val * 1000;
  if (unit === 'milliseconds') return val;
  if (unit === 'nanoseconds') return val / 1e6;
  return val;
}

export function formatDate(date, mode) {
  if (mode === 'utc') {
    return date.toISOString();
  }
  const y = date.getFullYear();
  const mo = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const h = pad(date.getHours());
  const mi = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = pad(date.getMilliseconds(), 3);
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${y}-${mo}-${day}T${h}:${mi}:${s}.${ms}${sign}${oh}:${om}`;
}

function tzOffset(date) {
  const offset = -date.getTimezoneOffset();
  if (offset === 0) return 'Z';
  const sign = offset >= 0 ? '+' : '-';
  const oh = pad(Math.floor(Math.abs(offset) / 60));
  const om = pad(Math.abs(offset) % 60);
  return `${sign}${oh}:${om}`;
}

export function formatAs(date, format, nanos) {
  const ns = nanos || pad(date.getMilliseconds(), 3) + '000000';
  const utc = {
    y: date.getUTCFullYear(),
    mo: pad(date.getUTCMonth() + 1),
    d: pad(date.getUTCDate()),
    h: pad(date.getUTCHours()),
    mi: pad(date.getUTCMinutes()),
    s: pad(date.getUTCSeconds()),
    ms: pad(date.getUTCMilliseconds(), 3),
  };
  const loc = {
    y: date.getFullYear(),
    mo: pad(date.getMonth() + 1),
    d: pad(date.getDate()),
    h: pad(date.getHours()),
    mi: pad(date.getMinutes()),
    s: pad(date.getSeconds()),
    ms: pad(date.getMilliseconds(), 3),
  };
  const tz = tzOffset(date);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];

  switch (format) {
    case 'iso8601':
      return `${utc.y}-${utc.mo}-${utc.d}T${utc.h}:${utc.mi}:${utc.s}.${utc.ms}Z`;
    case 'iso8601-local':
      return `${loc.y}-${loc.mo}-${loc.d}T${loc.h}:${loc.mi}:${loc.s}.${loc.ms}${tz}`;
    case 'rfc3339':
      return `${utc.y}-${utc.mo}-${utc.d}T${utc.h}:${utc.mi}:${utc.s}Z`;
    case 'rfc3339-local':
      return `${loc.y}-${loc.mo}-${loc.d}T${loc.h}:${loc.mi}:${loc.s}${tz}`;
    case 'rfc3339-ms':
      return `${utc.y}-${utc.mo}-${utc.d}T${utc.h}:${utc.mi}:${utc.s}.${utc.ms}Z`;
    case 'rfc3339-nano':
      return `${utc.y}-${utc.mo}-${utc.d}T${utc.h}:${utc.mi}:${utc.s}.${ns}Z`;
    case 'rfc3339-nano-local':
      return `${loc.y}-${loc.mo}-${loc.d}T${loc.h}:${loc.mi}:${loc.s}.${ns}${tz}`;
    case 'rfc2822':
      return `${days[date.getUTCDay()]}, ${utc.d} ${months[date.getUTCMonth()]} ${utc.y} ${utc.h}:${utc.mi}:${utc.s} +0000`;
    case 'rfc2822-local': {
      const off = -date.getTimezoneOffset();
      const sign = off >= 0 ? '+' : '-';
      const offStr = `${sign}${pad(Math.floor(Math.abs(off) / 60))}${pad(Math.abs(off) % 60)}`;
      return `${days[date.getDay()]}, ${loc.d} ${months[date.getMonth()]} ${loc.y} ${loc.h}:${loc.mi}:${loc.s} ${offStr}`;
    }
    case 'date-only':
      return `${utc.y}-${utc.mo}-${utc.d}`;
    case 'time-only':
      return `${utc.h}:${utc.mi}:${utc.s}Z`;
    case 'sql':
      return `${utc.y}-${utc.mo}-${utc.d} ${utc.h}:${utc.mi}:${utc.s}`;
    case 'sql-ms':
      return `${utc.y}-${utc.mo}-${utc.d} ${utc.h}:${utc.mi}:${utc.s}.${utc.ms}`;
    default:
      return date.toISOString();
  }
}

export const FORMAT_LIST = [
  { id: 'iso8601', label: 'ISO 8601 (UTC)' },
  { id: 'iso8601-local', label: 'ISO 8601 (Local)' },
  { id: 'rfc3339', label: 'RFC 3339 (UTC)' },
  { id: 'rfc3339-local', label: 'RFC 3339 (Local)' },
  { id: 'rfc3339-ms', label: 'RFC 3339 ms (UTC)' },
  { id: 'rfc3339-nano', label: 'RFC 3339 Nano (UTC)' },
  { id: 'rfc3339-nano-local', label: 'RFC 3339 Nano (Local)' },
  { id: 'rfc2822', label: 'RFC 2822 (UTC)' },
  { id: 'rfc2822-local', label: 'RFC 2822 (Local)' },
  { id: 'sql', label: 'SQL Datetime' },
  { id: 'sql-ms', label: 'SQL Datetime (ms)' },
  { id: 'date-only', label: 'Date (YYYY-MM-DD)' },
  { id: 'time-only', label: 'Time (HH:MM:SS)' },
];

export function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < 1000) return 'just now';

  const parts = [];
  let rem = Math.floor(abs / 1000);
  const days = Math.floor(rem / 86400);
  rem %= 86400;
  const hours = Math.floor(rem / 3600);
  rem %= 3600;
  const minutes = Math.floor(rem / 60);
  const seconds = rem % 60;

  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0) parts.push(`${seconds}s`);

  return `${parts.join(' ')} ${suffix}`;
}
