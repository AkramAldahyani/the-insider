/**
 * Date formatting helpers. Everything is displayed in UTC so output never
 * depends on the timezone of the machine running the engine.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

const p2 = (n: number) => String(n).padStart(2, '0');

function parts(t: number) {
  const d = new Date(t);
  return {
    year: d.getUTCFullYear(),
    mon: MONTHS[d.getUTCMonth()],
    monNum: p2(d.getUTCMonth() + 1),
    day: d.getUTCDate(),
    dow: DAYS[d.getUTCDay()],
    hms: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`,
    hm: `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`,
  };
}

/** "Mar  2 09:12:01" - classic syslog files (auth.log). Day is space-padded. */
export function syslogStamp(t: number): string {
  const x = parts(t);
  return `${x.mon} ${String(x.day).padStart(2, ' ')} ${x.hms}`;
}

/** "Mar 02 09:12:01" - journalctl. Day is zero-padded. */
export function journalStamp(t: number): string {
  const x = parts(t);
  return `${x.mon} ${p2(x.day)} ${x.hms}`;
}

/** "2026-03-02 09:12" - `who`. */
export function isoMinute(t: number): string {
  const x = parts(t);
  return `${x.year}-${x.monNum}-${p2(x.day)} ${x.hm}`;
}

/** "2026-03-02 09:12:01.000000000 +0000" - `stat`. */
export function statStamp(t: number): string {
  const x = parts(t);
  return `${x.year}-${x.monNum}-${p2(x.day)} ${x.hms}.000000000 +0000`;
}

/** "Mon Mar  2 09:12" - `last`. */
export function lastStamp(t: number): string {
  const x = parts(t);
  return `${x.dow} ${x.mon} ${String(x.day).padStart(2, ' ')} ${x.hm}`;
}

/** "Mon Mar  2 09:12:01 2026" - login banners, "wtmp begins". */
export function fullStamp(t: number): string {
  const x = parts(t);
  return `${x.dow} ${x.mon} ${String(x.day).padStart(2, ' ')} ${x.hms} ${x.year}`;
}

/** "Mon Mar  2 09:12:01 UTC 2026" - `date`. */
export function dateStamp(t: number): string {
  const x = parts(t);
  return `${x.dow} ${x.mon} ${String(x.day).padStart(2, ' ')} ${x.hms} UTC ${x.year}`;
}

/** "09:12" */
export function hhmm(t: number): string {
  return parts(t).hm;
}

/** "09:12:01" */
export function hhmmss(t: number): string {
  return parts(t).hms;
}

/** `ls -l` date: "Mar  2 09:12" for recent files, "Mar  2  2025" for old ones. */
export function lsStamp(t: number, now: number): string {
  const x = parts(t);
  const recent = Math.abs(now - t) < 182 * DAY;
  return `${x.mon} ${String(x.day).padStart(2, ' ')} ${recent ? x.hm : ' ' + x.year}`;
}

/** `ps` START column: time of day if started today, otherwise "Mar02". */
export function psStart(t: number, now: number): string {
  const x = parts(t);
  return now - t < DAY ? x.hm : `${x.mon}${p2(x.day)}`;
}

/**
 * Parses "+5m", "90s", "2h", "1d", "1h30m" into milliseconds.
 * Returns null when the text is not a valid duration.
 */
export function parseDuration(text: string): number | null {
  const s = text.trim().replace(/^\+/, '');
  if (!/^(\d+[smhd])+$/.test(s)) return null;
  const unit: Record<string, number> = { s: SECOND, m: MINUTE, h: HOUR, d: DAY };
  let total = 0;
  for (const m of s.matchAll(/(\d+)([smhd])/g)) total += Number(m[1]) * unit[m[2]];
  return total;
}
