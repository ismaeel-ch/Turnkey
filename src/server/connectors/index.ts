/** The registry of public-data connectors. The route and the team graph both read from here. */
import type { Connector, ConnectorDescription, ConnectorLookup } from './types';
import { arxiv } from './arxiv';
import { openAlex } from './openalex';
import { patentsView } from './patentsview';
import { wikipedia } from './wikipedia';
import { worldBank } from './worldbank';

export const connectors: readonly Connector[] = [wikipedia, worldBank, openAlex, arxiv, patentsView];

export const getConnector: ConnectorLookup = (id) => connectors.find((c) => c.id === id);

/** Tool descriptions for the team graph: one per connector. */
export function listConnectorTools(): ConnectorDescription[] {
  return connectors.map((c) => c.describe);
}

export type { Connector, ConnectorDescription, ConnectorItem, ConnectorLookup, ConnectorResult } from './types';
