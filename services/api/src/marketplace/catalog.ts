/**
 * Connector marketplace - paid SKUs.
 *
 * A SKU grants an entitlement to a connector. The manifest itself is public;
 * what is sold is the right to run it. Purchases produce an
 * offline-verifiable receipt so a paid connector keeps working without a
 * network call.
 */

export interface ConnectorSku {
  sku: string;
  connectorId: string;
  displayName: string;
  /** Price in minor units (cents). 0 = free. */
  priceCents: number;
  currency: string;
  /** Feature flag unlocked by this SKU. */
  feature: string;
}

/** The built-in catalog. TODO: serve from a database with versioning. */
export const CATALOG: ConnectorSku[] = [
  {
    sku: 'connector.github.pro',
    connectorId: 'github',
    displayName: 'GitHub Pro',
    priceCents: 900,
    currency: 'USD',
    feature: 'connector.github.pro',
  },
  {
    sku: 'connector.slack.pro',
    connectorId: 'slack',
    displayName: 'Slack Pro',
    priceCents: 500,
    currency: 'USD',
    feature: 'connector.slack.pro',
  },
];

export function findSku(sku: string): ConnectorSku | undefined {
  return CATALOG.find((s) => s.sku === sku);
}
