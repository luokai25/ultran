/**
 * L2 - Connector registry.
 *
 * Discovery, validation, and resolution. Resolution order is:
 *   workspace override -> built-in -> marketplace.
 * Two connectors with the same id never load simultaneously.
 */

import { validateManifest, type ConnectorManifest, type ToolSchema } from './manifest.js';

export type ConnectorSource = 'builtin' | 'workspace' | 'marketplace';

export interface RegisteredConnector {
  manifest: ConnectorManifest;
  source: ConnectorSource;
}

const PRIORITY: Record<ConnectorSource, number> = {
  workspace: 0,
  builtin: 1,
  marketplace: 2,
};

export interface ListToolsOptions {
  /** Only return tools consuming this capability. */
  capability?: string;
  /** Only return tools from these connector ids. */
  connectorIds?: string[];
}

export class ConnectorRegistry {
  private readonly connectors = new Map<string, RegisteredConnector>();

  /**
   * Register a connector. Invalid manifests throw; a lower-priority source can
   * never displace a higher-priority one.
   */
  load(manifest: ConnectorManifest, source: ConnectorSource = 'builtin'): void {
    const errors = validateManifest(manifest);
    if (errors.length > 0) {
      throw new Error(
        `invalid connector "${manifest.id}":\n  - ${errors.join('\n  - ')}`,
      );
    }

    const existing = this.connectors.get(manifest.id);
    if (existing && PRIORITY[existing.source] <= PRIORITY[source]) {
      // Keep the higher-priority registration.
      return;
    }

    this.connectors.set(manifest.id, { manifest, source });
  }

  unregister(id: string): void {
    this.connectors.delete(id);
  }

  get(id: string): RegisteredConnector | undefined {
    return this.connectors.get(id);
  }

  list(): RegisteredConnector[] {
    return [...this.connectors.values()];
  }

  /** Flatten every registered tool, optionally filtered. */
  listTools(opts: ListToolsOptions = {}): ToolSchema[] {
    const out: ToolSchema[] = [];

    for (const { manifest } of this.connectors.values()) {
      if (opts.connectorIds && !opts.connectorIds.includes(manifest.id)) continue;
      for (const tool of manifest.tools) {
        if (opts.capability && tool.capability !== opts.capability) continue;
        out.push(tool);
      }
    }

    return out;
  }

  /**
   * Find a single tool by id across all connectors.
   * Tool ids are globally unique because they are namespaced by connector id.
   */
  findTool(toolId: string): { tool: ToolSchema; connectorId: string } | undefined {
    for (const { manifest } of this.connectors.values()) {
      const tool = manifest.tools.find((t) => t.id === toolId);
      if (tool) return { tool, connectorId: manifest.id };
    }
    return undefined;
  }
}
