export function getNow(): string {
  return new Date().toISOString();
}

export function getLocalDateString(date: Date = new Date()): string {
  return date.toISOString().split('T')[0]!;
}

export function parseLocalDate(dateString: string): Date {
  return new Date(dateString + 'T00:00:00.000Z');
}

export function getDaysAgo(days: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() - days);
  return d;
}

export function getDaysFromNow(days: number, from: Date = new Date()): Date {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  return d;
}

export function daysBetween(start: Date, end: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.floor((end.getTime() - start.getTime()) / msPerDay);
}

export function isSameDay(a: Date, b: Date): boolean {
  return getLocalDateString(a) === getLocalDateString(b);
}
