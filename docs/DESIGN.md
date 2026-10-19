# Design language

This project follows the **ARKS Design Language Color Spec** — a copy lives at
[`arks-color-spec.html`](arks-color-spec.html) in this folder. Open it in a
browser; every swatch copies its hex on click.

The canonical copy lives in `arks-internal`. The copy here exists so the
palette ships with the code and is available offline. If the two ever
disagree, `arks-internal` wins.

## Which palette this project uses

The spec offers six languages. Two were written for exactly this kind of
project, and the arcade uses both:

| Where | Palette | Why |
|---|---|---|
| Arcade hub, Wordless, Rambler (kids dictionary) | **8-Bit** | The spec assigns it to "a retro arcade/game-room mode — the kid request board as a *quest log*, achievement pop-ups, anything that wants a coin-op wink." That is a literal description of what got built: a theme-request board the kids submit to, a milestone system, and an initials leaderboard. |
| Rambler on the unfiltered dictionary | **Vice** | The spec's "late-night lights-off vibe". Switching palette with the dictionary makes adult mode *look* different the moment it is on — which is a safety feature as much as a style one, since you can tell across the room which mode a kid is holding. |

Summit is the other candidate — the spec assigns it to "anything with a
gamification layer", and streaks, coins and milestones qualify. It is held in
reserve; two palettes in one app is already the limit before it stops reading
as one product.

## Status

| Surface | Palette | State |
|---|---|---|
| Arcade hub (`index.html`) | 8-Bit | **applied** |
| Rambler, kids dictionary (`rambler.css`) | 8-Bit | **applied** |
| Rambler, unfiltered dictionary | Vice | **applied** — `:root.unfiltered` |
| Rambler Marathon | Vice | applied (built that way) |
| Wordless (`style.css`) | 8-Bit | **not yet — see below** |
| Admin (`admin.html`) | — | not assigned a palette |

### How Rambler switches

Every colour in `rambler.css` reads from the token block at the top of the
file. The 8-Bit values sit on bare `:root`; the Vice values sit on
`:root.unfiltered`, and `paintPalette()` in `rambler.js` toggles that class
from the dictionary actually in play. A guest joining a room gets the host's
dictionary, so for rooms the palette comes from the room's settings, not the
setup screen.

The class goes on `<html>` rather than `<body>` on purpose. A theme pack sets
its accent inline on the same element, and an inline style beats a class
rule — so a Halloween season keeps its orange on either palette.

### Derived tokens

The spec has no border, hover or tint swatches. Rather than invent hex values
for them, they are mixed from tokens that *are* in the spec:

```css
--border:      color-mix(in srgb, var(--text) 11%, var(--card));
--card-hover:  color-mix(in srgb, var(--text) 9%, var(--card-2));
--accent-soft: color-mix(in srgb, var(--accent) 18%, var(--card));
--scrim:       color-mix(in srgb, var(--plate) 88%, transparent);
```

Which means they follow the palette switch and a theme pack's accent for free.
The old `--accent-soft` was a fixed dark olive, so a Halloween season had an
orange accent sitting on yellow-tinted highlights. That is gone.

### What changed besides the hex values

- **Text is warm cream now** (`#F4ECD0`), and the secondary and caption greys
  are gold-tinted. The earlier version of this doc listed only five swaps
  and missed these — they are the biggest visible difference.
- **The clock's low-time warning uses `--warn`**, not the accent. Gold is the
  coin colour; it was standing in for a warning colour the old palette did
  not have.
- **The "season closing soon" strip uses `--warn` and gained an hourglass**,
  because status is colour + icon + word, never colour alone.
- **Traced dice are blue** — the spec's "player two" colour — where they were
  sky blue before. Accepted and rejected dice are tints of the spec's good
  and bad.

### Known overlap: Marathon is always Vice

Vice was assigned to the unfiltered dictionary as a "tell from across the
room" signal. Marathon is *also* Vice, on either dictionary, because that is
the look it was built around. So a purple phone means "unfiltered or
Marathon", not just "unfiltered". On the classic screens the signal is clean.
Left as is: changing Marathon would undo a look that was asked for.

### Why Wordless is not done

Not a token swap, and it needs a decision rather than a guess:

1. **Every Wordless theme sets its own background and accent** from the
   database (`themes.accent`, `themes.bg`), applied inline over the
   stylesheet. Retheming `style.css` changes almost nothing a player sees.
   The built-in themes are inserted with `INSERT OR IGNORE`, so changing their
   seed values would not reach an existing database either — it needs a
   migration.
2. **The "present" tile is gold**, and the 8-Bit accent is gold. Buttons and
   half-right letters would be the same colour. One of them has to move, and
   which one is a design call.

## Rules inherited from the spec

These are not negotiable per-project — they come from the spec and apply here
on day one:

- Status colours are **reserved**. Never a chart series, never decoration.
- Status is **never colour alone** — always colour + icon + word. The results
  screen already obeys this: a cancelled word is struck through *and* labelled
  "everyone found it", not merely greyed.
- Charts sit on the chart plate, never directly on a panel.
- Nothing hard-coded. If a colour appears twice, it is a token.
- The chart series is validated for colour-vision deficiency as a set.
  **Never re-tint it per theme** — there is no way to tell by eye that you
  have broken it.
