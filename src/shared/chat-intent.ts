/* What an owner means by a short message in the agents chat, when it is not a change to the app:
   asking for a release, or answering the card that waits for them. Pure, so it is tested on its own. */

export interface ReleaseAsk {
  /** the kind of release the owner named, if any */
  kind: 'fix' | 'feature' | 'major' | null;
  /** they asked to release although nothing may have changed ("release again") */
  again: boolean;
}

const LEAD = String.raw`^(?:(?:ok(?:ay)?|now|please|so|then|great|good)[,!.]?\s+)*(?:(?:can|could|would) you\s+|let'?s\s+|i want to\s+|i'?d like to\s+|go ahead and\s+)?`;
const TAIL = String.raw`\s*(?:,?\s*please)?\s*[.!]*$`;
const OBJECT = String.raw`(?:it|this|that|the app|my app|the draft|the changes?|everything|now|again|today|a new version|the new version|a new release|the next version|a version|version\s*\d+(?:\.\d+){0,2}|v\d+(?:\.\d+){0,2}|it again|as (?:a )?(?:fix|patch|bug ?fix|new feature|feature|minor|major|big change)|(?:a |the )?(?:fix|patch|bug ?fix|new feature|feature|minor|major)(?: release| version)?|without (?:any )?changes|with no changes|to (?:everyone|my people|the team|users))`;
const VERB = String.raw`(?:release|publish|ship|launch|roll out|push out|put out)`;
/** "release", "release it", "please publish a new version", "ship it as a fix", "release again without changes" */
const RELEASE = new RegExp(LEAD + VERB + String.raw`(?:\s+` + OBJECT + String.raw`)*` + TAIL, 'i');
/** "new version", "make a new release", "cut a new version please", "time for a new release" */
const NEW_VERSION = new RegExp(
  LEAD +
    String.raw`(?:(?:make|cut|do|create|start|time for|ready for)\s+)?(?:a |the )?(?:new|next) (?:release|version)(?:\s+(?:of (?:it|the app)|now))?` +
    TAIL,
  'i',
);

/** Whether a message asks for a release, and which kind. Null when it is something else (a change, a question). */
export function releaseIntent(text: string): ReleaseAsk | null {
  const t = String(text || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!t || t.length > 120) return null;
  if (!RELEASE.test(t) && !NEW_VERSION.test(t)) return null;
  const kind = /\b(fix|patch|bug ?fix)\b/i.test(t)
    ? 'fix'
    : /\b(major|big change)\b/i.test(t)
      ? 'major'
      : /\b(feature|minor)\b/i.test(t)
        ? 'feature'
        : null;
  return { kind, again: /\b(again|without (?:any )?changes|with no changes)\b/i.test(t) };
}

/** A short yes or no to the card that waits in the chat. Null when the message says more than that. */
export function replyIntent(text: string): 'yes' | 'no' | null {
  const t = String(text || '')
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, '')
    .replace(/\s+/g, ' ');
  if (!t || t.length > 40) return null;
  if (
    /^(yes|yep|yeah|y|ok|okay|sure|do it|go|go ahead|go for it|approve|approved|confirm|looks good|sounds good|lgtm|it works|works|that works|perfect|great|fine)(,? (please|thanks|thank you))?$/.test(
      t,
    )
  )
    return 'yes';
  if (
    /^(no|nope|n|not now|later|cancel|stop|don'?t|do not|wait|not yet|never mind|nevermind|still wrong|it'?s wrong|wrong)(,? (please|thanks|thank you))?$/.test(
      t,
    )
  )
    return 'no';
  return null;
}
