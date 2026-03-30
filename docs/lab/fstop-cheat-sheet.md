# F-Stop Cheat Sheet

Small glossary for the terms that show up most often in the Lab runtime.

For the higher-level system shape, see
[F-Stop Architecture](./fstop-architecture.md).

## Core Terms

- `session`
  One full conversation or trace.

- `bundle`
  A replayable Lab file for one session. This is an internal packaging term.

- `step`
  One replay event inside a bundle. A session can have many steps.

- `slice`
  One chunk of dataset rows processed in a single F-Stop attempt.

- `window`
  One larger unattended campaign segment made of multiple slices.

- `run`
  One executed F-Stop process. In practice this usually means one unattended
  runner invocation over a configured slice budget.

- `campaign`
  Multiple unattended runs/windows chained together on a VPS.

- `proposal`
  A candidate improvement that F-Stop thinks is worth review.

- `patch`
  An actual code diff produced by the optimizer.

## Mental Model

F-Stop does this:

1. load a session bundle
2. replay it through real Aperture Core
3. prepare a review artifact
4. ask OpenClaw to review Aperture's read
5. compare the review against Aperture's recorded values
6. collect repeated disagreements
7. try a bounded patch if the signal is strong enough

## Counting

- `sessions` are not the same thing as `messages`
- one session can contain many messages, tool calls, tool results, and replay
  steps
- OpenClaw usually reviews at the **session/bundle level**, not one prompt per
  replay step

So:

- `144 sessions reviewed` does **not** mean `144 messages`
- and `7,825 replay steps` does **not** mean `7,825 OpenClaw prompts`

## Useful Translation

When reading live F-Stop output:

- `slice offset=48 limit=6`
  means "review the next 6 sessions starting at dataset offset 48"

- `windowCount=3 maxSlices=8 limit=6`
  means "up to 3 unattended runs, each allowed to review up to 8 chunks of 6
  sessions"

- `no_signal`
  means "review found disagreements, but not enough repeated signal to justify a
  proposal"

- `no_change`
  means "F-Stop found repeated signal and tried an optimizer pass, but nothing
  trustworthy improved"

- `proposal_ready`
  means "there is a reviewable proposal artifact, and possibly a patch"
