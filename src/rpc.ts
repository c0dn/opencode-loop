import { Rpc } from "@opencode/plugin/rpc"

/**
 * A server plugin command can only answer with a synthetic message, which the
 * TUI shows as its description alone and the model reads in full. So /loop is a
 * TUI slash command that calls this and shows the reply.
 */
export const Loop = Rpc.define({
  id: "loop",
  methods: {
    loop: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, args: { type: "string" } },
        required: ["sessionID", "args"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
    },
  },
  events: {
    notice: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, text: { type: "string" } },
        required: ["sessionID", "text"],
        additionalProperties: false,
      },
    },
  },
})
