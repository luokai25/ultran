/**
 * L2 - Connector manifest types and validation.
 *
 * A manifest is a security artifact, not a config file. Validation is strict:
 * anything ambiguous is rejected rather than defaulted.
 */

export type AuthKind = 'oauth2' | 'pat' | 'none' | 'mtls';

export interface AuthSpec {
  kind: AuthKind;
  /** OAuth scopes or PAT permission names requested from the user. */
  scopes?: string[];
}

export interface EgressRule {
  /** Exact hostname. Wildcards are not permitted: they widen the blast radius. */
  host: string;
  port: number;
}

export interface ToolSchema {
  /** Dotted, namespaced: "github.issues.create". */
  id: string;
  description: string;
  /** The single capability this tool consumes. Must be declared by the connector. */
  capability: string;
  /** JSON Schema for the tool's arguments. */
  inputSchema: Record<string, unknown>;
  /** True if the tool reaches the network; requires a non-empty egress list. */
  network?: boolean;
}

export interface ConnectorManifest {
  id: string;
  version: string;
  displayName: string;
  description?: string;
  capabilities: string[];
  auth: AuthSpec;
  egress: EgressRule[];
  tools: ToolSchema[];
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const AUTH_KINDS: readonly AuthKind[] = ['oauth2', 'pat', 'none', 'mtls'];

/**
 * Validate a manifest. Returns every problem found, not just the first.
 * An empty array means the manifest is safe to register.
 */
export function validateManifest(manifest: ConnectorManifest): string[] {
  const errors: string[] = [];

  if (!ID_RE.test(manifest.id)) {
    errors.push(`id "${manifest.id}" must match ${ID_RE}`);
  }
  if (!SEMVER_RE.test(manifest.version)) {
    errors.push(`version "${manifest.version}" is not valid semver`);
  }
  if (!AUTH_KINDS.includes(manifest.auth.kind)) {
    errors.push(`auth.kind "${manifest.auth.kind}" is not supported`);
  }

  const declared = new Set(manifest.capabilities);
  const used = new Set<string>();
  const seenToolIds = new Set<string>();

  // Tool ids are namespaced under the connector id.
  const prefix = `${manifest.id}.`;

  for (const tool of manifest.tools) {
    if (seenToolIds.has(tool.id)) {
      errors.push(`duplicate tool id "${tool.id}"`);
    }
    seenToolIds.add(tool.id);

    if (!tool.id.startsWith(prefix)) {
      errors.push(`tool "${tool.id}" must be namespaced under "${prefix}"`);
    }

    if (!declared.has(tool.capability)) {
      errors.push(
        `tool "${tool.id}" requires capability "${tool.capability}" which the manifest does not declare`,
      );
    }
    used.add(tool.capability);

    if (tool.network && manifest.egress.length === 0) {
      errors.push(
        `tool "${tool.id}" declares network access but the egress list is empty`,
      );
    }
  }

  // Declared-but-unused capabilities are dead authority. Reject them.
  for (const cap of declared) {
    if (!used.has(cap)) {
      errors.push(`capability "${cap}" is declared but no tool uses it`);
    }
  }

  for (const rule of manifest.egress) {
    if (rule.host.includes('*')) {
      errors.push(`egress host "${rule.host}" must not contain wildcards`);
    }
    if (!Number.isInteger(rule.port) || rule.port < 1 || rule.port > 65535) {
      errors.push(`egress rule for "${rule.host}" has an invalid port`);
    }
  }

  return errors;
}
