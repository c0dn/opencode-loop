import { describe, expect, test } from "bun:test"

import { type Host, listJobs, loopCommand, parseDuration, schedule, stop, tick } from "../src/loop.ts"

type Message = { type: string; text?: string }

/** An in-memory session with a hand-moved clock; `answer()` plays the agent's reply to the last run. */
function fakeHost() {
  let now = 1_000_000
  const messages: Message[] = []
  const notices: string[] = []
  const store = new Map<string, unknown>()
  const host: Host = {
    now: () => now,
    context: async () => [...messages],
    async turn(_sessionID, text) {
      messages.push({ type: "synthetic", text })
    },
    async notify(_sessionID, text) {
      notices.push(text)
    },
    storage: {
      get: async (key) => structuredClone(store.get(key)),
      set: async (key, value) => void store.set(key, structuredClone(value)),
      remove: async (key) => void store.delete(key),
      scan: async (prefix) => [...store].filter(([k]) => k.startsWith(prefix)).map(([key, value]) => ({ key, value })),
    },
  }
  return {
    host,
    messages,
    notices,
    advance: (ms: number) => void (now += ms),
    answer: () => void messages.push({ type: "assistant" }),
    runs: () => messages.filter((m) => m.type === "synthetic").length,
  }
}

const MIN = 60_000

describe("parsing", () => {
  test("durations", () => {
    expect(parseDuration("10m")).toBe(10 * MIN)
    expect(parseDuration("2h")).toBe(120 * MIN)
    expect(parseDuration("ten minutes")).toBeUndefined()
  })

  test("/loop every with flags", async () => {
    const { host } = fakeHost()
    expect(await loopCommand(host, "s1", "every 10m --max 3 check MR !12")).toContain("every 10m, up to 3 runs")
    const [job] = await listJobs(host, "s1")
    expect(job).toMatchObject({ prompt: "check MR !12", everyMs: 10 * MIN, maxRuns: 3 })
    await expect(loopCommand(host, "s1", "every 10s x")).rejects.toThrow("shortest interval")
    await expect(loopCommand(host, "s1", "tomorrow x")).rejects.toThrow()
  })
})

describe("scheduler", () => {
  test("a repeating loop fires on schedule and stops at its run limit", async () => {
    const t = fakeHost()
    await schedule(t.host, "s1", { every: "10m", prompt: "check the deploy", maxRuns: 2 })
    await tick(t.host)
    expect(t.runs()).toBe(0)

    t.advance(10 * MIN)
    await tick(t.host)
    expect(t.runs()).toBe(1)
    expect(t.messages[0]!.text).toContain("check the deploy")
    expect(t.messages[0]!.text).toContain("call loop_stop")
    t.answer()

    t.advance(10 * MIN)
    await tick(t.host)
    expect(t.runs()).toBe(2)
    expect(await listJobs(t.host)).toHaveLength(0)
    expect(t.notices[0]).toContain("2-run limit")
  })

  test("a run waits while the previous run is unanswered", async () => {
    const t = fakeHost()
    await schedule(t.host, "s1", { every: "1m", prompt: "poll" })
    t.advance(MIN)
    await tick(t.host)
    t.advance(5 * MIN)
    await tick(t.host)
    expect(t.runs()).toBe(1)
    t.answer()
    await tick(t.host)
    expect(t.runs()).toBe(2)
  })

  test("one-shot loops run once; expired loops are dropped with a notice", async () => {
    const t = fakeHost()
    await schedule(t.host, "s1", { in: "20m", prompt: "remind me" })
    await schedule(t.host, "s1", { every: "1h", prompt: "slow", for: "1h" })
    t.advance(20 * MIN)
    await tick(t.host)
    expect(t.runs()).toBe(1)
    expect((await listJobs(t.host)).map((j) => j.prompt)).toEqual(["slow"])

    t.advance(2 * 60 * MIN)
    await tick(t.host)
    expect(await listJobs(t.host)).toHaveLength(0)
    expect(t.notices.at(-1)).toContain("expired")
  })

  test("stopping one loop leaves the others running", async () => {
    const t = fakeHost()
    const a = await schedule(t.host, "s1", { every: "5m", prompt: "a" })
    await schedule(t.host, "s1", { every: "5m", prompt: "b" })
    expect((await stop(t.host, "s1", a.id)).map((j) => j.prompt)).toEqual(["a"])
    expect((await listJobs(t.host, "s1")).map((j) => j.prompt)).toEqual(["b"])
    expect(await stop(t.host, "s1", "nope")).toHaveLength(0)
    expect(await listJobs(t.host, "s1")).toHaveLength(1)
  })

  test("stop is scoped to the session", async () => {
    const t = fakeHost()
    const mine = await schedule(t.host, "s1", { every: "5m", prompt: "a" })
    await schedule(t.host, "s2", { every: "5m", prompt: "b" })
    expect(await stop(t.host, "s2", mine.id)).toHaveLength(0)
    expect(await stop(t.host, "s1", "all")).toHaveLength(1)
    expect((await listJobs(t.host)).map((j) => j.sessionID)).toEqual(["s2"])
  })
})
