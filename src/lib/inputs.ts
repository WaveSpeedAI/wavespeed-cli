// Parse `--input key=value` pairs into a structured object suitable for the API.
// - bare strings stay strings
// - "123" / "1.5" parsed as number
// - "true" / "false" parsed as boolean
// - values starting with { or [ are parsed as JSON, and stay strings if that
//   fails — so an array has to be written as valid JSON: '["a","b"]'.
//   A bare "[a,b,c]" is not JSON and reaches the API as a string.
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

/**
 * The API rejects a scalar sent to an array field. The message says what is
 * wrong but not how to write it, and `-i key=value` gives no hint that an
 * array needs JSON — so point at the fix rather than mutating the input.
 */
export function withInputSyntaxHint(message: string, pairs: string[] = []): string {
  const field = /field "([^"]+)" must be an array/.exec(message)?.[1];
  if (!field) return message;
  const given = pairs.find((p) => p.slice(0, p.indexOf('=')).trim() === field);
  const sample = given ? given.slice(given.indexOf('=') + 1) : 'value';
  return `${message}\nWrite arrays as JSON: -i '${field}=["${sample}"]'`;
}
