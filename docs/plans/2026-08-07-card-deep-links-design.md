# Card deep links design

## Goal

Let agents reference a card by its source path and, after an explicit user
preference, add a clickable link that opens that card in the already running
Flowmark workspace. On macOS the link should reuse and focus an existing Safari
tab instead of opening the default browser.

## Link contract

`flowmark link <card-id>` validates the current workspace and card, finds the
live session registered for that workspace, and prints a custom URL:

```text
flowmark://open?workspace=%2Fabsolute%2Fworkspace&card=card_example
```

`--format markdown` prints `[Open in Flowmark](...)` for agent responses. The
link contains the workspace path and immutable card ID, never the transient
port. If the card or live session cannot be found, the command fails with an
actionable message and agents retain the source path as the usable fallback.

## Browser behavior

The board accepts `?card=<card-id>`. A valid active card opens in the existing
card modal after workspace hydration. Closing the modal removes the search
parameter, and opening a card from the board updates it. Unknown or archived
IDs do not produce an empty modal.

On macOS, `flowmark links install` creates rebuildable runtime state at
`~/.flowmark/apps/Flowmark Card Links.app` and registers it as the `flowmark`
URL handler. The handler
passes the URL to the installed Flowmark executable. Flowmark resolves the
workspace session and first asks an installed `~/Applications/FlowMark.app`
Safari Web App to open the HTTP card deep link when its configured origin
matches the session. The standalone server prefers port 3000 for compatibility
with the default Web App and falls back to a dynamic port when it is occupied.
Without a matching Web App origin, Flowmark asks Safari through `osascript` to find a tab
belonging to the session, navigate it to the deep link, select the tab, and
activate Safari. The first fallback invocation may trigger the normal macOS
Automation permission prompt. If no matching Safari tab exists, Flowmark opens
the deep link in Safari.

No custom handler is installed by `flowmark init`: installation changes
machine-level state and remains an explicit one-time command. Linux builds keep
the portable HTTP deep-link and card-link resolution code but report that the
Safari handler is macOS-only.

## Agent guidance

Fresh `AGENTS.md` files contain a marked card-link preference block in state
`ask`. While the state is `ask`, agents use only a repository-relative source
path such as `cards/card_example.md`. The first time an agent would report a
card, it asks whether future responses should also include live Flowmark links.
After the answer, the agent changes only the marker to `always` or `never`.

With `always`, agents keep the source path and append the output of
`flowmark link <card-id> --format markdown`. With `never`, they keep paths only.
The generated guidance never hardcodes a host or port.

Existing workspaces are migrated by appending this bounded block only when it
is absent. Existing `AGENTS.md` content is otherwise preserved exactly. The
currently running workspace is set to `always` because the user has already
chosen both path and link behavior.

## Safety and validation

Custom URLs accept only the `flowmark://open` shape, an absolute workspace path,
and a lowercase URL-safe `card_` ID. Session lookup uses the existing rebuildable
registry and probes the selected session before opening Safari. The Web App
origin is read from its manifest rather than assumed. AppleScript
arguments are passed as process arguments rather than interpolated into script
source.

Tests cover URL parsing and encoding, card/session failures, generated agent
guidance, preservation of custom guidance, board search-state behavior,
AppleScript selection/fallback behavior through injected process execution, and
standalone binary help/smoke coverage. Final verification uses the complete
project gate plus strict validation of every modified workspace.
