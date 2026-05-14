// Parse `--input key=value` pairs into a structured object suitable for the API.
// - bare strings stay strings
// - "123" / "1.5" parsed as number
// - "true" / "false" parsed as boolean
// - "[a,b,c]" parsed as array of strings
// - JSON values (starting with { or [) parsed as JSON
// - keys with dots like "size.width" become nested

function coerce(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return parseFloat(raw);
  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      return JSON.parse(raw);
    } catch {
      /* fall through */
    }
  }
  return raw;
}

export function parseInputs(pairs: string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf('=');
    if (eq === -1) {
      throw new Error(`Invalid --input value "${pair}". Use key=value.`);
    }
    const key = pair.slice(0, eq).trim();
    const val = coerce(pair.slice(eq + 1));
    setPath(out, key, val);
  }
  return out;
}

function setPath(obj: Record<string, any>, dotted: string, value: unknown): void {
  const parts = dotted.split('.');
  let cur: any = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (typeof cur[k] !== 'object' || cur[k] === null) cur[k] = {};
    cur = cur[k];
  }
  cur[parts[parts.length - 1]] = value;
}
