# Mobile touch targets & basemap-control positioning — design

Two small, verified fixes for mobile usability, scoped down from an initial
broader guess after tracing the actual layout code. The floating-glass
overlay architecture and `AppShell.svelte`'s `recomputeLayout()` collision
avoidance (already pixel-precise, driven by measured element heights rather
than a viewport-width breakpoint) are unchanged — this only fixes two
concrete, verified defects.

## What's actually broken (verified against the code)

Ruled out during design: the sidebar's `w-[360px] max-w-[calc(100vw-1.5rem)]`
already shrinks to fit any phone width, and `RobotHud`'s fixed `w-[260px]`
never overflows any real device width (smallest common phones are ~320px
wide; 260px + 12px right margin leaves 48px of map visible). Neither needed
a change.

What does need fixing:

1. **`BasemapControl` position is hardcoded to assume a 360px-wide sidebar.**
   `AppShell.svelte`'s template sets `left:{sidebarOpen ? '376px' : '12px'}`
   — a literal baked in for exactly `360px sidebar + 12px gap + 4px`. Once
   the sidebar's `max-w` clamp kicks in on a narrow viewport (e.g. a 351px
   sidebar on a 375px-wide phone), this literal is wrong and the basemap
   switcher sits at the wrong offset relative to the sidebar's actual edge.

2. **Touch targets are too small.** Icon buttons (`.btn-icon`, used in 17
   places — toggles, zoom control, tool dock, mower control) default to
   36px and get shrunk further to 24–28px in denser contexts (e.g.
   `RobotHud`'s nested overlay rows). Native `<input type="checkbox">`
   elements (used bare, e.g. the Mowing panel's per-zone override toggles)
   render at the browser default (~13–16px) with no touch-friendly padding.
   `.input`/`.select` (the numeric spinners and dropdowns) use `!py-1` —
   very tight vertical padding. None of this affects desktop (mouse
   pointers aren't imprecise), but on a touchscreen these are all well under
   the ~44px minimum recommended touch-target size.

## Design

### Fix 1 — measure the sidebar, don't assume its width

`AppShell.svelte` already measures four elements via one `ResizeObserver`
(`mowerControlWrapEl`, `toolDockWrapEl`, `hudWrapEl`, `zoomControlWrapEl`)
to drive `recomputeLayout()`. Add a fifth observed element — the sidebar's
wrapper `<div>` — and a `sidebarWidth` reactive variable updated by the same
observer callback. Replace the hardcoded basemap-control offset:

```js
// before
style="left:{sidebarOpen ? '376px' : '12px'}"

// after
style="left:{sidebarOpen ? `${sidebarWidth + EDGE_GAP + 4}px` : '12px'}"
```

(`EDGE_GAP` is the existing `12` constant already used elsewhere in this
file; `+4` preserves today's small additional clearance between the
sidebar's edge and the basemap control.) No change to `recomputeLayout()`
itself — this is a separate, independent measurement consumed only by the
basemap control's inline style.

### Fix 2 — one shared touch-target rule in `app.css`

A single `@media (pointer: coarse)` block, added once, with no
per-component edits:

```css
@media (pointer: coarse) {
  .btn-icon {
    min-width: 44px;
    min-height: 44px;
  }
  .input,
  .select {
    min-height: 44px;
  }
  input[type="checkbox"] {
    width: 20px;
    height: 20px;
  }
}
```

Verified mechanically sound: `min-width`/`min-height` always win over a
conflicting `width`/`height` (including Tailwind's `!h-6`-style `!important`
utility overrides already used throughout the app) because they're
different CSS properties, not a specificity fight — the browser computes
final size as `clamp(min, requested, max)` regardless of which rule is
`!important`. `@media (pointer: coarse)` matches touchscreens and is
excluded on mouse/trackpad devices, so desktop density is untouched by
construction — no JS pointer-type detection needed.

The checkbox size (20px, not 44px) is a deliberate deviation: unlike a
button, a checkbox's clickable area is normally its visual box itself, and
blowing it up to 44px would look broken sitting next to 12px-tall label
text. 20px is a meaningful improvement over the ~13px browser default while
staying visually proportionate; the browser's own default hit-testing
already extends a few px past the visual box in most engines, and the
existing `gap-2` spacing between the checkbox and its label statically
provides a bit more breathing room. If real device testing after this
lands shows 20px still isn't tappable enough, that's a one-line follow-up,
not a redesign.

## Out of scope

- Sidebar content density/row spacing (not requested; the two fixes above
  are the verified root causes).
- Any change to `recomputeLayout()`'s vertical-stacking algorithm — it
  already reflows continuously based on measured space, not a breakpoint.
- Any change to `Sidebar.svelte`, `ToolDock.svelte`, `MowerControl.svelte`,
  or the capture-toggle components — none have hardcoded widths, and they
  already inherit `.btn-icon`/`.input`/`.select`, so Fix 2 covers them for
  free.

## Testing

No unit-testable logic (CSS + one derived layout offset). Verify by hand in
the browser, per this project's own convention for UI changes:

- Chrome DevTools device emulation at phone widths (375×667, 360×800):
  confirm the basemap control sits flush against the sidebar's actual right
  edge when open, with no gap or overlap, at both widths.
- Same emulation with touch simulation on: confirm `.btn-icon` elements
  measure ≥44×44px via the Elements panel / a quick `getBoundingClientRect()`
  check.
- Normal desktop width (1440px, mouse pointer): confirm no visual change
  from before this fix — same icon sizes, same basemap-control position.
