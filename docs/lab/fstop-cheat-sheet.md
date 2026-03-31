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

## Nested Hierarchy

The simplest nesting is:

- `campaign`
  contains one or more `windows`

- `window`
  contains multiple `slices`

- `slice`
  contains multiple `sessions`

- `session`
  contains many replay `steps`

And separately:

- `bundle`
  is the replayable Lab file for one session

## Mental Model

F-Stop does this:

1. load a session bundle
2. replay it through real Aperture Core
3. prepare a review artifact
4. ask the reviewer backend to review Aperture's read
5. compare the review against Aperture's recorded values
6. collect repeated disagreements
7. try a bounded patch if the signal is strong enough

## Counting

- `sessions` are not the same thing as `messages`
- one session can contain many messages, tool calls, tool results, and replay
  steps
- the reviewer backend usually works at the **session/bundle level**, not one
  prompt per replay step

### Example

For a campaign configured like this:

- `windowCount=3`
- `maxSlices=8`
- `limit=6`

The campaign can review:

- `3 windows`
- `8 slices per window`
- `6 sessions per slice`

So the maximum reviewed session count is:

- `3 * 8 * 6 = 144 sessions`

One real run at that shape produced:

- `144 sessions reviewed`
- about `7,825 replay steps`
- `144 reviewer prompts`
- `12 optimizer prompts`
- `156 backend prompts total`

So:

- `144 sessions reviewed` does **not** mean `144 messages`
- and `7,825 replay steps` does **not** mean `7,825 backend prompts`
- backend prompt count is usually much closer to `session` count than `step`
  count

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

- `retained proposal`
  means "the run still found a strong non-winning idea worth keeping for later
  review"

- `proposal brief`
  means "the compiled human-readable Markdown view of retained proposals across
  runs"

## Human Review Files

After a run, the easiest human entrypoints are:

- runner review:
  `.aperture/lab/results/autoresearch/runner/runs/<run>.md`
- retained proposal brief:
  `.aperture/lab/results/autoresearch/backlog/autoresearch-retained-backlog.md`

The runner review is best for:

- what this one run found
- the best retained intent from this run
- exact attempted slice/patch context

The retained proposal brief is best for:

- what keeps showing up across runs
- plain-English proposed changes
- example evidence and target files
- optimizer outcomes for follow-up triage
