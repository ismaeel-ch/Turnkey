import { REC } from './registry';
import { CARDS } from './catalog';
import type { AccessRule, Dict } from '@/shared/types/workspace';

/* ===== Turnkey · four saved builds that are more than lists and forms =====
   Each one works numbers out, enforces rules and holds moves back until a condition is met (src/shared/logic):
   - orders     purchase orders with lines, department budgets, and approval by amount
   - vet        a vet practice: no vet is booked twice, visits are billed from what was done, payments leave a balance
   - projects   projects with tasks, logged hours against a budget, progress and health worked out, people booked
   - dispatch   field service: jobs scheduled without clashes, parts and labour totalled, work done before a job closes
   All people, companies, pets and amounts are made up. */

type Perm = Omit<AccessRule, 'table' | 'role'>;
const ALL: Perm = { list: 'all', create: true, update: 'all', delete: true };
const EDIT: Perm = { list: 'all', create: true, update: 'all', delete: false };
const LOOK: Perm = { list: 'all', create: false, update: 'none', delete: false };
const MINE: Perm = { list: 'own', create: true, update: 'own', delete: false };
const NONE: Perm = { list: 'none', create: false, update: 'none', delete: false };
const rules = (table: string, by: Dict<Perm>): AccessRule[] => Object.entries(by).map(([role, p]) => ({ table, role, ...p }));
const noQuestion = { question: null };

/* ---------- purchase orders with budgets ---------- */

// [title, department, supplier, requested by, needed in days, reason, stage, approved by]
const ORDERS: [string, number, number, number, number, string, string, number | null][] = [
  ['Laptops for the new starters', 1, 1, 1, 12, 'Three engineers join next month.', 'received', 4],
  ['Standing desks, second floor', 2, 2, 2, 20, 'Replacing the desks that failed the safety check.', 'ordered', 3],
  ['Conference booth and banners', 3, 4, 2, 30, 'For the spring trade fair.', 'approved', 4],
  ['Printer toner and paper', 2, 3, 1, 5, 'Quarterly restock.', 'submitted', null],
  ['Test phones for the mobile team', 1, 1, 1, 15, 'Two current models for release testing.', 'submitted', null],
  ['Whiteboards for the workshop room', 2, 2, 2, 25, 'The room has none.', 'draft', null],
  ['Video licences, one year', 3, 4, 1, 8, 'The current licences end this month.', 'rejected', null],
];
// [item, order, quantity, unit price]
const ORDER_LINES: [string, number, number, number][] = [
  ['Laptop, 14 inch', 1, 3, 1450],
  ['Docking station', 1, 3, 180],
  ['Standing desk, electric', 2, 6, 520],
  ['Cable tray', 2, 6, 35],
  ['Exhibition booth hire', 3, 1, 3900],
  ['Roll-up banner', 3, 4, 140],
  ['Toner cartridge, black', 4, 8, 64],
  ['Paper, A4, box of 5', 4, 10, 28],
  ['Phone, current flagship', 5, 2, 990],
  ['Phone, mid-range', 5, 2, 420],
  ['Whiteboard, 180 cm', 6, 2, 210],
  ['Marker set', 6, 4, 12],
  ['Video licence, per seat', 7, 40, 190],
];

REC.orders = {
  ...CARDS.orders,
  usage: {
    research: [1320, 720, 6400],
    database: [2890, 3050, 14800],
    backend: [3620, 1180, 8900],
    views: [2810, 1320, 8800],
    ui: [4300, 1540, 10600],
  },
  say: {
    research: [
      'Reading the request. An order is made of lines, and every order counts against a department budget.',
      'Four kinds of people. The totals are worked out by the app, and who may approve depends on the amount.',
    ],
    database: [
      'Creating the lists. Line totals, order totals and what is left of each budget are calculated fields, so nobody types them.',
    ],
    backend: [
      'Writing the rules: an order needs a line before it can be submitted, it must fit the budget, and orders over 5,000 go to the director.',
    ],
    views: [
      'Orders have a stage, an amount and a date, so a board, a calendar and charts that total the amount fit.',
      'The dashboard shows what is committed against the budgets and what is waiting.',
    ],
    ui: [
      'Laying out the pages: an order form, the approvals board, the order queue for the buyer, budgets and suppliers. Marigold, side navigation.',
    ],
  },
  research: () => ({
    name: 'Order Desk',
    summary: 'Purchase orders with line items, checked against department budgets and approved by amount.',
    reflect: 'An app for purchase orders: what is being bought, what it adds up to, whether the budget covers it, and who signs it off.',
    planned: true,
    settings: ['departments', 'suppliers'],
    roles: [
      { id: 'requester', name: 'Requester', can: 'Raises purchase orders and adds their lines' },
      { id: 'manager', name: 'Department manager', can: 'Approves orders up to 5,000' },
      { id: 'director', name: 'Director', can: 'Approves orders over 5,000 and watches the budgets' },
      { id: 'buyer', name: 'Buyer', can: 'Places approved orders with suppliers and records delivery' },
    ],
    entities: [
      { name: 'purchase_orders', what: 'What a department wants to buy, with a total worked out from its lines' },
      { name: 'order_lines', what: 'One item on an order: how many and at what price' },
      { name: 'departments', what: 'Each department with its yearly budget and what is left of it' },
      { name: 'suppliers', what: 'Who the company buys from' },
    ],
    process: {
      entity: 'purchase_orders',
      states: ['draft', 'submitted', 'approved', 'ordered', 'received', 'rejected'],
      note: 'The requester submits. The manager approves up to 5,000, the director above that. The buyer places the order and records delivery.',
    },
    stories: [
      { role: 'requester', want: 'add the items I need and see the total add up', so: 'I know what I am asking for' },
      { role: 'manager', want: 'approve orders that fit my budget', so: 'my team gets what it needs without overspending' },
      { role: 'director', want: 'sign off the large orders myself', so: 'nothing big is bought without me' },
      { role: 'buyer', want: 'see every approved order with its supplier', so: 'I can place it at once' },
      { role: 'director', want: 'see what each department has left to spend', so: 'I can step in before a budget runs out' },
    ],
    rules: [
      'An order needs at least one line before it can be submitted.',
      'An order cannot be submitted for more than what is left of its department budget.',
      'Orders up to 5,000 are approved by the department manager, larger ones by the director.',
      'Once approved, an order can no longer be changed.',
      'Requesters see only their own orders.',
    ],
    ...noQuestion,
    notInThisVersion: [
      { ask: 'An email to the supplier when the order is placed', instead: 'The buyer sees the order in their queue and places it' },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'purchase_orders',
        label: 'Purchase orders',
        one: 'Purchase order',
        title: 'title',
        owner: 'requested_by',
        columns: [
          { name: 'title', label: 'What is needed', type: 'text', required: true },
          { name: 'department', label: 'Department', type: 'ref', ref: 'departments', required: true },
          { name: 'supplier', label: 'Supplier', type: 'ref', ref: 'suppliers' },
          { name: 'requested_by', label: 'Requested by', type: 'user', role: 'requester' },
          { name: 'needed_by', label: 'Needed by', type: 'date' },
          { name: 'reason', label: 'Reason', type: 'longtext' },
          { name: 'line_count', label: 'Lines', type: 'number', formula: 'count(order_lines)' },
          { name: 'total', label: 'Total', type: 'money', formula: 'sum(order_lines.line_total)' },
          { name: 'approved_by', label: 'Approved by', type: 'user' },
          {
            name: 'status',
            label: 'Stage',
            type: 'select',
            required: true,
            options: ['draft', 'submitted', 'approved', 'ordered', 'received', 'rejected'],
          },
        ],
        rows: ORDERS.map(([title, department, supplier, requested_by, needed_by, reason, status, approved_by]) => ({
          title,
          department,
          supplier,
          requested_by,
          needed_by,
          reason,
          status,
          approved_by,
        })),
      },
      {
        name: 'order_lines',
        label: 'Order lines',
        one: 'Order line',
        title: 'item',
        owner: null,
        columns: [
          { name: 'item', label: 'Item', type: 'text', required: true },
          { name: 'purchase_order', label: 'Purchase order', type: 'ref', ref: 'purchase_orders', required: true },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
          { name: 'unit_price', label: 'Unit price', type: 'money', required: true },
          { name: 'line_total', label: 'Line total', type: 'money', formula: 'quantity * unit_price' },
        ],
        rows: ORDER_LINES.map(([item, purchase_order, quantity, unit_price]) => ({ item, purchase_order, quantity, unit_price })),
      },
      {
        name: 'departments',
        label: 'Departments',
        one: 'Department',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'manager', label: 'Manager', type: 'user', role: 'manager' },
          { name: 'yearly_budget', label: 'Yearly budget', type: 'money', required: true },
          {
            name: 'committed',
            label: 'Committed',
            type: 'money',
            formula: "sum(purchase_orders.total, status = 'approved' or status = 'ordered' or status = 'received')",
          },
          { name: 'remaining', label: 'Left to spend', type: 'money', formula: 'yearly_budget - committed' },
          {
            name: 'budget_state',
            label: 'Budget',
            type: 'select',
            options: ['on_track', 'nearly_spent', 'over_budget'],
            formula: "if(remaining < 0, 'over_budget', if(committed >= yearly_budget * 0.8, 'nearly_spent', 'on_track'))",
          },
        ],
        rows: [
          { name: 'Engineering', manager: 3, yearly_budget: 60000 },
          { name: 'Operations', manager: 3, yearly_budget: 9000 },
          { name: 'Marketing', manager: 3, yearly_budget: 5200 },
        ],
      },
      {
        name: 'suppliers',
        label: 'Suppliers',
        one: 'Supplier',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'contact', label: 'Contact', type: 'text' },
          { name: 'email', label: 'Email', type: 'text' },
          { name: 'delivery_days', label: 'Usual delivery (days)', type: 'number' },
          { name: 'open_orders', label: 'Orders on the way', type: 'number', formula: "count(purchase_orders, status = 'ordered')" },
        ],
        rows: [
          { name: 'Northwind Devices', contact: 'Irfan Malik', email: 'orders@northwind.example', delivery_days: 7 },
          { name: 'Fabrikam Furniture', contact: 'Sana Riaz', email: 'sales@fabrikam.example', delivery_days: 14 },
          { name: 'Contoso Office Supply', contact: 'Hamza Tariq', email: 'desk@contoso.example', delivery_days: 3 },
          { name: 'Adatum Events', contact: 'Mehwish Khan', email: 'hello@adatum.example', delivery_days: 10 },
        ],
      },
    ],
    users: [
      { name: 'Ayesha Noor', role: 'requester' },
      { name: 'Bilal Ahmed', role: 'requester' },
      { name: 'Omar Farooq', role: 'manager' },
      { name: 'Nadia Hussain', role: 'director' },
      { name: 'Saad Qureshi', role: 'buyer' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'purchase_orders',
      column: 'status',
      initial: 'draft',
      locked: ['approved', 'ordered', 'received'],
      states: [
        { id: 'draft', label: 'Draft', tone: 'neutral' },
        { id: 'submitted', label: 'Submitted', tone: 'info' },
        { id: 'approved', label: 'Approved', tone: 'success' },
        { id: 'ordered', label: 'Ordered', tone: 'warning' },
        { id: 'received', label: 'Received', tone: 'success' },
        { id: 'rejected', label: 'Rejected', tone: 'danger' },
      ],
      transitions: [
        {
          id: 'submit',
          label: 'Submit',
          from: ['draft'],
          to: 'submitted',
          roles: ['requester'],
          when: 'line_count > 0 and total <= department.remaining',
          unless: 'Add at least one line, and keep the total within what is left of the department budget.',
        },
        {
          id: 'approve',
          label: 'Approve',
          from: ['submitted'],
          to: 'approved',
          roles: ['manager'],
          when: 'total <= 5000',
          unless: 'Orders over 5,000 need the director.',
          set: { approved_by: ':me' },
        },
        {
          id: 'approve_large_order',
          label: 'Approve large order',
          from: ['submitted'],
          to: 'approved',
          roles: ['director'],
          when: 'total > 5000',
          unless: 'Orders up to 5,000 are approved by the department manager.',
          set: { approved_by: ':me' },
        },
        { id: 'reject', label: 'Reject', from: ['submitted'], to: 'rejected', roles: ['manager', 'director'] },
        { id: 'revise', label: 'Revise', from: ['rejected'], to: 'draft', roles: ['requester'] },
        { id: 'place_order', label: 'Place order', from: ['approved'], to: 'ordered', roles: ['buyer'], needs: ['supplier'] },
        { id: 'mark_received', label: 'Mark received', from: ['ordered'], to: 'received', roles: ['buyer'] },
      ],
    },
    logic: {
      rules: [
        { id: 'line_quantity', table: 'order_lines', when: 'quantity > 0', message: 'The quantity must be more than zero.' },
        { id: 'line_price', table: 'order_lines', when: 'unit_price >= 0', message: 'The unit price cannot be negative.' },
        {
          id: 'lines_while_draft',
          table: 'order_lines',
          when: "purchase_order.status = 'draft'",
          message: 'Lines can only be added or changed while the order is a draft.',
        },
        { id: 'budget_positive', table: 'departments', when: 'yearly_budget >= 0', message: 'A budget cannot be negative.' },
      ],
    },
    access: [
      ...rules('purchase_orders', { requester: MINE, manager: LOOK, director: LOOK, buyer: { ...LOOK, update: 'all' } }),
      ...rules('order_lines', { requester: ALL, manager: LOOK, director: LOOK, buyer: LOOK }),
      ...rules('departments', { requester: LOOK, manager: LOOK, director: EDIT, buyer: LOOK }),
      ...rules('suppliers', { requester: LOOK, manager: LOOK, director: LOOK, buyer: ALL }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'purchase_orders',
        use: [
          { type: 'board', by: 'status', why: 'A column per stage, so everyone sees what waits for them.' },
          { type: 'table', why: 'For sorting and filtering, with the totals added up.' },
          { type: 'calendar', date: 'needed_by', why: 'When each order is needed.' },
          { type: 'chart', x: 'department', split: 'status', measure: 'sum:total', why: 'What each department is buying, by stage.' },
          { type: 'pivot', rows: 'department', cols: 'supplier', measure: 'sum:total', why: 'Which department buys from which supplier.' },
        ],
      },
      {
        table: 'order_lines',
        use: [
          { type: 'table', why: 'Every line with its total.' },
          { type: 'tree', levels: ['purchase_order'], why: 'Lines nested under their order.' },
        ],
      },
      {
        table: 'departments',
        use: [
          { type: 'table', why: 'Each budget beside what is committed and what is left.' },
          { type: 'board', by: 'budget_state', why: 'Departments grouped by how their budget is doing.' },
          { type: 'cards', why: 'One card per department.' },
        ],
      },
      {
        table: 'suppliers',
        use: [
          { type: 'table', why: 'The supplier list with how many orders are on the way.' },
          { type: 'cards', why: 'One card per supplier.' },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: { table: 'purchase_orders', column: 'needed_by' },
      widgets: [
        { kind: 'kpi', label: 'Waiting for approval', table: 'purchase_orders', where: { status: 'submitted' } },
        { kind: 'kpi', label: 'Value waiting', table: 'purchase_orders', measure: 'sum:total', where: { status: 'submitted' } },
        { kind: 'kpi', label: 'Committed this year', table: 'departments', measure: 'sum:committed' },
        { kind: 'kpi', label: 'Left to spend', table: 'departments', measure: 'sum:remaining' },
        { kind: 'bar', label: 'Left to spend by department', table: 'departments', x: 'name', measure: 'sum:remaining' },
        {
          kind: 'stack',
          label: 'Order value by department and stage',
          table: 'purchase_orders',
          x: 'department',
          split: 'status',
          measure: 'sum:total',
        },
        { kind: 'bar', label: 'Order value by supplier', table: 'purchase_orders', x: 'supplier', measure: 'sum:total' },
        { kind: 'recent', label: 'Latest orders', table: 'purchase_orders' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'marigold', nav: 'side', icon: 'cart', density: 'comfortable' },
    screens: [
      { name: 'Overview', type: 'dashboard', table: 'purchase_orders', roles: ['requester', 'manager', 'director', 'buyer'], icon: 'pie' },
      { name: 'New order', type: 'form', table: 'purchase_orders', roles: ['requester'], icon: 'add' },
      {
        name: 'My orders',
        type: 'table',
        table: 'purchase_orders',
        roles: ['requester'],
        columns: ['title', 'department', 'total', 'needed_by', 'status'],
        icon: 'list',
      },
      {
        name: 'Approvals',
        type: 'board',
        table: 'purchase_orders',
        roles: ['manager', 'director'],
        group: 'status',
        label: 'title',
        columns: ['department', 'total', 'requested_by'],
        icon: 'board',
      },
      {
        name: 'Order queue',
        type: 'table',
        table: 'purchase_orders',
        roles: ['buyer'],
        columns: ['title', 'supplier', 'total', 'needed_by', 'status'],
        icon: 'cart',
      },
      {
        name: 'Budgets',
        type: 'table',
        table: 'departments',
        roles: ['manager', 'director', 'buyer', 'requester'],
        columns: ['name', 'yearly_budget', 'committed', 'remaining', 'budget_state'],
        icon: 'money',
      },
      {
        name: 'Suppliers',
        type: 'table',
        table: 'suppliers',
        roles: ['buyer', 'director'],
        columns: ['name', 'contact', 'delivery_days', 'open_orders'],
        icon: 'building',
      },
    ],
    tour: [
      {
        role: 'requester',
        do: 'create',
        table: 'purchase_orders',
        values: {
          title: 'Monitors for the design team',
          department: 1,
          supplier: 1,
          needed_by: 14,
          reason: 'Four designers share two screens.',
        },
        say: 'Ayesha starts an order for monitors. It is a draft with no lines yet.',
      },
      {
        role: 'requester',
        do: 'create',
        table: 'order_lines',
        values: { item: 'Monitor, 27 inch', quantity: 4, unit_price: 380 },
        say: 'She adds four monitors at 380 each. The app works out the line total and the order total: 1,520.',
      },
      {
        role: 'requester',
        do: 'transition',
        table: 'purchase_orders',
        transition: 'submit',
        say: 'With a line on it and room in the budget, she can submit it.',
      },
      {
        role: 'manager',
        do: 'see',
        table: 'purchase_orders',
        screen: 'Approvals',
        say: 'Omar, the department manager, finds it waiting for him.',
      },
      {
        role: 'manager',
        do: 'transition',
        table: 'purchase_orders',
        transition: 'approve',
        say: 'It is under 5,000, so Omar may approve it himself.',
      },
      {
        role: 'requester',
        do: 'denied',
        table: 'departments',
        action: 'create',
        say: 'Ayesha tries to add a department. Only the director sets budgets.',
      },
      {
        role: 'buyer',
        do: 'transition',
        table: 'purchase_orders',
        transition: 'place_order',
        say: 'Saad, the buyer, places the order with the supplier.',
      },
      { role: 'director', do: 'open', screen: 'Budgets', say: 'Nadia opens the budgets: Engineering now shows 1,520 more committed.' },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'An order with no lines cannot be submitted',
        why: 'An order needs at least one line before it can be submitted.',
        steps: [
          { role: 'requester', do: 'create', table: 'purchase_orders', values: { title: 'Empty order', department: 1 } },
          { role: 'requester', do: 'denied', table: 'purchase_orders', action: 'submit' },
        ],
      },
      {
        name: 'A line must have a quantity above zero',
        why: 'The quantity must be more than zero.',
        steps: [
          { role: 'requester', do: 'create', table: 'purchase_orders', values: { title: 'Chairs', department: 1 } },
          { role: 'requester', do: 'invalid', table: 'order_lines', values: { item: 'Chair', quantity: 0, unit_price: 120 } },
        ],
      },
      {
        name: 'An order over 5,000 needs the director',
        why: 'Orders up to 5,000 are approved by the department manager, larger ones by the director.',
        steps: [
          { role: 'requester', do: 'create', table: 'purchase_orders', values: { title: 'Server rack', department: 1, supplier: 1 } },
          { role: 'requester', do: 'create', table: 'order_lines', values: { item: 'Rack server', quantity: 2, unit_price: 4200 } },
          { role: 'requester', do: 'transition', table: 'purchase_orders', transition: 'submit' },
          { role: 'manager', do: 'denied', table: 'purchase_orders', action: 'approve' },
          { role: 'director', do: 'transition', table: 'purchase_orders', transition: 'approve_large_order' },
        ],
      },
      {
        name: 'An order cannot go over the department budget',
        why: 'An order cannot be submitted for more than what is left of its department budget.',
        steps: [
          { role: 'requester', do: 'create', table: 'purchase_orders', values: { title: 'Trade fair stand', department: 3 } },
          { role: 'requester', do: 'create', table: 'order_lines', values: { item: 'Stand, custom built', quantity: 1, unit_price: 4000 } },
          { role: 'requester', do: 'denied', table: 'purchase_orders', action: 'submit' },
        ],
      },
      {
        name: 'An approved order is locked',
        why: 'Once approved, an order can no longer be changed.',
        steps: [
          { role: 'requester', do: 'create', table: 'purchase_orders', values: { title: 'Desk lamps', department: 1, supplier: 3 } },
          { role: 'requester', do: 'create', table: 'order_lines', values: { item: 'Desk lamp', quantity: 5, unit_price: 40 } },
          { role: 'requester', do: 'transition', table: 'purchase_orders', transition: 'submit' },
          { role: 'manager', do: 'transition', table: 'purchase_orders', transition: 'approve' },
          { role: 'requester', do: 'invalid', table: 'order_lines', values: { item: 'One more lamp', quantity: 1, unit_price: 40 } },
        ],
      },
    ],
  }),
};

/* ---------- a vet practice: bookings without clashes, visits billed from what was done ---------- */

// [reason, pet, client, vet, starts, ends, stage, notes]
const VISITS: [string, number, number, number, string, string, string, string][] = [
  ['Yearly check and vaccination', 1, 1, 3, '-6 09:00', '-6 09:30', 'closed', 'Healthy. Booster given.'],
  ['Limping on the left hind leg', 2, 1, 4, '-4 10:00', '-4 10:45', 'closed', 'Sprain. Rest for ten days.'],
  ['Dental cleaning', 3, 2, 3, '-3 14:00', '-3 15:00', 'treated', 'Two teeth cleaned under light sedation.'],
  ['Skin rash', 4, 3, 4, '-1 11:00', '-1 11:30', 'treated', 'Allergy suspected. Cream prescribed.'],
  ['Follow-up on the sprain', 2, 1, 4, '0 09:30', '0 10:00', 'checked_in', ''],
  ['First visit, new kitten', 5, 4, 3, '0 10:00', '0 10:30', 'booked', ''],
  ['Vaccination', 6, 5, 3, '1 09:00', '1 09:20', 'booked', ''],
  ['Not eating well', 7, 5, 4, '1 15:00', '1 15:30', 'booked', ''],
  ['Nail trim', 4, 3, 3, '-2 16:00', '-2 16:15', 'cancelled', 'Owner called to cancel.'],
];
// [what was done, visit, quantity, unit price]
const TREATMENTS: [string, number, number, number][] = [
  ['Consultation', 1, 1, 35],
  ['Booster vaccine', 1, 1, 28],
  ['Consultation', 2, 1, 35],
  ['X-ray', 2, 2, 60],
  ['Dental cleaning', 3, 1, 140],
  ['Sedation', 3, 1, 45],
  ['Consultation', 4, 1, 35],
  ['Skin cream, 30 g', 4, 2, 14],
];
// [reference, visit, amount, method, paid on]
const VET_PAYMENTS: [string, number, number, string, number][] = [
  ['R-2041', 1, 63, 'card', -6],
  ['R-2042', 2, 100, 'card', -4],
  ['R-2043', 2, 55, 'cash', -2],
  ['R-2044', 3, 100, 'card', -3],
];

REC.vet = {
  ...CARDS.vet,
  usage: {
    research: [1280, 690, 6200],
    database: [2950, 3240, 15400],
    backend: [3540, 1090, 8600],
    views: [2760, 1290, 8700],
    ui: [4210, 1500, 10400],
  },
  say: {
    research: [
      'Reading the request. Visits are booked for a vet at a time, billed from what was done, and paid in parts.',
      'Three kinds of people. The app works out each bill and what is still owed, and refuses a booking that clashes.',
    ],
    database: [
      'Creating the lists. The total, the amount paid and the balance of a visit are calculated from its treatments and payments.',
    ],
    backend: [
      'Writing the rules: no vet is booked twice at the same time, a payment cannot be more than what is owed, and a visit closes only when it is paid.',
    ],
    views: [
      'Visits have a time and a vet, so a calendar and a timeline with one lane per vet fit. Amounts are totalled in the charts.',
      'The dashboard shows what is booked today, what was billed and what clients still owe.',
    ],
    ui: [
      "Laying out the pages: the day for the front desk, each vet's own visits, what clients owe, and the payments. Teal, side navigation.",
    ],
  },
  research: () => ({
    name: 'Vet Practice',
    summary: 'Book visits without double-booking a vet, bill each visit from what was done, and track what clients owe.',
    reflect: 'An app for a vet practice: who comes in when and to which vet, what was done, what it costs and what is still owed.',
    planned: true,
    settings: [],
    roles: [
      { id: 'front_desk', name: 'Front desk', can: 'Books visits, checks pets in, takes payments and closes visits' },
      { id: 'vet', name: 'Vet', can: 'Treats pets, records what was done and writes the notes' },
      { id: 'practice_manager', name: 'Practice manager', can: 'Watches bookings, income and what clients owe' },
    ],
    entities: [
      { name: 'visits', what: 'One appointment for one pet with one vet, with its bill worked out' },
      { name: 'treatments', what: 'What was done or given during a visit, with a price' },
      { name: 'payments', what: 'Money a client paid towards a visit' },
      { name: 'pets', what: 'The animals the practice treats' },
      { name: 'clients', what: 'The owners, each with what they still owe' },
    ],
    process: {
      entity: 'visits',
      states: ['booked', 'checked_in', 'treated', 'closed', 'cancelled'],
      note: 'The front desk books and checks in. The vet treats and records what was done. The front desk takes payment and closes the visit.',
    },
    stories: [
      { role: 'front_desk', want: 'book a visit and be stopped if the vet is already busy', so: 'nobody is double-booked' },
      { role: 'vet', want: 'see my own day and add what I did during a visit', so: 'the bill is right without me pricing it up' },
      { role: 'front_desk', want: 'take part of a payment and see what is still owed', so: 'clients can pay in parts' },
      { role: 'practice_manager', want: 'see what was billed and what is outstanding', so: 'I know how the practice is doing' },
    ],
    rules: [
      'A vet cannot have two visits at the same time. A cancelled visit frees its time.',
      'A visit must end after it starts.',
      'A vet finishes a visit only after adding what was done and writing notes.',
      'A payment cannot be more than what is still owed.',
      'A visit is closed only when it is paid in full, and then it can no longer be changed.',
    ],
    ...noQuestion,
    notInThisVersion: [
      { ask: 'Reminders sent to clients before a visit', instead: "The front desk sees tomorrow's visits on the calendar and calls" },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'visits',
        label: 'Visits',
        one: 'Visit',
        title: 'reason',
        owner: 'vet',
        columns: [
          { name: 'reason', label: 'Reason for the visit', type: 'text', required: true },
          { name: 'pet', label: 'Pet', type: 'ref', ref: 'pets', required: true },
          { name: 'client', label: 'Client', type: 'ref', ref: 'clients', required: true },
          { name: 'vet', label: 'Vet', type: 'user', role: 'vet', required: true },
          { name: 'starts_at', label: 'Starts', type: 'datetime', required: true },
          { name: 'ends_at', label: 'Ends', type: 'datetime', required: true },
          { name: 'notes', label: 'Notes', type: 'longtext' },
          { name: 'total', label: 'Bill', type: 'money', formula: 'sum(treatments.line_total)' },
          { name: 'paid', label: 'Paid', type: 'money', formula: 'sum(payments.amount)' },
          { name: 'balance', label: 'Still owed', type: 'money', formula: 'total - paid' },
          {
            name: 'payment_state',
            label: 'Payment',
            type: 'select',
            options: ['nothing_due', 'unpaid', 'part_paid', 'paid'],
            formula: "if(total = 0, 'nothing_due', if(paid >= total, 'paid', if(paid > 0, 'part_paid', 'unpaid')))",
          },
          {
            name: 'status',
            label: 'Stage',
            type: 'select',
            required: true,
            options: ['booked', 'checked_in', 'treated', 'closed', 'cancelled'],
          },
        ],
        rows: VISITS.map(([reason, pet, client, vet, starts_at, ends_at, status, notes]) => ({
          reason,
          pet,
          client,
          vet,
          starts_at,
          ends_at,
          status,
          notes,
        })),
      },
      {
        name: 'treatments',
        label: 'Treatments',
        one: 'Treatment',
        title: 'what',
        owner: null,
        columns: [
          { name: 'what', label: 'What was done', type: 'text', required: true },
          { name: 'visit', label: 'Visit', type: 'ref', ref: 'visits', required: true },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
          { name: 'unit_price', label: 'Price each', type: 'money', required: true },
          { name: 'line_total', label: 'Amount', type: 'money', formula: 'quantity * unit_price' },
        ],
        rows: TREATMENTS.map(([what, visit, quantity, unit_price]) => ({ what, visit, quantity, unit_price })),
      },
      {
        name: 'payments',
        label: 'Payments',
        one: 'Payment',
        title: 'reference',
        owner: null,
        columns: [
          { name: 'reference', label: 'Receipt number', type: 'text', required: true },
          { name: 'visit', label: 'Visit', type: 'ref', ref: 'visits', required: true },
          { name: 'amount', label: 'Amount', type: 'money', required: true },
          { name: 'method', label: 'Paid with', type: 'select', options: ['cash', 'card', 'bank_transfer'] },
          { name: 'paid_on', label: 'Paid on', type: 'date' },
        ],
        rows: VET_PAYMENTS.map(([reference, visit, amount, method, paid_on]) => ({ reference, visit, amount, method, paid_on })),
      },
      {
        name: 'pets',
        label: 'Pets',
        one: 'Pet',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'species', label: 'Species', type: 'select', options: ['dog', 'cat', 'rabbit', 'bird', 'other'] },
          { name: 'client', label: 'Owner', type: 'ref', ref: 'clients', required: true },
          { name: 'born_on', label: 'Born', type: 'date' },
          { name: 'visit_count', label: 'Visits', type: 'number', formula: "count(visits, status != 'cancelled')" },
        ],
        rows: [
          { name: 'Bruno', species: 'dog', client: 1, born_on: -1500 },
          { name: 'Milo', species: 'dog', client: 1, born_on: -900 },
          { name: 'Luna', species: 'cat', client: 2, born_on: -2200 },
          { name: 'Coco', species: 'rabbit', client: 3, born_on: -400 },
          { name: 'Simba', species: 'cat', client: 4, born_on: -70 },
          { name: 'Rocky', species: 'dog', client: 5, born_on: -1100 },
          { name: 'Kiwi', species: 'bird', client: 5, born_on: -600 },
        ],
      },
      {
        name: 'clients',
        label: 'Clients',
        one: 'Client',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'phone', label: 'Phone', type: 'text' },
          { name: 'email', label: 'Email', type: 'text' },
          { name: 'billed', label: 'Billed in total', type: 'money', formula: 'sum(visits.total)' },
          { name: 'owes', label: 'Owes', type: 'money', formula: 'sum(visits.balance)' },
        ],
        rows: [
          { name: 'Hina Siddiqui', phone: '0300 555 0101', email: 'hina@example.com' },
          { name: 'Usman Javed', phone: '0300 555 0102', email: 'usman@example.com' },
          { name: 'Maryam Sheikh', phone: '0300 555 0103', email: 'maryam@example.com' },
          { name: 'Danish Iqbal', phone: '0300 555 0104', email: 'danish@example.com' },
          { name: 'Rabia Anwar', phone: '0300 555 0105', email: 'rabia@example.com' },
        ],
      },
    ],
    users: [
      { name: 'Sara Malik', role: 'front_desk' },
      { name: 'Imran Shah', role: 'front_desk' },
      { name: 'Dr. Farah Aziz', role: 'vet' },
      { name: 'Dr. Kamran Butt', role: 'vet' },
      { name: 'Zainab Rauf', role: 'practice_manager' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'visits',
      column: 'status',
      initial: 'booked',
      locked: ['closed', 'cancelled'],
      states: [
        { id: 'booked', label: 'Booked', tone: 'neutral' },
        { id: 'checked_in', label: 'Checked in', tone: 'info' },
        { id: 'treated', label: 'Treated', tone: 'warning' },
        { id: 'closed', label: 'Closed', tone: 'success' },
        { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
      ],
      transitions: [
        { id: 'check_in', label: 'Check in', from: ['booked'], to: 'checked_in', roles: ['front_desk'] },
        {
          id: 'finish_treatment',
          label: 'Finish treatment',
          from: ['checked_in'],
          to: 'treated',
          roles: ['vet'],
          needs: ['notes'],
          when: 'count(treatments) > 0',
          unless: 'Add what was done during the visit first.',
        },
        {
          id: 'close',
          label: 'Close visit',
          from: ['treated'],
          to: 'closed',
          roles: ['front_desk'],
          when: 'balance <= 0',
          unless: 'The visit still has an unpaid balance.',
        },
        { id: 'cancel', label: 'Cancel', from: ['booked'], to: 'cancelled', roles: ['front_desk'] },
      ],
    },
    logic: {
      rules: [
        { id: 'ends_after_start', table: 'visits', when: 'ends_at > starts_at', message: 'A visit must end after it starts.' },
        {
          id: 'vet_free',
          table: 'visits',
          when: 'overlaps(starts_at, ends_at, vet) = 0',
          message: 'This vet already has a visit at that time.',
        },
        { id: 'not_overpaid', table: 'visits', when: 'balance >= 0', message: 'A payment cannot be more than what is still owed.' },
        { id: 'payment_positive', table: 'payments', when: 'amount > 0', message: 'A payment must be more than zero.' },
        { id: 'treatment_quantity', table: 'treatments', when: 'quantity > 0', message: 'The quantity must be more than zero.' },
      ],
    },
    access: [
      ...rules('visits', { front_desk: EDIT, vet: { list: 'own', create: false, update: 'own', delete: false }, practice_manager: LOOK }),
      ...rules('treatments', { front_desk: LOOK, vet: ALL, practice_manager: LOOK }),
      ...rules('payments', { front_desk: EDIT, vet: NONE, practice_manager: LOOK }),
      ...rules('pets', { front_desk: EDIT, vet: LOOK, practice_manager: LOOK }),
      ...rules('clients', { front_desk: EDIT, vet: LOOK, practice_manager: LOOK }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'visits',
        use: [
          { type: 'calendar', date: 'starts_at', why: 'The day and the week at the front desk.' },
          { type: 'timeline', start: 'starts_at', end: 'ends_at', lane: 'vet', why: 'One lane per vet, so a free slot is easy to spot.' },
          { type: 'board', by: 'status', why: 'Who is booked, who is in, who is waiting to pay.' },
          { type: 'table', why: 'For sorting and filtering, with the bills totalled.' },
          { type: 'chart', x: 'payment_state', measure: 'sum:total', why: 'How much is paid, part paid and unpaid.' },
          { type: 'pivot', rows: 'vet', cols: 'status', why: "Each vet's visits by stage." },
        ],
      },
      {
        table: 'treatments',
        use: [
          { type: 'table', why: 'Everything done, with amounts.' },
          { type: 'chart', x: 'what', measure: 'sum:line_total', why: 'Which treatments bring in the most.' },
        ],
      },
      {
        table: 'payments',
        use: [
          { type: 'table', why: 'A ledger of what was paid.' },
          { type: 'calendar', date: 'paid_on', why: 'When money came in.' },
          { type: 'chart', x: 'method', measure: 'sum:amount', why: 'How clients pay.' },
        ],
      },
      {
        table: 'pets',
        use: [
          { type: 'table', why: 'Every pet with its owner.' },
          { type: 'cards', why: 'One card per pet.' },
          { type: 'tree', levels: ['client'], why: 'Pets nested under their owner.' },
        ],
      },
      {
        table: 'clients',
        use: [
          { type: 'table', why: 'Each client with what they were billed and what they owe.' },
          { type: 'cards', why: 'One card per client.' },
        ],
      },
    ],
    dashboard: {
      title: 'Today',
      date: { table: 'visits', column: 'starts_at' },
      widgets: [
        { kind: 'kpi', label: 'Visits', table: 'visits' },
        { kind: 'kpi', label: 'Billed', table: 'visits', measure: 'sum:total' },
        { kind: 'kpi', label: 'Paid', table: 'visits', measure: 'sum:paid' },
        { kind: 'kpi', label: 'Still owed', table: 'visits', measure: 'sum:balance' },
        { kind: 'bar', label: 'Visits by stage', table: 'visits', x: 'status' },
        { kind: 'stack', label: 'Billed by vet and payment', table: 'visits', x: 'vet', split: 'payment_state', measure: 'sum:total' },
        { kind: 'bar', label: 'What clients owe', table: 'clients', x: 'name', measure: 'sum:owes' },
        { kind: 'line', label: 'Billed each day', table: 'visits', x: 'starts_at', bucket: 'day', measure: 'sum:total' },
        { kind: 'recent', label: 'Latest visits', table: 'visits' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'teal', nav: 'side', icon: 'paw', density: 'comfortable' },
    screens: [
      { name: 'Today', type: 'dashboard', table: 'visits', roles: ['front_desk', 'vet', 'practice_manager'], icon: 'pie' },
      { name: 'Book a visit', type: 'form', table: 'visits', roles: ['front_desk'], icon: 'add' },
      {
        name: 'Calendar',
        type: 'calendar',
        table: 'visits',
        roles: ['front_desk', 'practice_manager'],
        date: 'starts_at',
        label: 'reason',
        icon: 'calendar',
      },
      {
        name: 'Front desk',
        type: 'board',
        table: 'visits',
        roles: ['front_desk'],
        group: 'status',
        label: 'reason',
        columns: ['pet', 'vet', 'starts_at', 'balance'],
        icon: 'board',
      },
      {
        name: 'My visits',
        type: 'table',
        table: 'visits',
        roles: ['vet'],
        columns: ['reason', 'pet', 'starts_at', 'status', 'total'],
        icon: 'stethoscope',
      },
      {
        name: 'All visits',
        type: 'table',
        table: 'visits',
        roles: ['practice_manager'],
        columns: ['reason', 'pet', 'vet', 'starts_at', 'total', 'balance', 'status'],
        icon: 'list',
      },
      {
        name: 'Payments',
        type: 'table',
        table: 'payments',
        roles: ['front_desk', 'practice_manager'],
        columns: ['reference', 'visit', 'amount', 'method', 'paid_on'],
        icon: 'payment',
      },
      {
        name: 'Clients',
        type: 'table',
        table: 'clients',
        roles: ['front_desk', 'practice_manager'],
        columns: ['name', 'phone', 'billed', 'owes'],
        icon: 'people',
      },
      {
        name: 'Pets',
        type: 'cards',
        table: 'pets',
        roles: ['front_desk', 'vet'],
        columns: ['name', 'species', 'client', 'visit_count'],
        icon: 'paw',
      },
    ],
    tour: [
      {
        role: 'front_desk',
        do: 'create',
        table: 'visits',
        values: { reason: 'Ear infection', pet: 3, client: 2, vet: 4, starts_at: '2 11:00', ends_at: '2 11:30' },
        say: 'Sara at the front desk books Luna in with Dr. Kamran. The app checks he is free at that time.',
      },
      { role: 'front_desk', do: 'transition', table: 'visits', transition: 'check_in', say: 'On the day, she checks Luna in.' },
      {
        role: 'vet',
        user: 'kamran',
        do: 'create',
        table: 'treatments',
        values: { what: 'Ear drops', quantity: 1, unit_price: 22 },
        say: 'Dr. Kamran adds what he gave. The bill of the visit is now 22.',
      },
      {
        role: 'front_desk',
        do: 'create',
        table: 'payments',
        values: { reference: 'R-2050', amount: 22, method: 'card', paid_on: 0 },
        say: 'Sara takes the payment. Nothing is owed any more.',
      },
      {
        role: 'vet',
        do: 'denied',
        table: 'payments',
        action: 'create',
        say: 'A vet tries to record a payment. Only the front desk takes money.',
      },
      {
        role: 'practice_manager',
        do: 'open',
        screen: 'Clients',
        say: 'Zainab, the practice manager, sees what each client was billed and still owes.',
      },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'A vet cannot be booked twice at the same time',
        why: 'A vet cannot have two visits at the same time.',
        steps: [
          {
            role: 'front_desk',
            do: 'create',
            table: 'visits',
            values: { reason: 'Check-up', pet: 1, client: 1, vet: 3, starts_at: '5 09:00', ends_at: '5 09:30' },
          },
          {
            role: 'front_desk',
            do: 'invalid',
            table: 'visits',
            values: { reason: 'Clashing visit', pet: 3, client: 2, vet: 3, starts_at: '5 09:15', ends_at: '5 09:45' },
          },
        ],
      },
      {
        name: 'A visit must end after it starts',
        why: 'A visit must end after it starts.',
        steps: [
          {
            role: 'front_desk',
            do: 'invalid',
            table: 'visits',
            values: { reason: 'Backwards', pet: 1, client: 1, vet: 4, starts_at: '6 10:00', ends_at: '6 09:00' },
          },
        ],
      },
      {
        name: 'A payment cannot be more than what is owed',
        why: 'A payment cannot be more than what is still owed.',
        steps: [
          {
            role: 'front_desk',
            do: 'create',
            table: 'visits',
            values: { reason: 'Vaccination', pet: 6, client: 5, vet: 3, starts_at: '7 09:00', ends_at: '7 09:20' },
          },
          { role: 'vet', do: 'create', table: 'treatments', values: { what: 'Vaccine', quantity: 1, unit_price: 30 } },
          { role: 'front_desk', do: 'invalid', table: 'payments', values: { reference: 'R-9001', amount: 80, method: 'cash' } },
          { role: 'front_desk', do: 'create', table: 'payments', values: { reference: 'R-9002', amount: 30, method: 'cash' } },
        ],
      },
      {
        name: 'A vet finishes only after adding what was done',
        why: 'A vet finishes a visit only after adding what was done and writing notes.',
        steps: [
          {
            role: 'front_desk',
            do: 'create',
            table: 'visits',
            values: { reason: 'Cough', pet: 2, client: 1, vet: 3, starts_at: '8 12:00', ends_at: '8 12:30' },
          },
          { role: 'front_desk', do: 'transition', table: 'visits', transition: 'check_in' },
          { role: 'vet', do: 'denied', table: 'visits', action: 'finish_treatment' },
        ],
      },
    ],
  }),
};

/* ---------- projects: hours against a budget, progress and health worked out, people booked ---------- */

// [name, client, manager, starts, ends, budget hours]
const PROJECTS: [string, string, number, number, number, number][] = [
  ['Website relaunch', 'Tailspin Toys', 4, -40, 30, 120],
  ['Warehouse app', 'Wide World Importers', 4, -25, 60, 200],
  ['Brand refresh', 'Lucerne Publishing', 5, -15, 20, 40],
];
// [title, project, assignee, due, estimate, stage, priority]
const TASKS: [string, number, number, number, number, string, string][] = [
  ['Sitemap and page list', 1, 1, -30, 8, 'done', 'normal'],
  ['Home page design', 1, 2, -18, 20, 'done', 'high'],
  ['Build the page templates', 1, 3, -4, 40, 'in_review', 'high'],
  ['Move the old content', 1, 1, 10, 24, 'in_progress', 'normal'],
  ['Launch checklist', 1, 2, 25, 6, 'to_do', 'normal'],
  ['Interview the warehouse staff', 2, 1, -15, 12, 'done', 'normal'],
  ['Scanner screen prototype', 2, 3, 5, 30, 'in_progress', 'high'],
  ['Stock count flow', 2, 3, 20, 36, 'to_do', 'normal'],
  ['Logo options', 3, 2, -6, 16, 'done', 'high'],
  ['Colour and type system', 3, 2, 4, 18, 'in_progress', 'normal'],
  ['Brand guide', 3, 1, 15, 10, 'to_do', 'low'],
];
// [note, task, project, person, day, hours]
const TIME: [string, number, number, number, number, number][] = [
  ['Page list agreed with the client', 1, 1, 1, -32, 7],
  ['First design round', 2, 1, 2, -24, 9],
  ['Second round after feedback', 2, 1, 2, -20, 8],
  ['Templates, header and footer', 3, 1, 3, -12, 8],
  ['Templates, article pages', 3, 1, 3, -11, 8],
  ['Templates, forms', 3, 1, 3, -8, 7.5],
  ['Templates, fixes from review', 3, 1, 3, -5, 6],
  ['Content export', 4, 1, 1, -3, 5],
  ['Content clean-up', 4, 1, 1, -2, 6],
  ['Interviews on site', 6, 2, 1, -18, 8],
  ['Interview write-up', 6, 2, 1, -16, 4],
  ['Scanner prototype', 7, 2, 3, -4, 7],
  ['Scanner prototype, error cases', 7, 2, 3, -1, 6],
  ['Three logo routes', 9, 3, 2, -10, 8],
  ['Logo refinement', 9, 3, 2, -7, 8],
  ['Palette exploration', 10, 3, 2, -3, 8],
  ['Type pairing', 10, 3, 2, -2, 8],
  ['Type scale and samples', 10, 3, 2, -1, 7],
];

REC.projects = {
  ...CARDS.projects,
  usage: {
    research: [1300, 700, 6300],
    database: [2990, 3400, 15900],
    backend: [3480, 1040, 8300],
    views: [2850, 1380, 9000],
    ui: [4260, 1520, 10500],
  },
  say: {
    research: [
      'Reading the request. Projects have tasks, people log hours on tasks, and each project has a budget of hours.',
      'Three kinds of people. Hours logged, hours left, progress and health are worked out, not typed.',
    ],
    database: ['Creating the lists. A project adds up the hours of its time entries and counts its finished tasks.'],
    backend: [
      'Writing the rules: a task needs someone on it before it starts and time logged before review, nobody logs more than 12 hours in one entry, and a person is not booked twice on the same project.',
    ],
    views: [
      'Tasks have a stage, a person and a due date, so a board, a calendar and a timeline per person fit. Bookings sit on a timeline with one lane per person.',
      'The dashboard compares hours logged with the budget and shows which projects are at risk.',
    ],
    ui: [
      'Laying out the pages: my tasks, a task board, a time log, the project list with its health, and who is booked when. Royal blue, side navigation.',
    ],
  },
  research: () => ({
    name: 'Project Planner',
    summary: 'Plan projects and people: tasks, hours logged against a budget, progress and health worked out, and who is booked when.',
    reflect:
      'An app to run client projects: what has to be done, who does it, how many hours it takes against the budget, and who is booked.',
    planned: true,
    settings: [],
    roles: [
      { id: 'team_member', name: 'Team member', can: 'Works on tasks and logs time' },
      { id: 'project_manager', name: 'Project manager', can: 'Plans projects, reviews work and books people' },
      { id: 'director', name: 'Director', can: 'Watches budgets, progress and how busy people are' },
    ],
    entities: [
      { name: 'tasks', what: 'A piece of work on a project, for one person' },
      { name: 'projects', what: 'A client project with a budget of hours, and its progress worked out' },
      { name: 'time_entries', what: 'Hours someone worked on a task on a day' },
      { name: 'bookings', what: 'Who is booked on which project, from when to when' },
    ],
    process: {
      entity: 'tasks',
      states: ['to_do', 'in_progress', 'in_review', 'done'],
      note: 'A team member starts a task and sends it for review once time is logged. The project manager approves it or sends it back.',
    },
    stories: [
      { role: 'team_member', want: 'see my tasks and log my hours on them', so: 'the project knows where the time goes' },
      { role: 'project_manager', want: 'see hours logged against the budget for each project', so: 'I notice before a project runs over' },
      { role: 'project_manager', want: 'book people on projects without booking anyone twice', so: 'the plan is real' },
      { role: 'director', want: 'see which projects are at risk', so: 'I can step in early' },
    ],
    rules: [
      'A task needs someone assigned before it can start, and time logged before it goes to review.',
      'Only a project manager approves a task. A finished task can no longer be changed.',
      'One time entry is more than zero and at most 12 hours.',
      'A booking ends on or after the day it starts, and a person is not booked twice on the same project in the same period.',
      'Team members change only their own tasks and time entries.',
    ],
    ...noQuestion,
    notInThisVersion: [
      {
        ask: 'A warning message when a project goes over budget',
        instead: 'The project is marked "Over budget" and shows on the overview',
      },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'tasks',
        label: 'Tasks',
        one: 'Task',
        title: 'title',
        owner: 'assignee',
        columns: [
          { name: 'title', label: 'Task', type: 'text', required: true },
          { name: 'project', label: 'Project', type: 'ref', ref: 'projects', required: true },
          { name: 'assignee', label: 'Assigned to', type: 'user' },
          { name: 'due_on', label: 'Due', type: 'date' },
          { name: 'priority', label: 'Priority', type: 'select', options: ['low', 'normal', 'high'] },
          { name: 'estimate_hours', label: 'Estimate (hours)', type: 'number' },
          { name: 'logged_hours', label: 'Logged (hours)', type: 'number', formula: 'sum(time_entries.hours)' },
          { name: 'hours_over', label: 'Over estimate (hours)', type: 'number', formula: 'max(0, logged_hours - estimate_hours)' },
          { name: 'status', label: 'Stage', type: 'select', required: true, options: ['to_do', 'in_progress', 'in_review', 'done'] },
        ],
        rows: TASKS.map(([title, project, assignee, due_on, estimate_hours, status, priority]) => ({
          title,
          project,
          assignee,
          due_on,
          estimate_hours,
          status,
          priority,
        })),
      },
      {
        name: 'projects',
        label: 'Projects',
        one: 'Project',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'client', label: 'Client', type: 'text' },
          { name: 'manager', label: 'Project manager', type: 'user', role: 'project_manager' },
          { name: 'starts_on', label: 'Starts', type: 'date' },
          { name: 'ends_on', label: 'Ends', type: 'date' },
          { name: 'budget_hours', label: 'Budget (hours)', type: 'number', required: true },
          { name: 'logged_hours', label: 'Logged (hours)', type: 'number', formula: 'sum(time_entries.hours)' },
          { name: 'hours_left', label: 'Left (hours)', type: 'number', formula: 'budget_hours - logged_hours' },
          {
            name: 'progress',
            label: 'Tasks done (%)',
            type: 'number',
            formula: "round(100 * count(tasks, status = 'done') / count(tasks), 0)",
          },
          {
            name: 'health',
            label: 'Health',
            type: 'select',
            options: ['on_track', 'at_risk', 'over_budget'],
            formula: "if(hours_left < 0, 'over_budget', if(logged_hours >= budget_hours * 0.75 and progress < 75, 'at_risk', 'on_track'))",
          },
        ],
        rows: PROJECTS.map(([name, client, manager, starts_on, ends_on, budget_hours]) => ({
          name,
          client,
          manager,
          starts_on,
          ends_on,
          budget_hours,
        })),
      },
      {
        name: 'time_entries',
        label: 'Time entries',
        one: 'Time entry',
        title: 'note',
        owner: 'person',
        columns: [
          { name: 'note', label: 'What you worked on', type: 'text', required: true },
          { name: 'task', label: 'Task', type: 'ref', ref: 'tasks', required: true },
          { name: 'project', label: 'Project', type: 'ref', ref: 'projects', required: true },
          { name: 'person', label: 'Person', type: 'user' },
          { name: 'worked_on', label: 'Day', type: 'date', required: true },
          { name: 'hours', label: 'Hours', type: 'number', required: true },
        ],
        rows: TIME.map(([note, task, project, person, worked_on, hours]) => ({ note, task, project, person, worked_on, hours })),
      },
      {
        name: 'bookings',
        label: 'Bookings',
        one: 'Booking',
        title: 'role_on_project',
        owner: null,
        columns: [
          { name: 'role_on_project', label: 'Role on the project', type: 'text', required: true },
          { name: 'person', label: 'Person', type: 'user', required: true },
          { name: 'project', label: 'Project', type: 'ref', ref: 'projects', required: true },
          { name: 'starts_on', label: 'From', type: 'date', required: true },
          { name: 'ends_on', label: 'To', type: 'date', required: true },
          { name: 'hours_per_week', label: 'Hours a week', type: 'number' },
          { name: 'weeks', label: 'Weeks', type: 'number', formula: 'round((days(starts_on, ends_on) + 1) / 7, 1)' },
          { name: 'booked_hours', label: 'Hours booked', type: 'number', formula: 'round(weeks * hours_per_week, 0)' },
        ],
        rows: [
          { role_on_project: 'Content lead', person: 1, project: 1, starts_on: -40, ends_on: 30, hours_per_week: 10 },
          { role_on_project: 'Designer', person: 2, project: 1, starts_on: -40, ends_on: -10, hours_per_week: 20 },
          { role_on_project: 'Developer', person: 3, project: 1, starts_on: -20, ends_on: 30, hours_per_week: 24 },
          { role_on_project: 'Researcher', person: 1, project: 2, starts_on: -25, ends_on: 0, hours_per_week: 12 },
          { role_on_project: 'Developer', person: 3, project: 2, starts_on: -10, ends_on: 60, hours_per_week: 12 },
          { role_on_project: 'Designer', person: 2, project: 3, starts_on: -15, ends_on: 20, hours_per_week: 16 },
        ],
      },
    ],
    users: [
      { name: 'Ali Raza', role: 'team_member' },
      { name: 'Mahnoor Khalid', role: 'team_member' },
      { name: 'Hassan Mirza', role: 'team_member' },
      { name: 'Fatima Zaidi', role: 'project_manager' },
      { name: 'Tariq Mahmood', role: 'project_manager' },
      { name: 'Amna Chaudhry', role: 'director' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'tasks',
      column: 'status',
      initial: 'to_do',
      locked: ['done'],
      states: [
        { id: 'to_do', label: 'To do', tone: 'neutral' },
        { id: 'in_progress', label: 'In progress', tone: 'info' },
        { id: 'in_review', label: 'In review', tone: 'warning' },
        { id: 'done', label: 'Done', tone: 'success' },
      ],
      transitions: [
        { id: 'start', label: 'Start', from: ['to_do'], to: 'in_progress', roles: ['team_member', 'project_manager'], needs: ['assignee'] },
        {
          id: 'send_for_review',
          label: 'Send for review',
          from: ['in_progress'],
          to: 'in_review',
          roles: ['team_member', 'project_manager'],
          when: 'logged_hours > 0',
          unless: 'Log your time on the task first.',
        },
        { id: 'approve', label: 'Approve', from: ['in_review'], to: 'done', roles: ['project_manager'] },
        { id: 'send_back', label: 'Send back', from: ['in_review'], to: 'in_progress', roles: ['project_manager'] },
      ],
    },
    logic: {
      rules: [
        {
          id: 'entry_hours',
          table: 'time_entries',
          when: 'hours > 0 and hours <= 12',
          message: 'One time entry is more than zero and at most 12 hours.',
        },
        { id: 'booking_dates', table: 'bookings', when: 'ends_on >= starts_on', message: 'A booking ends on or after the day it starts.' },
        {
          id: 'booking_once',
          table: 'bookings',
          when: 'overlaps(starts_on, ends_on, person, project) = 0',
          message: 'This person is already booked on this project in that period.',
        },
        { id: 'project_dates', table: 'projects', when: 'ends_on >= starts_on', message: 'A project ends on or after the day it starts.' },
        {
          id: 'budget_positive',
          table: 'projects',
          when: 'budget_hours > 0',
          message: 'A project needs a budget of more than zero hours.',
        },
      ],
    },
    access: [
      ...rules('tasks', { team_member: { list: 'all', create: true, update: 'own', delete: false }, project_manager: ALL, director: LOOK }),
      ...rules('projects', { team_member: LOOK, project_manager: EDIT, director: LOOK }),
      ...rules('time_entries', {
        team_member: { list: 'all', create: true, update: 'own', delete: false },
        project_manager: EDIT,
        director: LOOK,
      }),
      ...rules('bookings', { team_member: LOOK, project_manager: ALL, director: LOOK }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'tasks',
        use: [
          { type: 'board', by: 'status', lane: 'project', why: 'A column per stage, a lane per project.' },
          { type: 'table', why: 'For sorting and filtering, with the hours added up.' },
          { type: 'calendar', date: 'due_on', why: 'What is due when.' },
          { type: 'tree', levels: ['project', 'assignee'], why: 'Tasks nested under each project and person.' },
          { type: 'chart', x: 'assignee', split: 'status', why: 'How much each person has on.' },
          { type: 'pivot', rows: 'project', cols: 'status', measure: 'sum:estimate_hours', why: 'Estimated hours by project and stage.' },
        ],
      },
      {
        table: 'projects',
        use: [
          { type: 'table', why: 'Budget, hours logged, hours left and progress side by side.' },
          { type: 'board', by: 'health', why: 'Projects grouped by health, so the ones at risk stand out.' },
          { type: 'timeline', start: 'starts_on', end: 'ends_on', lane: 'manager', why: 'When each project runs.' },
          { type: 'cards', why: 'One card per project.' },
        ],
      },
      {
        table: 'time_entries',
        use: [
          { type: 'table', why: 'The time log, with the hours added up.' },
          { type: 'calendar', date: 'worked_on', why: 'Who worked on what, by day.' },
          { type: 'chart', x: 'person', split: 'project', measure: 'sum:hours', why: 'Hours by person and project.' },
          { type: 'pivot', rows: 'person', cols: 'project', measure: 'sum:hours', why: 'A timesheet: people against projects.' },
        ],
      },
      {
        table: 'bookings',
        use: [
          {
            type: 'timeline',
            start: 'starts_on',
            end: 'ends_on',
            lane: 'person',
            why: 'One lane per person, so gaps and overlaps are easy to see.',
          },
          { type: 'table', why: 'Every booking with its weeks and hours worked out.' },
          { type: 'pivot', rows: 'person', cols: 'project', measure: 'sum:booked_hours', why: 'Hours booked, people against projects.' },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: { table: 'time_entries', column: 'worked_on' },
      widgets: [
        { kind: 'kpi', label: 'Projects at risk or over', table: 'projects', where: { health: 'at_risk' } },
        { kind: 'kpi', label: 'Hours logged', table: 'time_entries', measure: 'sum:hours' },
        { kind: 'kpi', label: 'Hours left in the budgets', table: 'projects', measure: 'sum:hours_left' },
        { kind: 'kpi', label: 'Tasks in review', table: 'tasks', where: { status: 'in_review' } },
        { kind: 'bar', label: 'Hours left by project', table: 'projects', x: 'name', measure: 'sum:hours_left' },
        { kind: 'bar', label: 'Tasks done (%) by project', table: 'projects', x: 'name', measure: 'avg:progress' },
        { kind: 'stack', label: 'Hours by person and project', table: 'time_entries', x: 'person', split: 'project', measure: 'sum:hours' },
        { kind: 'line', label: 'Hours logged each week', table: 'time_entries', x: 'worked_on', bucket: 'week', measure: 'sum:hours' },
        { kind: 'recent', label: 'Latest tasks', table: 'tasks' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'royalBlue', nav: 'side', icon: 'tasks', density: 'comfortable' },
    screens: [
      { name: 'Overview', type: 'dashboard', table: 'tasks', roles: ['team_member', 'project_manager', 'director'], icon: 'pie' },
      {
        name: 'Task board',
        type: 'board',
        table: 'tasks',
        roles: ['team_member', 'project_manager', 'director'],
        group: 'status',
        label: 'title',
        columns: ['project', 'assignee', 'due_on', 'logged_hours'],
        icon: 'board',
      },
      { name: 'Log time', type: 'form', table: 'time_entries', roles: ['team_member', 'project_manager'], icon: 'clock' },
      {
        name: 'Time log',
        type: 'table',
        table: 'time_entries',
        roles: ['team_member', 'project_manager', 'director'],
        columns: ['note', 'task', 'person', 'worked_on', 'hours'],
        icon: 'list',
      },
      {
        name: 'Projects',
        type: 'table',
        table: 'projects',
        roles: ['team_member', 'project_manager', 'director'],
        columns: ['name', 'client', 'budget_hours', 'logged_hours', 'hours_left', 'progress', 'health'],
        icon: 'briefcase',
      },
      {
        name: 'Who is booked',
        type: 'timeline',
        table: 'bookings',
        roles: ['project_manager', 'director', 'team_member'],
        date: 'starts_on',
        end: 'ends_on',
        label: 'role_on_project',
        columns: ['person', 'project', 'hours_per_week', 'booked_hours'],
        icon: 'timeline',
      },
    ],
    tour: [
      {
        role: 'project_manager',
        do: 'create',
        table: 'tasks',
        values: { title: 'Write the launch announcement', project: 1, assignee: 1, due_on: 12, priority: 'normal', estimate_hours: 6 },
        say: 'Fatima, a project manager, adds a task to the website relaunch and gives it to Ali.',
      },
      { role: 'team_member', user: 'ali', do: 'transition', table: 'tasks', transition: 'start', say: 'Ali starts it.' },
      {
        role: 'team_member',
        user: 'ali',
        do: 'create',
        table: 'time_entries',
        values: { note: 'First draft of the announcement', project: 1, worked_on: 0, hours: 3 },
        say: 'He logs three hours. The task and the project add them to their totals.',
      },
      {
        role: 'team_member',
        user: 'ali',
        do: 'transition',
        table: 'tasks',
        transition: 'send_for_review',
        say: 'With time logged, he can send it for review.',
      },
      {
        role: 'team_member',
        do: 'denied',
        table: 'tasks',
        action: 'approve',
        say: 'A team member tries to approve the task. Only a project manager may.',
      },
      {
        role: 'project_manager',
        do: 'transition',
        table: 'tasks',
        transition: 'approve',
        say: 'Fatima approves it. The project now counts one more task as done.',
      },
      {
        role: 'director',
        do: 'open',
        screen: 'Projects',
        say: 'Amna, the director, sees budget, hours left, progress and health for every project.',
      },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'A task needs time logged before review',
        why: 'A task needs someone assigned before it can start, and time logged before it goes to review.',
        steps: [
          { role: 'project_manager', do: 'create', table: 'tasks', values: { title: 'Check the links', project: 1, assignee: 1 } },
          { role: 'team_member', user: 'ali', do: 'transition', table: 'tasks', transition: 'start' },
          { role: 'team_member', user: 'ali', do: 'denied', table: 'tasks', action: 'send_for_review' },
        ],
      },
      {
        name: 'A finished task cannot be started again',
        why: 'Approved work is done: a task that is finished does not go back to the start.',
        steps: [
          { role: 'project_manager', do: 'create', table: 'tasks', values: { title: 'Already under way', project: 2 } },
          { role: 'project_manager', do: 'transition', transition: 'start', say: 'Fatima starts the task.' },
          { role: 'project_manager', do: 'denied', table: 'tasks', action: 'start' },
        ],
      },
      {
        name: 'One time entry is at most 12 hours',
        why: 'One time entry is more than zero and at most 12 hours.',
        steps: [
          {
            role: 'team_member',
            do: 'invalid',
            table: 'time_entries',
            values: { note: 'A very long day', task: 4, project: 1, worked_on: 0, hours: 15 },
          },
        ],
      },
      {
        name: 'A person is not booked twice on one project',
        why: 'A person is not booked twice on the same project in the same period.',
        steps: [
          {
            role: 'project_manager',
            do: 'create',
            table: 'bookings',
            values: { role_on_project: 'Tester', person: 2, project: 2, starts_on: 10, ends_on: 20, hours_per_week: 8 },
          },
          {
            role: 'project_manager',
            do: 'invalid',
            table: 'bookings',
            values: { role_on_project: 'Tester again', person: 2, project: 2, starts_on: 15, ends_on: 25, hours_per_week: 8 },
          },
        ],
      },
    ],
  }),
};

/* ---------- field service: jobs scheduled without clashes, parts and labour totalled ---------- */

// [summary, customer, technician, starts, ends, stage, work done, labour hours]
const JOBS: [string, number, number | null, string | null, string | null, string, string, number | null][] = [
  ['Boiler not heating', 1, 3, '-5 09:00', '-5 11:00', 'closed', 'Replaced the ignition electrode and tested.', 2],
  ['Annual service, two units', 2, 4, '-3 13:00', '-3 15:30', 'closed', 'Both units serviced, filters changed.', 2.5],
  ['Water leak under the sink', 3, 3, '-1 10:00', '-1 11:00', 'completed', 'Replaced the trap and a worn seal.', 1],
  ['Radiator cold at the top', 4, 4, '0 09:00', '0 10:00', 'on_site', '', null],
  ['Thermostat keeps resetting', 1, 3, '0 14:00', '0 15:00', 'scheduled', '', null],
  ['New tap in the kitchen', 5, 4, '1 11:00', '1 12:30', 'scheduled', '', null],
  ['Noisy pump', 2, null, null, null, 'new', '', null],
  ['Quote for a second bathroom', 5, null, null, null, 'new', '', null],
  ['Blocked drain', 3, 3, '-2 16:00', '-2 17:00', 'cancelled', '', null],
];
// [part, job, quantity, unit price]
const PARTS: [string, number, number, number][] = [
  ['Ignition electrode', 1, 1, 38],
  ['Gasket set', 1, 1, 12],
  ['Filter, standard', 2, 2, 18],
  ['Sink trap, 40 mm', 3, 1, 14],
  ['Seal kit', 3, 1, 6],
];

REC.dispatch = {
  ...CARDS.dispatch,
  usage: {
    research: [1290, 680, 6100],
    database: [2840, 2980, 14500],
    backend: [3510, 1060, 8500],
    views: [2790, 1310, 8800],
    ui: [4180, 1490, 10300],
  },
  say: {
    research: [
      'Reading the request. Jobs come in, a dispatcher gives each one a technician and a time, and the technician records the work and the parts.',
      'Three kinds of people. The cost of a job is worked out from its labour and parts, and no technician is sent to two places at once.',
    ],
    database: ['Creating the lists. Parts, labour and the job total are calculated; a customer shows how many jobs are open.'],
    backend: [
      'Writing the rules: a job needs a technician and a time before it is scheduled, work and hours before it is completed, and it is locked once closed.',
    ],
    views: [
      'Jobs have a time and a technician, so a timeline with one lane per technician is the dispatch board. A stage board and a calendar fit too.',
      'The dashboard shows what is unassigned, what is on today, and what was billed.',
    ],
    ui: [
      "Laying out the pages: new jobs to assign, the dispatch board, each technician's own day, customers and parts. Navy, side navigation.",
    ],
  },
  research: () => ({
    name: 'Service Dispatch',
    summary: 'Take service jobs, schedule technicians without clashes, record work and parts, and total what each job costs.',
    reflect: 'An app for a service team in the field: which jobs are open, who goes where and when, what was done and what it cost.',
    planned: true,
    settings: [],
    roles: [
      { id: 'dispatcher', name: 'Dispatcher', can: 'Takes jobs, assigns a technician and a time' },
      { id: 'technician', name: 'Technician', can: 'Does the job, records the work, the hours and the parts used' },
      { id: 'service_manager', name: 'Service manager', can: 'Checks finished jobs, closes them and watches the numbers' },
    ],
    entities: [
      { name: 'jobs', what: 'One service visit to a customer, with its cost worked out' },
      { name: 'parts_used', what: 'A part fitted on a job, with its price' },
      { name: 'customers', what: 'Who the team works for, each with their open jobs counted' },
    ],
    process: {
      entity: 'jobs',
      states: ['new', 'scheduled', 'on_site', 'completed', 'closed', 'cancelled'],
      note: 'The dispatcher schedules. The technician arrives and completes the job. The service manager checks and closes it.',
    },
    stories: [
      {
        role: 'dispatcher',
        want: 'give a job a technician and a time and be stopped if they are already booked',
        so: 'nobody is sent to two places at once',
      },
      { role: 'technician', want: 'see my own jobs for the day and record what I did and used', so: 'the job is costed without paperwork' },
      { role: 'service_manager', want: 'see every completed job with its total before I close it', so: 'what we bill is right' },
      { role: 'service_manager', want: 'see how many jobs are waiting for a technician', so: 'I know when we are short of people' },
    ],
    rules: [
      'A job needs a technician, a start and an end before it can be scheduled.',
      'A technician cannot have two jobs at the same time. A cancelled job frees its time.',
      'A technician completes a job only after writing what was done and the hours worked.',
      'Technicians see only their own jobs.',
      'A closed job can no longer be changed.',
    ],
    ...noQuestion,
    notInThisVersion: [
      {
        ask: 'A map with the route for each technician',
        instead: "Each technician sees their jobs in time order with the customer's address",
      },
    ],
  }),
  database: () => ({
    tables: [
      {
        name: 'jobs',
        label: 'Jobs',
        one: 'Job',
        title: 'summary',
        owner: 'technician',
        columns: [
          { name: 'summary', label: 'What is wrong', type: 'text', required: true },
          { name: 'customer', label: 'Customer', type: 'ref', ref: 'customers', required: true },
          { name: 'technician', label: 'Technician', type: 'user', role: 'technician' },
          { name: 'starts_at', label: 'Starts', type: 'datetime' },
          { name: 'ends_at', label: 'Ends', type: 'datetime' },
          { name: 'work_done', label: 'Work done', type: 'longtext' },
          { name: 'labour_hours', label: 'Hours worked', type: 'number' },
          { name: 'labour_cost', label: 'Labour', type: 'money', formula: 'labour_hours * customer.hourly_rate' },
          { name: 'parts_cost', label: 'Parts', type: 'money', formula: 'sum(parts_used.line_total)' },
          { name: 'total', label: 'Job total', type: 'money', formula: 'labour_cost + parts_cost' },
          {
            name: 'status',
            label: 'Stage',
            type: 'select',
            required: true,
            options: ['new', 'scheduled', 'on_site', 'completed', 'closed', 'cancelled'],
          },
        ],
        rows: JOBS.map(([summary, customer, technician, starts_at, ends_at, status, work_done, labour_hours]) => ({
          summary,
          customer,
          technician,
          starts_at,
          ends_at,
          status,
          work_done,
          labour_hours,
        })),
      },
      {
        name: 'parts_used',
        label: 'Parts used',
        one: 'Part used',
        title: 'part',
        owner: null,
        columns: [
          { name: 'part', label: 'Part', type: 'text', required: true },
          { name: 'job', label: 'Job', type: 'ref', ref: 'jobs', required: true },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
          { name: 'unit_price', label: 'Price each', type: 'money', required: true },
          { name: 'line_total', label: 'Amount', type: 'money', formula: 'quantity * unit_price' },
        ],
        rows: PARTS.map(([part, job, quantity, unit_price]) => ({ part, job, quantity, unit_price })),
      },
      {
        name: 'customers',
        label: 'Customers',
        one: 'Customer',
        title: 'name',
        owner: null,
        columns: [
          { name: 'name', label: 'Name', type: 'text', required: true },
          { name: 'address', label: 'Address', type: 'text' },
          { name: 'phone', label: 'Phone', type: 'text' },
          { name: 'hourly_rate', label: 'Hourly rate', type: 'money', required: true },
          { name: 'open_jobs', label: 'Open jobs', type: 'number', formula: "count(jobs, status != 'closed' and status != 'cancelled')" },
          { name: 'billed', label: 'Billed in total', type: 'money', formula: "sum(jobs.total, status = 'closed')" },
        ],
        rows: [
          { name: 'Alpine Ski House', address: '12 Canal Road', phone: '0300 555 0201', hourly_rate: 65 },
          { name: 'Bellows College', address: '4 University Avenue', phone: '0300 555 0202', hourly_rate: 55 },
          { name: "Margie's Travel", address: '88 Market Street', phone: '0300 555 0203', hourly_rate: 65 },
          { name: 'Relecloud Offices', address: '3 Park Lane', phone: '0300 555 0204', hourly_rate: 70 },
          { name: 'Woodgrove Homes', address: '27 Garden Town', phone: '0300 555 0205', hourly_rate: 60 },
        ],
      },
    ],
    users: [
      { name: 'Shazia Karim', role: 'dispatcher' },
      { name: 'Waqas Latif', role: 'dispatcher' },
      { name: 'Junaid Akhtar', role: 'technician' },
      { name: 'Rashid Mehmood', role: 'technician' },
      { name: 'Sobia Nawaz', role: 'service_manager' },
    ],
  }),
  backend: () => ({
    status: {
      table: 'jobs',
      column: 'status',
      initial: 'new',
      locked: ['closed', 'cancelled'],
      states: [
        { id: 'new', label: 'New', tone: 'neutral' },
        { id: 'scheduled', label: 'Scheduled', tone: 'info' },
        { id: 'on_site', label: 'On site', tone: 'warning' },
        { id: 'completed', label: 'Completed', tone: 'info' },
        { id: 'closed', label: 'Closed', tone: 'success' },
        { id: 'cancelled', label: 'Cancelled', tone: 'danger' },
      ],
      transitions: [
        {
          id: 'schedule',
          label: 'Schedule',
          from: ['new'],
          to: 'scheduled',
          roles: ['dispatcher'],
          needs: ['technician', 'starts_at', 'ends_at'],
        },
        { id: 'arrive', label: 'Arrive on site', from: ['scheduled'], to: 'on_site', roles: ['technician'] },
        {
          id: 'complete',
          label: 'Complete',
          from: ['on_site'],
          to: 'completed',
          roles: ['technician'],
          needs: ['work_done', 'labour_hours'],
        },
        {
          id: 'close',
          label: 'Close job',
          from: ['completed'],
          to: 'closed',
          roles: ['service_manager'],
          when: 'total > 0',
          unless: 'The job has no cost yet. Check the hours and parts first.',
        },
        { id: 'cancel', label: 'Cancel', from: ['new', 'scheduled'], to: 'cancelled', roles: ['dispatcher'] },
      ],
    },
    logic: {
      rules: [
        { id: 'ends_after_start', table: 'jobs', when: 'ends_at > starts_at', message: 'A job must end after it starts.' },
        {
          id: 'technician_free',
          table: 'jobs',
          when: 'overlaps(starts_at, ends_at, technician) = 0',
          message: 'This technician already has a job at that time.',
        },
        {
          id: 'hours_sensible',
          table: 'jobs',
          when: 'labour_hours >= 0 and labour_hours <= 16',
          message: 'Hours worked on one job are between 0 and 16.',
        },
        { id: 'part_quantity', table: 'parts_used', when: 'quantity > 0', message: 'The quantity must be more than zero.' },
      ],
    },
    access: [
      ...rules('jobs', {
        dispatcher: EDIT,
        technician: { list: 'own', create: false, update: 'own', delete: false },
        service_manager: { ...LOOK, update: 'all' },
      }),
      ...rules('parts_used', { dispatcher: LOOK, technician: ALL, service_manager: EDIT }),
      ...rules('customers', { dispatcher: EDIT, technician: LOOK, service_manager: EDIT }),
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'jobs',
        use: [
          { type: 'timeline', start: 'starts_at', end: 'ends_at', lane: 'technician', why: 'The dispatch board: one lane per technician.' },
          { type: 'board', by: 'status', why: 'New jobs to assign on the left, finished jobs on the right.' },
          { type: 'calendar', date: 'starts_at', why: 'The week at a glance.' },
          { type: 'table', why: 'For sorting and filtering, with the totals added up.' },
          { type: 'chart', x: 'technician', split: 'status', why: 'How many jobs each technician has, by stage.' },
          { type: 'pivot', rows: 'customer', cols: 'status', measure: 'sum:total', why: 'What each customer was billed, by stage.' },
        ],
      },
      {
        table: 'parts_used',
        use: [
          { type: 'table', why: 'Every part fitted, with amounts.' },
          { type: 'chart', x: 'part', measure: 'sum:line_total', why: 'Which parts cost the most.' },
          { type: 'tree', levels: ['job'], why: 'Parts nested under their job.' },
        ],
      },
      {
        table: 'customers',
        use: [
          { type: 'table', why: 'Each customer with open jobs and what was billed.' },
          { type: 'cards', why: 'One card per customer.' },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: { table: 'jobs', column: 'starts_at' },
      widgets: [
        { kind: 'kpi', label: 'Waiting for a technician', table: 'jobs', where: { status: 'new' } },
        { kind: 'kpi', label: 'Scheduled', table: 'jobs', where: { status: 'scheduled' } },
        { kind: 'kpi', label: 'To check and close', table: 'jobs', where: { status: 'completed' } },
        { kind: 'kpi', label: 'Billed on closed jobs', table: 'jobs', measure: 'sum:total', where: { status: 'closed' } },
        { kind: 'bar', label: 'Jobs by stage', table: 'jobs', x: 'status' },
        { kind: 'stack', label: 'Jobs by technician', table: 'jobs', x: 'technician', split: 'status' },
        { kind: 'bar', label: 'Billed by customer', table: 'customers', x: 'name', measure: 'sum:billed' },
        { kind: 'line', label: 'Job value each day', table: 'jobs', x: 'starts_at', bucket: 'day', measure: 'sum:total' },
        { kind: 'recent', label: 'Latest jobs', table: 'jobs' },
      ],
    },
  }),
  ui: () => ({
    theme: { accent: 'navy', nav: 'side', icon: 'wrench', density: 'comfortable' },
    screens: [
      { name: 'Overview', type: 'dashboard', table: 'jobs', roles: ['dispatcher', 'technician', 'service_manager'], icon: 'pie' },
      { name: 'New job', type: 'form', table: 'jobs', roles: ['dispatcher'], icon: 'add' },
      {
        name: 'Dispatch board',
        type: 'timeline',
        table: 'jobs',
        roles: ['dispatcher', 'service_manager'],
        date: 'starts_at',
        end: 'ends_at',
        label: 'summary',
        columns: ['customer', 'technician', 'status'],
        icon: 'timeline',
      },
      {
        name: 'Jobs by stage',
        type: 'board',
        table: 'jobs',
        roles: ['dispatcher', 'service_manager'],
        group: 'status',
        label: 'summary',
        columns: ['customer', 'technician', 'starts_at', 'total'],
        icon: 'board',
      },
      {
        name: 'My jobs',
        type: 'table',
        table: 'jobs',
        roles: ['technician'],
        columns: ['summary', 'customer', 'starts_at', 'ends_at', 'status'],
        icon: 'wrench',
      },
      {
        name: 'Customers',
        type: 'table',
        table: 'customers',
        roles: ['dispatcher', 'service_manager', 'technician'],
        columns: ['name', 'address', 'phone', 'open_jobs', 'billed'],
        icon: 'people',
      },
      {
        name: 'Parts used',
        type: 'table',
        table: 'parts_used',
        roles: ['service_manager', 'technician'],
        columns: ['part', 'job', 'quantity', 'unit_price', 'line_total'],
        icon: 'box',
      },
    ],
    tour: [
      {
        role: 'dispatcher',
        do: 'create',
        table: 'jobs',
        values: { summary: 'Shower has no hot water', customer: 5, technician: 3, starts_at: '3 09:00', ends_at: '3 10:30' },
        say: 'Shazia, a dispatcher, takes a job and gives it to Junaid for a morning three days from now. The app checks he is free.',
      },
      {
        role: 'dispatcher',
        do: 'transition',
        table: 'jobs',
        transition: 'schedule',
        say: 'With a technician and a time, she can schedule it.',
      },
      {
        role: 'technician',
        user: 'junaid',
        do: 'transition',
        table: 'jobs',
        transition: 'arrive',
        say: 'On the day, Junaid arrives on site.',
      },
      {
        role: 'technician',
        user: 'junaid',
        do: 'create',
        table: 'parts_used',
        values: { part: 'Mixer valve', quantity: 1, unit_price: 46 },
        say: 'He fits a mixer valve and adds it to the job. The parts cost shows 46.',
      },
      {
        role: 'technician',
        do: 'denied',
        table: 'customers',
        action: 'create',
        say: 'A technician tries to add a customer. Only the office does that.',
      },
      {
        role: 'service_manager',
        do: 'open',
        screen: 'Jobs by stage',
        say: 'Sobia, the service manager, sees every job by stage, with its total.',
      },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'A technician cannot be in two places at once',
        why: 'A technician cannot have two jobs at the same time.',
        steps: [
          {
            role: 'dispatcher',
            do: 'create',
            table: 'jobs',
            values: { summary: 'First job', customer: 1, technician: 4, starts_at: '6 09:00', ends_at: '6 11:00' },
          },
          {
            role: 'dispatcher',
            do: 'invalid',
            table: 'jobs',
            values: { summary: 'Clashing job', customer: 2, technician: 4, starts_at: '6 10:00', ends_at: '6 12:00' },
          },
        ],
      },
      {
        name: 'A job needs a technician and a time before it is scheduled',
        why: 'A job needs a technician, a start and an end before it can be scheduled.',
        steps: [
          { role: 'dispatcher', do: 'create', table: 'jobs', values: { summary: 'Unassigned job', customer: 3 } },
          { role: 'dispatcher', do: 'denied', table: 'jobs', action: 'schedule' },
        ],
      },
      {
        name: 'A job is completed only with the work written down',
        why: 'A technician completes a job only after writing what was done and the hours worked.',
        steps: [
          {
            role: 'dispatcher',
            do: 'create',
            table: 'jobs',
            values: { summary: 'Dripping tap', customer: 4, technician: 3, starts_at: '7 14:00', ends_at: '7 15:00' },
          },
          { role: 'dispatcher', do: 'transition', table: 'jobs', transition: 'schedule' },
          { role: 'technician', user: 'junaid', do: 'transition', table: 'jobs', transition: 'arrive' },
          { role: 'technician', user: 'junaid', do: 'denied', table: 'jobs', action: 'complete' },
        ],
      },
      {
        name: 'A part needs a quantity above zero',
        why: 'The quantity must be more than zero.',
        steps: [
          {
            role: 'dispatcher',
            do: 'create',
            table: 'jobs',
            values: { summary: 'Loose handle', customer: 2, technician: 4, starts_at: '9 09:00', ends_at: '9 09:30' },
          },
          {
            role: 'technician',
            user: 'rashid',
            do: 'invalid',
            table: 'parts_used',
            values: { part: 'Handle', quantity: 0, unit_price: 9 },
          },
        ],
      },
    ],
  }),
};
