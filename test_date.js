const tz = '-04:00';
const dt_old = '2026-06-25 15:27:59';
const s = dt_old.replace(' ', 'T');
const startEpoch = new Date(s + tz).getTime();
const sign = tz[0] === '+' ? 1 : -1;
const hours = parseInt(tz.substring(1, 3), 10);
const mins = parseInt(tz.substring(4, 6), 10);
const offsetMs = sign * ((hours * 60) + mins) * 60 * 1000;
console.log('offsetMs:', offsetMs, isNaN(offsetMs));
const pad = n => n.toString().padStart(2, '0');
const fmt = epoch => {
  const d = new Date(epoch + offsetMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
};
console.log('fmt(startEpoch):', fmt(startEpoch));
