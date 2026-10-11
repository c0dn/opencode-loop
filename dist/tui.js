// @bun
// tui.ts
import { Plugin } from "@opencode/plugin/tui";

// src/rpc.ts
import { Rpc } from "@opencode/plugin/rpc";
var Loop = Rpc.define({
  id: "loop",
  methods: {
    list: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { jobs: { type: "array", items: { type: "object" } } },
        required: ["jobs"],
        additionalProperties: false
      }
    },
    loop: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, args: { type: "string" } },
        required: ["sessionID", "args"],
        additionalProperties: false
      },
      output: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false
      }
    }
  },
  events: {
    notice: {
      schema: {
        type: "object",
        properties: { sessionID: { type: "string" }, text: { type: "string" } },
        required: ["sessionID", "text"],
        additionalProperties: false
      }
    }
  }
});

// src/sidebar.tsx
import { effect as _$effect } from "@opentui/solid";
import { insert as _$insert } from "@opentui/solid";
import { createComponent as _$createComponent } from "@opentui/solid";
import { createTextNode as _$createTextNode } from "@opentui/solid";
import { insertNode as _$insertNode } from "@opentui/solid";
import { setProp as _$setProp } from "@opentui/solid";
import { createElement as _$createElement } from "@opentui/solid";
import { TextAttributes } from "@opentui/core";
import { createSignal, For, onCleanup, Show } from "solid-js";

// src/loop.ts
var DEFAULT_LIFETIME_MS = 24 * 3600000;
var MAX_LIFETIME_MS = 7 * 24 * 3600000;
function formatDuration(ms) {
  if (ms < 60000)
    return `${Math.max(0, Math.round(ms / 1000))}s`;
  if (ms < 3600000)
    return `${Math.round(ms / 60000)}m`;
  const total = Math.round(ms / 60000);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes ? `${hours}h${minutes}m` : `${hours}h`;
}

// src/sidebar.tsx
var POLL_MS = 5000;
function shorten(text, length) {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length - 1)}\u2026` : line;
}
function LoopsSection(props) {
  const theme = props.context.theme;
  const [jobs, setJobs] = createSignal([]);
  const [now, setNow] = createSignal(Date.now());
  const refresh = () => props.list(props.sessionID).then((list) => setJobs([...list].sort((left, right) => left.nextAt - right.nextAt))).catch(() => setJobs([])).finally(() => setNow(Date.now()));
  refresh();
  const timer = setInterval(() => void refresh(), POLL_MS);
  onCleanup(() => clearInterval(timer));
  const when = (job) => {
    const due = job.nextAt - now();
    return due > 0 ? `in ${formatDuration(due)}` : "due";
  };
  const cadence = (job) => job.everyMs ? `every ${formatDuration(job.everyMs)} \xB7 ${job.runs}/${job.maxRuns}` : "once";
  return _$createComponent(Show, {
    get when() {
      return jobs().length > 0;
    },
    get children() {
      var _el$ = _$createElement("box"), _el$2 = _$createElement("text");
      _$insertNode(_el$, _el$2);
      _$setProp(_el$, "flexDirection", "column");
      _$setProp(_el$, "gap", 0);
      _$setProp(_el$, "paddingTop", 1);
      _$insertNode(_el$2, _$createTextNode(`Loops`));
      _$insert(_el$, _$createComponent(For, {
        get each() {
          return jobs();
        },
        children: (job) => (() => {
          var _el$4 = _$createElement("box"), _el$5 = _$createElement("box"), _el$6 = _$createElement("text"), _el$7 = _$createElement("text"), _el$8 = _$createElement("text");
          _$insertNode(_el$4, _el$5);
          _$insertNode(_el$4, _el$8);
          _$setProp(_el$4, "flexDirection", "column");
          _$setProp(_el$4, "gap", 0);
          _$insertNode(_el$5, _el$6);
          _$insertNode(_el$5, _el$7);
          _$setProp(_el$5, "flexDirection", "row");
          _$setProp(_el$5, "justifyContent", "space-between");
          _$setProp(_el$5, "gap", 1);
          _$insert(_el$6, () => `  ${shorten(job.prompt, 24)}`);
          _$insert(_el$7, () => when(job));
          _$insert(_el$8, () => `    ${cadence(job)} \xB7 ${job.id}`);
          _$effect((_p$) => {
            var _v$3 = theme.text.default, _v$4 = theme.text.subdued, _v$5 = theme.text.subdued;
            _v$3 !== _p$.e && (_p$.e = _$setProp(_el$6, "fg", _v$3, _p$.e));
            _v$4 !== _p$.t && (_p$.t = _$setProp(_el$7, "fg", _v$4, _p$.t));
            _v$5 !== _p$.a && (_p$.a = _$setProp(_el$8, "fg", _v$5, _p$.a));
            return _p$;
          }, {
            e: undefined,
            t: undefined,
            a: undefined
          });
          return _el$4;
        })()
      }), null);
      _$effect((_p$) => {
        var _v$ = theme.text.default, _v$2 = TextAttributes.BOLD;
        _v$ !== _p$.e && (_p$.e = _$setProp(_el$2, "fg", _v$, _p$.e));
        _v$2 !== _p$.t && (_p$.t = _$setProp(_el$2, "attributes", _v$2, _p$.t));
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$;
    }
  });
}
function loopsSidebar(context, list) {
  return context.ui.slot({
    append: "sidebar.content",
    render: (props) => _$createComponent(LoopsSection, {
      context,
      get sessionID() {
        return props.sessionID;
      },
      list
    })
  });
}

// tui.ts
var tui_default = Plugin.define({
  id: "opencode-loop.tui",
  setup(context) {
    const loop = context.client.rpc(Loop);
    const currentSession = () => {
      const route = context.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };
    const locationOf = (sessionID) => context.data.session.get(sessionID)?.location ?? context.location ?? context.data.location.default();
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "loop.schedule",
          title: "Schedule a prompt to run later or repeatedly",
          slash: { name: "loop", arguments: true },
          run: async (input) => {
            const sessionID = currentSession();
            if (!sessionID)
              return void context.ui.toast.show({ title: "Loop", message: "Open a session first.", variant: "warning" });
            await loop.loop({ sessionID, args: input ?? "" }, { location: locationOf(sessionID) }).then((reply) => {
              const text = reply.text;
              if (text.includes(`
`))
                return context.ui.dialog.alert({ title: "Loop", message: text });
              context.ui.toast.show({ title: "Loop", message: text, duration: 6000 });
            }, (error) => context.ui.toast.show({ title: "Loop", message: String(error?.message ?? error), variant: "error" }));
          }
        }
      ]
    }));
    const list = async (sessionID) => (await loop.list({ sessionID }, { location: locationOf(sessionID) })).jobs;
    const stopSidebar = loopsSidebar(context, list);
    const stopNotices = loop.events.on("notice", (event) => {
      const { sessionID, text } = event.data;
      context.ui.toast.show({ title: context.data.session.get(sessionID)?.title ?? "Loop", message: text, duration: 1e4 });
    });
    return () => {
      stopSidebar();
      stopNotices();
    };
  }
});
export {
  tui_default as default
};
