# Documentation

| Document | What it covers |
| --- | --- |
| [architecture.md](architecture.md) | The layered design, layer contracts, data flow, trust boundaries, and the ADR log. **Start here.** |

## Reading order

If you are new to the codebase, read in this order:

1. **Layered view** in `architecture.md` section 2 - the five layers and why
   dependencies only point downward.
2. **Layer contracts** section 3 - the interface each layer exposes, and its
   invariants.
3. **Data flow** section 5 - follow a single turn from input to output.
4. **Trust boundaries** section 6 - where the security model lives.

## Conventions

- Layers are referred to as L0-L5, matching the architecture document.
- Every architectural change appends to the decision log in section 10.
- Diagrams are ASCII: they survive code review diffs and terminal viewing.
