/**
 * The logic of a built app beyond "who may see and change what": calculated fields, rules that refuse a save, and
 * conditions on stage moves. All of it is data in the app's definition, written in the formula language of
 * `./expr.ts`, and enforced by the built app's API (`src/workspace/logic.ts`).
 *
 *   a calculated field   `formula` on a column (`ColumnDef.formula`): worked out and stored on every save
 *   a rule               `AppRule`: a condition a record must keep; a save that breaks it is refused with `message`
 *   a move's condition   `when` on a transition: the move is offered only while it holds; `needs` lists fields
 *                        that must be filled first
 *   locked stages        `locked` on the process: stages in which a record's fields can no longer be changed
 */

/** A condition every record of a list must keep. */
export interface AppRule {
  /** snake_case, unique in the app */
  id: string;
  table: string;
  /** a formula that must not be false for the record to be saved */
  when: string;
  /** what the person is told when a save is refused: one plain sentence */
  message: string;
}

export interface AppLogic {
  rules: AppRule[];
}

/** How many rules an app may have, and how many calculated fields a list may have. */
export const LOGIC_LIMITS = { rules: 12 } as const;
