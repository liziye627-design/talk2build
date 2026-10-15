export function yesterdayIso(now = new Date()) {
  const stamp = new Date(now);
  stamp.setDate(stamp.getDate() - 1);
  stamp.setHours(15, 10, 0, 0);
  return stamp.toISOString();
}

export function isOnYesterday(iso: string, now = new Date()) {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return false;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 1);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return value >= start && value < end;
}
