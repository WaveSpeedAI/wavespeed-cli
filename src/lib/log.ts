// Tiny logging helper so commands can emit progress to stderr while keeping
// stdout reserved for the final --json payload (and downstream pipes).

let jsonMode = false;

export function setJsonMode(on: boolean): void {
  jsonMode = on;
}

export function isJsonMode(): boolean {
  return jsonMode;
}

export function log(line: string): void {
  if (jsonMode) return;
  process.stdout.write(line + '\n');
}

export function info(line: string): void {
  if (jsonMode) {
    process.stderr.write(line + '\n');
    return;
  }
  process.stdout.write(line + '\n');
}

export function emitJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
}

export function emitJsonError(message: string, extra: Record<string, unknown> = {}): void {
  process.stdout.write(JSON.stringify({ error: message, ...extra }, null, 2) + '\n');
}
