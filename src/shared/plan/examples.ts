/**
 * Two worked plans for the same sentence, "I want to build an expense management app", answered two ways. They are
 * the reference for what a plan looks like, they keep the screens that draw a plan honest while the Planner is being
 * built, and the unit tests run every check against them. All names and numbers are made up.
 */
import type { Permission } from '@/shared/types/app';
import type { PlanSpec } from './types';

const everything: Permission = { list: 'all', create: true, update: 'all', delete: true };
const lookOnly: Permission = { list: 'all', create: false, update: 'none', delete: false };
const nothing: Permission = { list: 'none', create: false, update: 'none', delete: false };

/** Answered "Just me": one kind of person, two lists, no stages. */
export const PERSONAL_EXPENSES: PlanSpec = {
  v: 1,
  name: 'My Expenses',
  summary: 'Track what you spend by category and by month, against a budget you set.',
  audience: 'just_me',
  people: [{ id: 'owner', name: 'You', can: 'Add expenses and see where the money goes' }],
  lists: [
    {
      name: 'expenses',
      label: 'Expenses',
      one: 'expense',
      what: 'Everything you spend',
      title: 'what_for',
      owner: null,
      settings: false,
      fields: [
        { name: 'what_for', label: 'What it was for', type: 'text', required: true },
        { name: 'spent_on', label: 'Date', type: 'date', required: true },
        { name: 'amount', label: 'Amount', type: 'money', required: true },
        { name: 'category', label: 'Category', type: 'ref', ref: 'categories' },
        { name: 'paid_with', label: 'Paid with', type: 'select', options: ['cash', 'card', 'bank_transfer'] },
        { name: 'note', label: 'Note', type: 'longtext' },
      ],
    },
    {
      name: 'categories',
      label: 'Categories',
      one: 'category',
      what: 'What you group your spending by, each with a monthly budget',
      title: 'name',
      owner: null,
      settings: true,
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'monthly_budget', label: 'Monthly budget', type: 'money' },
      ],
    },
  ],
  stages: null,
  permissions: { expenses: { owner: everything }, categories: { owner: everything } },
  rules: ['Only you use the app. You add, change and delete expenses freely.'],
  stories: [
    { role: 'owner', want: 'add an expense in a few seconds', so: 'nothing is forgotten' },
    { role: 'owner', want: 'see what I spent this month in each category', so: 'I know where the money goes' },
    { role: 'owner', want: 'see my spending beside the budget I set', so: 'I notice when a category runs over' },
  ],
  demoData: true,
  overview: true,
  helpers: null,
  answers: [
    { slot: 'audience', question: 'Who is this for?', answer: 'Just me', value: 'just_me', by: 'you' },
    { slot: 'budget', question: 'Do you want a monthly budget for each category?', answer: 'Yes', value: 'yes', by: 'you' },
    { slot: 'demo_data', question: 'Would you like demo data to try the app?', answer: 'Yes, add demo data', value: 'yes', by: 'you' },
    { slot: 'currency', question: 'Which currencies?', answer: 'One currency', by: 'assumed' },
  ],
  notInThisVersion: [
    { ask: 'A warning when a category goes over its budget', instead: 'The budget is shown beside what you spent in each category' },
  ],
};

/** Answered "A company or team": three kinds of people, four lists, five stages. */
export const COMPANY_EXPENSES: PlanSpec = {
  v: 1,
  name: 'Expense Desk',
  summary: 'Employees claim expenses, managers approve them, and Finance pays them back.',
  audience: 'company',
  people: [
    { id: 'employee', name: 'Employee', can: 'Adds claims and sees only their own' },
    { id: 'manager', name: 'Manager', can: 'Approves, sends back or rejects claims' },
    { id: 'finance', name: 'Finance', can: 'Pays approved claims, manages categories and teams' },
  ],
  lists: [
    {
      name: 'claims',
      label: 'Claims',
      one: 'claim',
      what: 'An expense someone asks to be paid back',
      title: 'what_for',
      owner: 'employee',
      settings: false,
      fields: [
        { name: 'what_for', label: 'What it was for', type: 'text', required: true },
        { name: 'employee', label: 'Employee', type: 'user', role: 'employee', required: true },
        { name: 'spent_on', label: 'Date', type: 'date', required: true },
        { name: 'amount', label: 'Amount', type: 'money', required: true },
        { name: 'category', label: 'Category', type: 'ref', ref: 'categories' },
        { name: 'team', label: 'Team', type: 'ref', ref: 'teams' },
        { name: 'receipt_link', label: 'Receipt link', type: 'text' },
        { name: 'stage', label: 'Stage', type: 'select', options: ['draft', 'submitted', 'approved', 'paid', 'rejected'] },
        { name: 'sent_back_reason', label: 'Reason if sent back', type: 'longtext' },
        { name: 'approved_by', label: 'Approved by', type: 'user', role: 'manager' },
      ],
    },
    {
      name: 'categories',
      label: 'Categories',
      one: 'category',
      what: 'What a claim is for, with its limit',
      title: 'name',
      owner: null,
      settings: true,
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'limit_per_claim', label: 'Limit per claim', type: 'money' },
        { name: 'receipt_needed', label: 'Receipt needed', type: 'bool' },
      ],
    },
    {
      name: 'teams',
      label: 'Teams',
      one: 'team',
      what: 'The teams people claim for, each with a manager and a budget',
      title: 'name',
      owner: null,
      settings: true,
      fields: [
        { name: 'name', label: 'Name', type: 'text', required: true },
        { name: 'manager', label: 'Manager', type: 'user', role: 'manager' },
        { name: 'monthly_budget', label: 'Monthly budget', type: 'money' },
      ],
    },
    {
      name: 'payments',
      label: 'Payments',
      one: 'payment',
      what: 'A payment Finance made for an approved claim',
      title: 'reference',
      owner: null,
      settings: false,
      fields: [
        { name: 'reference', label: 'Reference', type: 'text', required: true },
        { name: 'claim', label: 'Claim', type: 'ref', ref: 'claims', required: true },
        { name: 'paid_on', label: 'Paid on', type: 'date', required: true },
        { name: 'method', label: 'Method', type: 'select', options: ['bank_transfer', 'cash', 'cheque'] },
      ],
    },
  ],
  stages: {
    list: 'claims',
    field: 'stage',
    stages: [
      { id: 'draft', label: 'Draft' },
      { id: 'submitted', label: 'Submitted' },
      { id: 'approved', label: 'Approved' },
      { id: 'paid', label: 'Paid' },
      { id: 'rejected', label: 'Rejected' },
    ],
    moves: [
      { label: 'Submit', from: ['draft'], to: 'submitted', by: ['employee'] },
      { label: 'Approve', from: ['submitted'], to: 'approved', by: ['manager'] },
      { label: 'Send back', from: ['submitted'], to: 'draft', by: ['manager'] },
      { label: 'Reject', from: ['submitted'], to: 'rejected', by: ['manager'] },
      { label: 'Mark as paid', from: ['approved'], to: 'paid', by: ['finance'] },
    ],
    note: 'The Employee submits. The Manager approves, sends it back to Draft with a reason, or rejects it. Finance marks it as paid.',
  },
  permissions: {
    claims: {
      employee: { list: 'own', create: true, update: 'own', delete: false },
      manager: lookOnly,
      finance: lookOnly,
    },
    categories: { employee: lookOnly, manager: lookOnly, finance: everything },
    teams: { employee: lookOnly, manager: lookOnly, finance: everything },
    payments: { employee: nothing, manager: lookOnly, finance: { list: 'all', create: true, update: 'all', delete: false } },
  },
  rules: [
    'Employees see and change only their own claims.',
    'Managers see every claim and are the only ones who approve. They do not add claims of their own.',
    'Finance sees everything and is the only one who records payments.',
    'Only Finance changes categories and teams.',
  ],
  stories: [
    { role: 'employee', want: 'submit a claim with a link to its receipt', so: 'I am paid back' },
    { role: 'employee', want: 'see where each of my claims is', so: 'I do not have to ask' },
    { role: 'employee', want: 'fix and resend a claim that was sent back', so: 'it can still be approved' },
    { role: 'manager', want: 'approve a claim or send it back with a reason', so: 'only fair claims are paid' },
    { role: 'finance', want: 'pay approved claims and record the payment', so: 'the books are right' },
    { role: 'finance', want: 'see spending by category and by team', so: 'I can watch the budgets' },
  ],
  demoData: true,
  overview: true,
  helpers: null,
  answers: [
    { slot: 'audience', question: 'Who is this for?', answer: 'A company or team', value: 'company', by: 'you' },
    { slot: 'people', question: 'Who does what?', answer: 'Employee, Manager, Finance', by: 'you' },
    {
      slot: 'approval',
      question: 'What happens after someone submits a claim?',
      answer: 'Manager approves, then Finance pays',
      value: 'two',
      by: 'you',
    },
    { slot: 'visibility', question: 'Who can see a claim?', answer: 'Only the person who made it', value: 'own', by: 'you' },
    { slot: 'demo_data', question: 'Would you like demo data to try the app?', answer: 'Yes, add demo data', value: 'yes', by: 'you' },
    { slot: 'currency', question: 'Which currencies?', answer: 'One currency', by: 'assumed' },
    { slot: 'approver', question: 'Who approves which claims?', answer: 'One manager can approve any claim', by: 'assumed' },
  ],
  notInThisVersion: [
    { ask: 'Managers limited to the claims of their own team', instead: 'Managers see every claim' },
    { ask: 'Receipt photos', instead: 'Each claim has a receipt link or note' },
    { ask: 'Locking a claim once it is paid', instead: 'Nobody but its employee can change a claim, at any stage' },
  ],
};
