import { Plugin } from "@opencode/plugin/tui"

import type { Job } from "./src/loop.ts"
import { Loop } from "./src/rpc.ts"
import { loopsSidebar } from "./src/sidebar.tsx"

/** /loop and the sidebar's Loops section: the server plugin does the work, this shows it. */
export default Plugin.define({
  id: "opencode-loop.tui",
  setup(context) {
    const loop = context.client.rpc(Loop)

    const currentSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }
    const locationOf = (sessionID: string) =>
      context.data.session.get(sessionID)?.location ?? context.location ?? context.data.location.default()

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "loop.schedule",
          title: "Schedule a prompt to run later or repeatedly",
          slash: { name: "loop", arguments: true },
          run: async (input) => {
            const sessionID = currentSession()
            if (!sessionID) return void context.ui.toast.show({ title: "Loop", message: "Open a session first.", variant: "warning" })
            await loop.loop({ sessionID, args: input ?? "" }, { location: locationOf(sessionID) }).then(
              (reply) => {
                const text = (reply as { text: string }).text
                if (text.includes("\n")) return context.ui.dialog.alert({ title: "Loop", message: text })
                context.ui.toast.show({ title: "Loop", message: text, duration: 6000 })
              },
              (error) => context.ui.toast.show({ title: "Loop", message: String(error?.message ?? error), variant: "error" }),
            )
          },
        },
      ],
    }))

    const list = async (sessionID: string) =>
      ((await loop.list({ sessionID }, { location: locationOf(sessionID) })) as { jobs: Job[] }).jobs
    const stopSidebar = loopsSidebar(context, list)

    const stopNotices = loop.events.on("notice", (event) => {
      const { sessionID, text } = event.data as { sessionID: string; text: string }
      context.ui.toast.show({ title: context.data.session.get(sessionID)?.title ?? "Loop", message: text, duration: 10_000 })
    })
    return () => {
      stopSidebar()
      stopNotices()
    }
  },
})
