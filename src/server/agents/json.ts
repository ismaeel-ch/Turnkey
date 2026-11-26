/**
 * Finds the JSON object in a model answer, the way the browser does (`parseJSONLoose` in src/workspace/core.ts):
 * code fences are removed, and the object runs from the first `{` to the last `}`, so prose around it is ignored.
 */
export type Parsed = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

export function parseJSONLoose(text: string): Parsed {
  if (!text || !text.trim()) return { ok: false, reason: 'the answer was empty' };
  const s = String(text).replace(/```(?:json)?/gi, '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b <= a) return { ok: false, reason: 'the answer has no JSON object in it' };
  try {
    const value: unknown = JSON.parse(s.slice(a, b + 1));
    if (value && typeof value === 'object' && !Array.isArray(value)) return { ok: true, value: value as Record<string, unknown> };
    return { ok: false, reason: 'the answer is not a JSON object' };
  } catch (e) {
    return { ok: false, reason: 'the JSON is not valid (' + (e instanceof Error ? e.message : 'parse error') + ')' };
  }
}
