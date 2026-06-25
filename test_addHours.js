const pad = n => n.toString().padStart(2, '0');
const addHours = (dtStr, hoursOffset) => {
  if (!dtStr) return NaN;
  const s = String(dtStr).trim().replace(' ', 'T');
  // Treat local time string as UTC for pure math
  const epoch = new Date(s.includes('Z') ? s : s + 'Z').getTime();
  if (isNaN(epoch)) return NaN;
  const d = new Date(epoch + (hoursOffset * 60 * 60 * 1000));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
console.log('q_old:', addHours('2026-06-25 15:35:51', -1));
