/**
 * Structured JSON logs. Never log secrets or token values.
 * @param {'info'|'warn'|'error'} level
 * @param {Record<string, unknown>} fields
 */
export function logStructured(level, fields) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...fields,
  });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}
