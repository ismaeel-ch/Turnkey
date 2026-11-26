# ADR 10: Fluent 2 for the interface

Status: accepted. Implementation: Built (#44, #62, #68, #71, #72). Tabs, switches, menus, message bars, inputs,
selects, chips and cards are Fluent components. Hand-written styles remain for the canvas and the generated app
screens.

## Context

The owner asked for an interface that follows Microsoft's Fluent 2 design system. The prototype drew its own
controls with hand-written CSS that only looked like Fluent.

## Decision

Every control in the workspace uses Fluent UI React v9 (`@fluentui/react-components`) with the Fluent 2 theme. The
hand-written CSS for a control is deleted once a Fluent component replaces it. Generated app screens keep using the
fixed catalog of view types, drawn with the same components.

## Consequences

- Keyboard use, focus, contrast and dark mode come from a maintained library instead of from our own CSS.
- The change touches every file in `src/workspace` that draws a control, so it is split into parts and every
  browser flow must stay green after each.
- Bundle size grows by the components used.

Where to look: `src/styles/`, `src/workspace/ui.tsx`, pull request #44.
