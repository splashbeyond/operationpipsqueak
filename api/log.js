/**
 * Tiny structured logger.
 * In production: single-line JSON per event (good for log aggregators).
 * In dev: human-readable with key=value tail.
 */

const PROD = process.env.NODE_ENV === 'production';

function fmtKv(obj) {
  if (!obj) return '';
  const parts = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    let s;
    if (v == null) s = String(v);
    else if (typeof v === 'object') {
      try {
        s = JSON.stringify(v);
      } catch {
        s = '[object]';
      }
    } else {
      s = String(v);
    }
    if (s.includes(' ') || s.includes('"')) s = JSON.stringify(s);
    parts.push(`${k}=${s}`);
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function emit(level, scope, msg, ctx) {
  const ts = new Date().toISOString();
  if (PROD) {
    const line = JSON.stringify({ ts, level, scope, msg, ...(ctx || {}) });
    if (level === 'error') process.stderr.write(line + '\n');
    else process.stdout.write(line + '\n');
    return;
  }
  const head = `[${scope}] ${ts} ${level.toUpperCase()} ${msg}`;
  const tail = fmtKv(ctx);
  if (level === 'error') console.error(head + tail);
  else if (level === 'warn') console.warn(head + tail);
  else console.log(head + tail);
}

function logger(scope) {
  return {
    info: (msg, ctx) => emit('info', scope, msg, ctx),
    warn: (msg, ctx) => emit('warn', scope, msg, ctx),
    error: (msg, ctx) => emit('error', scope, msg, ctx),
    child: (sub) => logger(`${scope}/${sub}`),
  };
}

module.exports = { logger };
