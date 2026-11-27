/** The registry of public-data connectors (five REST APIs and one MCP server). The route and the team graph both read from here. */
import type { Connector, ConnectorDescription, ConnectorLookup } from './types';
import { arxiv } from './arxiv';
import { msLearn } from './mslearn';
import { openAlex } from './openalex';
import { patentsView } from './patentsview';
import { wikipedia } from './wikipedia';
import { worldBank } from './worldbank';

export const connectors: readonly Connector[] = [wikipedia, worldBank, openAlex, arxiv, patentsView, msLearn];

export const getConnector: ConnectorLookup = (id) => connectors.find((c) => c.id === id);

/** Tool descriptions for the team graph: one per connector. */
export function listConnectorTools(): ConnectorDescription[] {
  return connectors.map((c) => c.describe);
}

export type { Connector, ConnectorDescription, ConnectorLookup } from './types';
