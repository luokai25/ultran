# @ultran/connectors

The connector SDK: the contract between what an agent *wants* to do and what
the outside world *allows* it to do.

## The idea

A connector is not a plugin with ambient authority. It is a **declaration**:
here are my capabilities, here is how I authenticate, here are my tools, and
here is the closed list of hosts I will ever talk to. The registry validates
that declaration, and the sandbox enforces it.

## Manifest shape

```jsonc
{
  "id": "github",
  "version": "1.0.0",
  "displayName": "GitHub",
  "capabilities": ["repo:read", "issue:write"],
  "auth": { "kind": "oauth2", "scopes": ["repo"] },
  "egress": [{ "host": "api.github.com", "port": 443 }],
  "tools": [
    {
      "id": "github.issues.create",
      "description": "Create an issue in a repository",
      "capability": "issue:write",
      "inputSchema": { "type": "object", "properties": {} }
    }
  ]
}
```

The full JSON Schema lives at `schema/manifest.schema.json`.

## Validation rules

A manifest is rejected when:

1. `id` does not match `^[a-z][a-z0-9-]*$`.
2. `version` is not valid semver.
3. A tool's `capability` is not listed in the connector's `capabilities`.
   Declaring a capability you never use is also an error - it is dead
   authority, and dead authority rots into live authority.
4. Two tools share an `id`.
5. Any tool that declares network access has an empty `egress` list.
6. `auth.kind` is not one of `oauth2 | pat | none | mtls`.
7. A tool id is not namespaced under the connector id.
8. An egress host contains a wildcard.

## Structure

```
src/
├── manifest.ts    # Types + validateManifest()
├── registry.ts    # ConnectorRegistry: load, validate, resolve
└── builtin/       # First-party connectors
schema/
└── manifest.schema.json
```

## Usage

```ts
import { ConnectorRegistry } from '@ultran/connectors';

const registry = new ConnectorRegistry();
registry.load(githubManifest);

const tools = registry.listTools({ capability: 'issue:write' });
```
