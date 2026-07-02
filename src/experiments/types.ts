// Every experiment returns a human-readable log line (or several) plus a coarse
// ok flag. The test-bench renderer just appends `log` to its console so you can
// see exactly what happened on a real Discord call.
export interface ExpResult {
  ok: boolean;
  log: string;
}
