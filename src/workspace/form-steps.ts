import type { AppTable, ColumnDef } from '@/shared/types/app';

/* ===== A long form, split into short steps =====
   A form with many fields is hard to get through in one go. From seven fields on, the form of a built app becomes a
   few steps and a last one to check everything before it is saved. Which field goes where is decided here, by code,
   from what the fields are: what a record cannot do without comes first, then who and what it belongs to, then dates
   and amounts, then the rest. */

/** From this many fields on, a form is split into steps. */
export const STEPS_FROM = 7;

export interface FormStep {
  id: 'basics' | 'links' | 'numbers' | 'more' | 'review';
  title: string;
  /** one line under the title that says what this step is for */
  hint: string;
  cols: ColumnDef[];
}

const isLink = (c: ColumnDef) => c.type === 'ref' || c.type === 'user';
const isDate = (c: ColumnDef) => c.type === 'date' || c.type === 'datetime';
const isNumber = (c: ColumnDef) => c.type === 'number' || c.type === 'money';

/** The steps of a form over `cols`, with the check step last. Null when the form is short enough to stay one page. */
export function formSteps(t: Pick<AppTable, 'title' | 'one'>, cols: ColumnDef[], isNew = true): FormStep[] | null {
  if (cols.length < STEPS_FROM) return null;
  const one = (t.one || 'record').toLowerCase();
  const basics = cols.filter((c) => c.name === t.title || c.required),
    rest = cols.filter((c) => !basics.includes(c));
  let links = rest.filter(isLink),
    numbers = rest.filter((c) => isDate(c) || isNumber(c)),
    more = rest.filter((c) => !isLink(c) && !isDate(c) && !isNumber(c));
  // a step with a single field is not worth a click: it joins the last step
  if (links.length === 1) {
    more = cols.filter((c) => more.includes(c) || links.includes(c));
    links = [];
  }
  if (numbers.length === 1) {
    more = cols.filter((c) => more.includes(c) || numbers.includes(c));
    numbers = [];
  }
  const dates = numbers.some(isDate),
    amounts = numbers.some(isNumber);
  let steps: FormStep[] = [
    { id: 'basics', title: 'The basics', hint: 'What every ' + one + ' needs.', cols: basics },
    { id: 'links', title: 'Who and what', hint: 'The people and records this ' + one + ' belongs to.', cols: links },
    {
      id: 'numbers',
      title: dates && amounts ? 'Dates and amounts' : dates ? 'Dates' : 'Amounts',
      hint: 'Leave empty what you do not know yet.',
      cols: numbers,
    },
    { id: 'more', title: 'More details', hint: 'Anything else worth keeping. All of it can wait.', cols: more },
  ];
  steps = steps.filter((s) => s.cols.length);
  // one lonely field left over joins the step before it
  const last = steps[steps.length - 1];
  if (steps.length > 1 && last.cols.length === 1) {
    const before = steps[steps.length - 2];
    before.cols = cols.filter((c) => before.cols.includes(c) || last.cols.includes(c));
    steps.pop();
  }
  // everything was required: two halves are still easier than one long page
  if (steps.length === 1) {
    const half = Math.ceil(cols.length / 2);
    steps = [
      { ...steps[0], id: 'basics', title: 'The basics', cols: cols.slice(0, half) },
      { id: 'more', title: 'More details', hint: 'The rest of what this ' + one + ' needs.', cols: cols.slice(half) },
    ];
  }
  return steps.concat({
    id: 'review',
    title: isNew ? 'Check and create' : 'Check and save',
    hint: 'Read it once. Go back to any step to change it.',
    cols: [],
  });
}

/** The required fields of a step that are still empty. */
export const missingIn = (step: FormStep, vals: Record<string, unknown>) =>
  step.cols.filter((c) => c.required && (vals[c.name] == null || vals[c.name] === ''));

/** The first step that holds a field with an error, or -1. */
export const stepWithError = (steps: FormStep[], errs: Record<string, unknown> | undefined) =>
  steps.findIndex((s) => s.cols.some((c) => errs && errs[c.name]));
