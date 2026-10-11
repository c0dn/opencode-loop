/** What the scheduler needs from the plugin runtime, as plain functions so it can be tested with a fake. */
export interface Host {
  now(): number;
  /** The session's model context, to tell whether the last run's turn has happened. */
  context(sessionID: string): Promise<readonly unknown[]>;
  /** Adds a message and starts an agent turn from it once the session is idle. */
  turn(sessionID: string, text: string, description: string): Promise<void>;
  /** Shows a notice to the user without adding it to the model's context. */
  notify(sessionID: string, text: string): Promise<void>;
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    remove(key: string): Promise<void>;
    scan(prefix: string): Promise<readonly { key: string; value: unknown }[]>;
  };
}

export interface Job {
  id: string;
  sessionID: string;
  prompt: string;
  /** Absent for a one-shot job. */
  everyMs?: number;
  nextAt: number;
  runs: number;
  maxRuns: number;
  expiresAt: number;
  created: number;
}

export const DEFAULT_MAX_RUNS = 12;
const MIN_INTERVAL_MS = 60_000;
const DEFAULT_LIFETIME_MS = 24 * 3600_000;
const MAX_LIFETIME_MS = 7 * 24 * 3600_000;

const jobKey = (id: string) => `loop:${id}`;

export function parseDuration(text: string): number | undefined {
  const match = /^(\d+)(s|m|h|d)$/.exec(text.trim());
  if (!match) return undefined;
  const unit = { s: 1000, m: 60_000, h: 3600_000, d: 24 * 3600_000 }[match[2] as "s" | "m" | "h" | "d"];
  return Number(match[1]) * unit;
}

export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m`;
  const hours = Math.floor(ms / 3600_000);
  const minutes = Math.round((ms % 3600_000) / 60_000);
  return minutes ? `${hours}h${minutes}m` : `${hours}h`;
}

export interface ScheduleInput {
  /** Repeat at this interval, e.g. "10m". */
  every?: string;
  /** Run once after this delay, e.g. "20m". */
  in?: string;
  prompt: string;
  maxRuns?: number;
  /** Stop after this long, e.g. "3h". Default 24h, at most 7d. */
  for?: string;
}

function durationOrThrow(text: string, what: string): number {
  const ms = parseDuration(text);
  if (ms === undefined) throw new Error(`${what} must look like 30s, 10m, 2h or 1d, got "${text}".`);
  return ms;
}

export async function schedule(host: Host, sessionID: string, input: ScheduleInput): Promise<Job> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("A loop needs a prompt.");
  if (input.every && input.in) throw new Error("Use either every or in, not both.");
  if (!input.every && !input.in) throw new Error("Say when: every <interval> or in <delay>.");

  const now = host.now();
  const everyMs = input.every ? durationOrThrow(input.every, "every") : undefined;
  if (everyMs !== undefined && everyMs < MIN_INTERVAL_MS) throw new Error("The shortest interval is 1m.");
  const delay = input.in ? durationOrThrow(input.in, "in") : everyMs!;
  const lifetime = input.for ? Math.min(durationOrThrow(input.for, "for"), MAX_LIFETIME_MS) : DEFAULT_LIFETIME_MS;
  const maxRuns = everyMs === undefined ? 1 : Math.max(1, Math.floor(input.maxRuns ?? DEFAULT_MAX_RUNS));

  const job: Job = {
    id: Math.random().toString(36).slice(2, 6),
    sessionID,
    prompt,
    everyMs,
    nextAt: now + delay,
    runs: 0,
    maxRuns,
    expiresAt: now + Math.max(lifetime, delay),
    created: now,
  };
  await host.storage.set(jobKey(job.id), job);
  return job;
}

export async function listJobs(host: Host, sessionID?: string): Promise<Job[]> {
  const jobs = (await host.storage.scan("loop:")).map(({ value }) => value as Job);
  return jobs.filter((job) => !sessionID || job.sessionID === sessionID).sort((a, b) => a.nextAt - b.nextAt);
}

/** Removes one job of this session, or all of them with "all". Returns the removed jobs. */
export async function stop(host: Host, sessionID: string, id: string): Promise<Job[]> {
  const jobs = (await listJobs(host, sessionID)).filter((job) => id === "all" || job.id === id);
  for (const job of jobs) await host.storage.remove(jobKey(job.id));
  return jobs;
}

export function describeJob(job: Job, now: number): string {
  const when = job.everyMs ? `every ${formatDuration(job.everyMs)}` : "once";
  const runs = job.everyMs ? `, run ${job.runs}/${job.maxRuns}` : "";
  return `${job.id}  ${when}, next in ${formatDuration(job.nextAt - now)}${runs}: ${job.prompt}`;
}

const marker = (job: Job) => `[loop ${job.id} run ${job.runs}/${job.maxRuns}]`;

function runText(job: Job): string {
  const repeat = job.everyMs
    ? `This is a scheduled check that repeats every ${formatDuration(job.everyMs)}. When what it waits for has happened, or it is no longer useful, call loop_stop with id "${job.id}" and tell the user the outcome. Otherwise reply in one or two lines with the current state.`
    : "This is a one-off scheduled task.";
  return `${marker(job)} ${repeat}\n\n${job.prompt}`;
}

/** True when the job's last run was sent but its turn hasn't produced a reply yet, so another run would pile up. */
async function lastRunPending(host: Host, job: Job): Promise<boolean> {
  if (job.runs === 0) return false;
  const messages = (await host.context(job.sessionID)) as { type?: string; text?: string }[];
  const at = messages.findLastIndex((m) => m.type === "synthetic" && m.text?.startsWith(`[loop ${job.id} run ${job.runs}/`));
  return at !== -1 && !messages.slice(at + 1).some((m) => m.type === "assistant");
}

/** Runs every job that is due, once. Called on a timer. */
export async function tick(host: Host): Promise<void> {
  const now = host.now();
  for (const job of await listJobs(host)) {
    if (now >= job.expiresAt) {
      await host.storage.remove(jobKey(job.id));
      await host.notify(job.sessionID, `Loop ${job.id} expired after ${job.runs} run(s): ${job.prompt}`);
      continue;
    }
    if (now < job.nextAt || (await lastRunPending(host, job))) continue;

    job.runs += 1;
    const last = job.runs >= job.maxRuns || !job.everyMs;
    if (last) await host.storage.remove(jobKey(job.id));
    else await host.storage.set(jobKey(job.id), { ...job, nextAt: now + job.everyMs! });
    await host.turn(job.sessionID, runText(job), `loop ${job.id} · run ${job.runs}${job.everyMs ? `/${job.maxRuns}` : ""}`);
    if (last && job.everyMs) await host.notify(job.sessionID, `Loop ${job.id} reached its ${job.maxRuns}-run limit: ${job.prompt}`);
  }
}

export const LOOP_USAGE = `/loop every <interval> [--max <n>] [--for <time>] <prompt>  repeat, e.g. /loop every 10m check MR !123 is deployed
/loop in <delay> <prompt>                                 run once later
/loop                                                     list this session's loops
/loop stop <id|all>                                       stop loops`;

/** Handles /loop; returns the reply to show. */
export async function loopCommand(host: Host, sessionID: string, args: string): Promise<string> {
  const words = args.trim().split(/\s+/).filter(Boolean);
  const verb = words[0];
  if (!verb || verb === "list") {
    const jobs = await listJobs(host, sessionID);
    return jobs.length ? jobs.map((job) => describeJob(job, host.now())).join("\n") : `No loops in this session.\n\n${LOOP_USAGE}`;
  }
  if (verb === "help") return LOOP_USAGE;
  if (verb === "stop") {
    if (!words[1]) throw new Error("/loop stop <id|all>");
    const stopped = await stop(host, sessionID, words[1]);
    return stopped.length ? `Stopped ${stopped.map((job) => job.id).join(", ")}.` : `No loop "${words[1]}" in this session.`;
  }
  if (verb !== "every" && verb !== "in" && verb !== "after") throw new Error(LOOP_USAGE);

  const input: ScheduleInput = { prompt: "", [verb === "every" ? "every" : "in"]: words[1] ?? "" };
  const rest = words.slice(2);
  while (rest[0] === "--max" || rest[0] === "--for") {
    const [flag, value] = rest.splice(0, 2);
    if (flag === "--max") {
      input.maxRuns = Number(value);
      if (!Number.isInteger(input.maxRuns) || input.maxRuns < 1) throw new Error("--max needs a positive whole number.");
    }
    else input.for = value;
  }
  input.prompt = rest.join(" ");
  const job = await schedule(host, sessionID, input);
  const when = job.everyMs ? `every ${formatDuration(job.everyMs)}, up to ${job.maxRuns} runs` : "once";
  return `Scheduled loop ${job.id} (${when}), first run in ${formatDuration(job.nextAt - host.now())}. /loop stop ${job.id} to cancel.`;
}
