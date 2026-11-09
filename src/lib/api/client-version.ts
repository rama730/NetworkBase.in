// Oldest CLI the API still serves (report A2.12). Raise it to retire a release: older clients get 426
// CLIENT_TOO_OLD with the update command; every API answer says the minimum in x-nb-min-client.
export const MIN_CLI_VERSION = "1.0.0";

const parts = (v: string) => v.split(/[.-]/).slice(0, 3).map((n) => Number.parseInt(n, 10) || 0);

/** The CLI version in `x-nb-client: cli/2.0.0` when it is older than the minimum, else null. */
export function tooOldCli(header: string | null, min = MIN_CLI_VERSION): string | null {
  const cli = /^cli\/(\d+\.\d+\.\d+)/.exec(header ?? "")?.[1];
  if (!cli) return null;
  const [x, y] = [parts(cli), parts(min)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return (x[i] ?? 0) < (y[i] ?? 0) ? cli : null;
  return null;
}
