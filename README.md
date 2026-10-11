# opencode-loop

An [OpenCode](https://opencode.ai) V2 plugin that runs a prompt in your session later, or on a schedule, until the agent decides it's done. It's for things like "my coworker is about to deploy my MR, keep checking and tell me when it's live."

```text
/loop every 10m check whether MR !123 is merged and its deploy job passed
```

Each run starts an agent turn in the session once it's idle. The prompt tells the agent to call `loop_stop` when the condition is met, so a check ends itself. Otherwise the agent answers in a line or two and waits for the next run.

## Install

```sh
opencode plugin add github:c0dn/opencode-loop
```

Requires OpenCode 2.0 or later.

## Commands

```text
/loop every <interval> [--max <n>] [--for <time>] <prompt>   repeat
/loop in <delay> <prompt>                                    run once later
/loop                                                        list this session's loops
/loop stop <id|all>                                          stop loops
```

Intervals look like `30s`, `10m`, `2h` or `1d`, and a repeating loop runs at most once a minute. A repeating loop stops after 12 runs or 24 hours, whichever comes first. Change that with `--max` and `--for`, which is capped at 7 days.

## Tools

The agent gets three tools, so you can ask in plain words, e.g. "check the pipeline every 15 minutes until it's green":

- `loop_schedule`: takes `prompt`, `every` or `in`, `maxRuns` and `for`
- `loop_stop`: takes an `id`, or `"all"`
- `loop_list`

## Behaviour

- A run that comes due while the agent is busy waits until the session is idle. A run is skipped while the previous one is still unanswered, so runs never pile up.
- Loops are stored by OpenCode and carry on after a restart. They belong to the session that created them.
- Each run costs one agent turn, so pick an interval that fits what you're waiting for.
- Expired loops and loops that hit their run limit show a toast. Pair it with a notifier plugin to hear about finished runs while you're away.

## Development

```sh
bun install
bun test
bun run typecheck
```
