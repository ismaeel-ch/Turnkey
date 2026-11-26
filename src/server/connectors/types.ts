/**
 * The shape every public-data connector shares. The team graph calls these as tools, and the
 * `/api/connectors/[name]` route calls them for the browser's connection test.
 *
 * Nothing in here throws. A connector returns `{ ok: false, code, message }` for every failure.
 */

/** One record an agent can read. `text` is trimmed to a few hundred characters. */
export type ConnectorItem = {
  title: string;
  /** Link to the record on the source's own site. */
  url: string;
  text: string;
  /** Human name of the source, for example "Wikipedia". */
  source: string;
};

export type ConnectorErrorCode =
  | 'bad_request' // the query or options were not usable
  | 'not_found' // the source has no record for the query
  | 'not_configured' // the source needs a key that is not set
  | 'timeout' // the source did not answer within 8 seconds
  | 'upstream' // the source answered with an error or could not be reached
  | 'bad_response'; // the source answered, but not in the shape we validate

export type ConnectorError = { ok: false; code: ConnectorErrorCode; message: string };

export type ConnectorResult = { ok: true; items: ConnectorItem[] } | ConnectorError;

/** Plain JSON Schema object describing the connector's `query` and `options` input. */
export type JsonSchema = Record<string, unknown>;

/** Tool description for the team graph: what the tool is called, what it is for, what it takes. */
export type ConnectorDescription = {
  name: string;
  purpose: string;
  inputSchema: JsonSchema;
};

export type ConnectorOptions = {
  /** Most items to return. Connectors clamp this to their own maximum. */
  limit?: number;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
};

export interface Connector {
  /** Stable id used in URLs and tool names, for example "wikipedia". */
  readonly id: string;
  /** Human name shown to people, for example "Wikipedia". */
  readonly label: string;
  readonly describe: ConnectorDescription;
  search(query: string, options?: ConnectorOptions): Promise<ConnectorResult>;
}

/** Registry lookup: the connector with this id, or undefined. Implemented in `index.ts`. */
export type ConnectorLookup = (id: string) => Connector | undefined;
