/** @jsxImportSource @opentui/solid */
import { TextAttributes } from "@opentui/core"
import type { Context } from "@opencode/plugin/tui/context"
import { createSignal, For, onCleanup, Show } from "solid-js"

import { formatDuration, type Job } from "./loop.ts"

const POLL_MS = 5_000

function shorten(text: string, length: number): string {
  const line = text.replace(/\s+/g, " ").trim()
  return line.length > length ? `${line.slice(0, length - 1)}…` : line
}

/** The session's scheduled loops; hidden while there are none. */
export function LoopsSection(props: {
  context: Context
  sessionID: string
  list: (sessionID: string) => Promise<Job[]>
}) {
  const theme = props.context.theme
  const [jobs, setJobs] = createSignal<Job[]>([])
  const [now, setNow] = createSignal(Date.now())

  const refresh = () =>
    props
      .list(props.sessionID)
      .then((list) => setJobs([...list].sort((left, right) => left.nextAt - right.nextAt)))
      .catch(() => setJobs([]))
      .finally(() => setNow(Date.now()))
  void refresh()
  const timer = setInterval(() => void refresh(), POLL_MS)
  onCleanup(() => clearInterval(timer))

  const when = (job: Job) => {
    const due = job.nextAt - now()
    return due > 0 ? `in ${formatDuration(due)}` : "due"
  }
  const cadence = (job: Job) => (job.everyMs ? `every ${formatDuration(job.everyMs)} · ${job.runs}/${job.maxRuns}` : "once")

  return (
    <Show when={jobs().length > 0}>
      <box flexDirection="column" gap={0} paddingTop={1}>
        <text fg={theme.text.default} attributes={TextAttributes.BOLD}>
          Loops
        </text>
        <For each={jobs()}>
          {(job) => (
            <box flexDirection="column" gap={0}>
              <box flexDirection="row" justifyContent="space-between" gap={1}>
                <text fg={theme.text.default}>{`  ${shorten(job.prompt, 24)}`}</text>
                <text fg={theme.text.subdued}>{when(job)}</text>
              </box>
              <text fg={theme.text.subdued}>{`    ${cadence(job)} · ${job.id}`}</text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

/** Adds the Loops section to the session sidebar; returns its dispose. */
export function loopsSidebar(context: Context, list: (sessionID: string) => Promise<Job[]>): () => void {
  return context.ui.slot({
    append: "sidebar.content",
    render: (props) => <LoopsSection context={context} sessionID={props.sessionID} list={list} />,
  })
}
