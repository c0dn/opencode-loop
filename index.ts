import { Plugin } from "@opencode/plugin"

import { describeJob, type Host, listJobs, LOOP_USAGE, loopCommand, schedule, stop, tick } from "./src/loop.ts"
import { Loop } from "./src/rpc.ts"

const TICK_MS = 15_000

const SCHEDULE_INPUT = {
  type: "object",
  properties: {
    prompt: {
      type: "string",
      minLength: 1,
      description:
        "What to do on each run, written as an instruction to yourself, including how to check and what counts as done. E.g. 'Run glab mr view 123 and check the latest pipeline. Done when merged and the deploy job passed.'",
    },
    every: { type: "string", description: "Repeat at this interval: 30s, 10m, 2h, 1d. At least 1m." },
    in: { type: "string", description: "Run once after this delay instead of repeating." },
    maxRuns: { type: "integer", minimum: 1, description: "Stop after this many runs (repeating loops only). Default 12." },
    for: { type: "string", description: "Stop after this long, e.g. 3h. Default 24h, at most 7d." },
  },
  required: ["prompt"],
  additionalProperties: false,
} as const

/**
 * Scheduled prompts for a session: each run starts an agent turn once the
 * session is idle, and a run is skipped while the previous one hasn't been answered.
 */
export default Plugin.define({
  id: "opencode-loop",
  async setup(context) {
    const host: Host = {
      now: () => Date.now(),
      context: (sessionID) => context.session.context({ sessionID }),
      async turn(sessionID, text, description) {
        await context.session.synthetic({ sessionID, text, description, delivery: "queue", resume: true })
      },
      async notify(sessionID, text) {
        await rpc.events.emit("notice", { sessionID, text })
      },
      storage: {
        get: (key) => context.storage.get(key),
        set: (key, value) => context.storage.set(key, value as Parameters<typeof context.storage.set>[1]),
        remove: (key) => context.storage.remove(key),
        async scan(prefix) {
          const entries: { key: string; value: unknown }[] = []
          let after: string | undefined
          do {
            const page = await context.storage.scan({ prefix, after })
            entries.push(...page.entries)
            after = page.next
          } while (after)
          return entries
        },
      },
    }

    const failure = (error: unknown) => (error instanceof Error ? error.message : String(error))
    const rpc = await context.rpc.register(Loop, {
      async loop(input) {
        const { sessionID, args } = input as { sessionID: string; args: string }
        return { text: await loopCommand(host, sessionID, args.replace(/^\s*\/?loop\b/, "")).catch(failure) }
      },
    })

    const tools = await context.tool.transform((draft) => {
      draft.add({
        name: "loop_schedule",
        description: `Schedule a prompt to run in this session later or repeatedly, e.g. to check on a deploy, an MR, a CI run or a long job. Each run starts a turn for you when the session is idle. For a repeating check, stop it with loop_stop once the condition is met. The user manages loops with:\n${LOOP_USAGE}`,
        input: SCHEDULE_INPUT,
        options: { codemode: false as const },
        async execute(input, toolContext) {
          const job = await schedule(host, toolContext.sessionID, input as Parameters<typeof schedule>[2])
          return { content: `Scheduled: ${describeJob(job, host.now())}` }
        },
      })
      draft.add({
        name: "loop_stop",
        description: "Stop a scheduled loop in this session by its id, or every loop with \"all\".",
        input: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
        options: { codemode: false as const },
        async execute(input, toolContext) {
          const stopped = await stop(host, toolContext.sessionID, (input as { id: string }).id)
          return { content: stopped.length ? `Stopped ${stopped.map((job) => job.id).join(", ")}.` : "No such loop." }
        },
      })
      draft.add({
        name: "loop_list",
        description: "List the scheduled loops in this session.",
        input: { type: "object", properties: {}, additionalProperties: false },
        options: { codemode: false as const },
        async execute(_input, toolContext) {
          const jobs = await listJobs(host, toolContext.sessionID)
          return { content: jobs.length ? jobs.map((job) => describeJob(job, host.now())).join("\n") : "No loops." }
        },
      })
    })

    let ticking = false
    const timer = setInterval(() => {
      if (ticking) return
      ticking = true
      tick(host)
        .catch((error) => console.error("opencode-loop tick failed", error))
        .finally(() => (ticking = false))
    }, TICK_MS)

    return async () => {
      clearInterval(timer)
      await tools.dispose()
      await rpc.dispose()
    }
  },
})
