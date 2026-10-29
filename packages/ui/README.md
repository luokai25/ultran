# @ultran/ui

The Ultran design system. One set of tokens, two renderers.

## Why it exists

The web console and the mobile client show the same objects: runs, connectors,
capability grants, entitlements. They must not drift. This package is the
single source of truth for colour, spacing, radius, and type.

## What it is not

It is **not** a component library yet. Components arrive once the two surfaces
have converged; premature abstraction would force the mobile client to carry
web concerns (and vice versa). At v0.1 it ships tokens only.

## Usage

```ts
import { colors, space, radius } from '@ultran/ui/tokens';

const card = {
  background: colors.surface,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  padding: space.lg,
};
```

## Structure

```
src/
├── tokens.ts   # Colour, spacing, radius, typography
└── index.ts    # Barrel export
```
