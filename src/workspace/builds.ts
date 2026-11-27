import { REC } from './registry';
import { CARDS } from './catalog';
import type { AccessRule, Dict, SavedCase } from '@/shared/types/workspace';
import { isoDate, today } from './core';

/* ===== Turnkey prototype · saved builds (Demo mode) and connections =====
   A saved build is the recorded output of each agent. Demo mode feeds it through the same checks,
   the same SQLite engine and the same API as a live build. All people and records are made up. */
export const nextDate = (m: number, d: number) => {
  const t = today();
  let x = new Date(t.getFullYear(), m - 1, d);
  if (x < t) x = new Date(t.getFullYear() + 1, m - 1, d);
  return isoDate(x);
};
REC.clinic = {
  ...CARDS.clinic,
  usage: {
    research: [1320, 610, 6400],
    database: [2410, 2980, 14800],
    database2: [3260, 2890, 13900],
    backend: [3350, 940, 7900],
    views: [2680, 1190, 8200],
    ui: [4120, 1480, 10100],
  },
  lookup: {
    connector: 'wikipedia',
    tool: 'search_pages',
    args: {
      q: 'appointment scheduling triage',
    },
    say: 'I looked up how clinics name the stages of a visit, so the process uses words the front desk already knows.',
    note: 'Names for the stages of a visit',
  },
  say: {
    research: [
      'Reading the request. I am working out who signs in, what they keep records of, and which record moves through a process.',
      'Three roles, three kinds of record, one process on appointments. One decision is yours, so I am asking.',
    ],
    database: ['Turning the brief into tables, with made-up patients and two weeks of appointments around today.'],
    database2: [
      'The check is right. I linked appointments to a rooms table the brief never asked for. Room is now a choice on the appointment.',
    ],
    backend: ['Writing the workflow and who may do what. Doctors get only their own appointments, and visit notes follow your answer.'],
    views: [
      'Looking at the columns of each table to see which views they can carry. Appointments have a status, a doctor and a start time, so they support a board, a calendar, a doctor timeline, charts and a pivot.',
      'The dashboard counts visits, no-shows and workload per doctor, with a date filter on the start time.',
    ],
    ui: [
      'Laying out the pages from the views the advisor recommended: a board for the front desk, calendars, a day list for doctors. Everyone gets the overview. Teal, side navigation.',
    ],
  },
  research: () => ({
    name: 'CareDesk',
    summary: 'The front desk books appointments, doctors run their day and record visit notes, and the manager watches no-shows.',
    roles: [
      {
        id: 'receptionist',
        name: 'Receptionist',
        can: 'Registers patients, books and checks in appointments',
      },
      {
        id: 'doctor',
        name: 'Doctor',
        can: 'Sees their own schedule, runs visits, writes visit notes',
      },
      {
        id: 'manager',
        name: 'Clinic manager',
        can: 'Sees everything, tracks no-shows and workload',
      },
    ],
    entities: [
      {
        name: 'patients',
        what: 'People the clinic treats',
      },
      {
        name: 'appointments',
        what: 'A booked slot with one doctor',
      },
      {
        name: 'visit_notes',
        what: 'What the doctor recorded for a visit',
      },
    ],
    process: {
      entity: 'appointments',
      states: ['booked', 'checked_in', 'in_consult', 'done', 'no_show', 'cancelled'],
      note: 'The front desk checks patients in. The doctor starts and completes the visit.',
    },
    stories: [
      {
        role: 'receptionist',
        want: 'book an appointment for a patient with a doctor',
        so: 'the doctor sees it on their schedule',
      },
      {
        role: 'receptionist',
        want: 'check a patient in when they arrive',
        so: 'the doctor knows who is waiting',
      },
      {
        role: 'doctor',
        want: 'see only my own appointments',
        so: 'I can run my clinic without noise',
      },
      {
        role: 'doctor',
        want: 'write a visit note with a follow-up date',
        so: 'the next visit has context',
      },
      {
        role: 'manager',
        want: 'see no-shows and visits per doctor',
        so: 'I can fix the schedule',
      },
    ],
    rules: [
      'Doctors see only their own appointments',
      'A visit can be completed only after it has started',
      'Cancelled and no-show visits stay on record',
    ],
    question: {
      text: 'Should the front desk be able to read visit notes?',
      options: ['No. Notes stay with doctors and the manager', 'Yes. The front desk can read them, not write them'],
      recommended: 0,
    },
  }),
  database: (ctx, attempt) => {
    const reasons = [
      'Blood pressure review',
      'Persistent cough',
      'Diabetes follow-up',
      'Knee pain after a fall',
      'Annual check-up',
      'Migraine review',
      'Skin rash',
      'Vaccination',
      'Lower back pain',
      'Thyroid results',
      'Chest infection follow-up',
      'Allergy consultation',
      'Ear infection',
      'Sports injury',
      'Sleep problems',
      'Stomach pain',
    ];
    const slots = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '14:30', '15:00', '15:30', '16:00'];
    const now = [
      ['09:00', 'done'],
      ['09:30', 'done'],
      ['10:30', 'in_consult'],
      ['11:00', 'checked_in'],
      ['14:00', 'booked'],
      ['15:30', 'booked'],
      ['16:00', 'booked'],
    ];
    const appts: Dict<string | number>[] = [];
    let k = 0;
    for (let day = -5; day <= 6; day++) {
      const n = day === 0 ? now.length : k % 3 === 0 ? 3 : 2;
      for (let j = 0; j < n; j++, k++) {
        const status =
          day === 0
            ? now[j][1]
            : day < 0
              ? k % 7 === 3
                ? 'no_show'
                : k % 9 === 5
                  ? 'cancelled'
                  : 'done'
              : k % 8 === 6
                ? 'cancelled'
                : 'booked';
        const a: Dict<string | number> = {
          patient_id: 1 + ((k * 5) % 14),
          doctor_id: 3 + (k % 3),
          starts_at: day + ' ' + (day === 0 ? now[j][0] : slots[(k * 5 + j * 3) % slots.length]),
          reason: reasons[k % reasons.length],
          status,
        };
        if (attempt === 1) a.room_id = 1 + (k % 3);
        else a.room = 'room_' + (1 + (k % 3));
        appts.push(a);
      }
    }
    // A note is written for the visit it belongs to: its summary follows the appointment's reason.
    const noteFor: Dict<[string, string, number | null]> = {
      'Blood pressure review': ['BP stable on current dose', 'Home readings average 128/82. Continue current medication.', 30],
      'Persistent cough': ['Viral cough, no antibiotics', 'Chest clear. Fluids and rest. Review if fever returns.', null],
      'Diabetes follow-up': ['HbA1c improved', 'Diet changes are working. Repeat bloods in three months.', 90],
      'Knee pain after a fall': ['Knee sprain, no fracture', 'X-ray clear. Brace for two weeks, physiotherapy referral.', 14],
      'Annual check-up': ['Routine check-up, all normal', 'Bloods and ECG normal. Next check in a year.', null],
      'Migraine review': ['Migraine frequency down', 'Two episodes this month. Keep the diary going.', 60],
      'Skin rash': ['Contact dermatitis', 'Likely the new detergent. Topical cream for a week.', 7],
      Vaccination: ['Vaccination given', 'No reaction after 15 minutes of observation.', null],
      'Lower back pain': ['Muscle strain', 'No red flags. Gentle exercise and pain relief as needed.', 21],
      'Thyroid results': ['Thyroid levels normal', 'TSH within range. Keep the current dose.', 180],
      'Chest infection follow-up': ['Infection cleared', 'Chest clear after the antibiotics. No review needed.', null],
      'Allergy consultation': ['Hay fever confirmed', 'Antihistamine daily through the spring.', 60],
      'Ear infection': ['Outer ear infection', 'Ear drops for a week. Keep the ear dry.', 7],
      'Sports injury': ['Ankle sprain', 'Rest, ice and support. Back to sport in three weeks.', 21],
      'Sleep problems': ['Sleep routine advice', 'No medication for now. Keep a sleep diary.', 30],
      'Stomach pain': ['Mild gastritis', 'Smaller meals, avoid spicy food. Antacid as needed.', 14],
    };
    const done = appts
      .map((a, i) => (a.status === 'done' ? i + 1 : 0))
      .filter(Boolean)
      .slice(0, 8);
    const notes = done.map((id) => noteFor[String(appts[id - 1].reason)]);
    const P = [
      ['Zara Ahmed', '0300 5550101', '1991-03-14', 'female', 'Prefers morning slots'],
      ['Omar Siddiqui', '0321 5550102', '1984-11-02', 'male', ''],
      ['Khadija Butt', '0333 5550103', '1957-06-21', 'female', 'Hard of hearing, speak clearly'],
      ['Yusuf Chaudhry', '0345 5550104', '2016-09-09', 'male', 'Comes with his mother'],
      ['Mariam Anwar', '0301 5550105', '1995-01-27', 'female', ''],
      ['Farhan Javed', '0312 5550106', '1979-08-15', 'male', 'Needs an invoice for his employer'],
      ['Rabia Saleem', '0322 5550107', '1988-12-05', 'female', ''],
      ['Tariq Mehmood', '0334 5550108', '1949-04-30', 'male', 'Wheelchair access'],
      ['Noor Fatima', '0346 5550109', '2001-07-18', 'female', ''],
      ['Adeel Rashid', '0302 5550110', '1993-02-11', 'male', ''],
      ['Saima Kazmi', '0313 5550111', '1972-10-23', 'female', 'Call before 5 pm only'],
      ['Junaid Akram', '0323 5550112', '1986-05-07', 'male', ''],
      ['Hafsa Naveed', '0335 5550113', '2019-03-29', 'female', 'Comes with her father'],
      ['Waleed Zafar', '0347 5550114', '1964-09-16', 'male', ''],
    ];
    return {
      tables: [
        {
          name: 'patients',
          label: 'Patients',
          one: 'Patient',
          title: 'full_name',
          owner: null,
          columns: [
            {
              name: 'full_name',
              label: 'Full name',
              type: 'text',
              required: true,
            },
            {
              name: 'phone',
              label: 'Phone',
              type: 'text',
            },
            {
              name: 'date_of_birth',
              label: 'Date of birth',
              type: 'date',
            },
            {
              name: 'gender',
              label: 'Gender',
              type: 'select',
              options: ['female', 'male', 'other'],
            },
            {
              name: 'front_desk_note',
              label: 'Front desk note',
              type: 'longtext',
            },
          ],
          rows: P.map((p) => ({
            full_name: p[0],
            phone: p[1],
            date_of_birth: p[2],
            gender: p[3],
            front_desk_note: p[4],
          })),
        },
        {
          name: 'appointments',
          label: 'Appointments',
          one: 'Appointment',
          title: 'reason',
          owner: 'doctor_id',
          columns: [
            {
              name: 'patient_id',
              label: 'Patient',
              type: 'ref',
              ref: 'patients',
              required: true,
            },
            {
              name: 'doctor_id',
              label: 'Doctor',
              type: 'user',
              role: 'doctor',
              required: true,
            },
            {
              name: 'starts_at',
              label: 'Starts',
              type: 'datetime',
              required: true,
            },
            {
              name: 'reason',
              label: 'Reason',
              type: 'text',
              required: true,
            },
            attempt === 1
              ? {
                  name: 'room_id',
                  label: 'Room',
                  type: 'ref',
                  ref: 'rooms',
                }
              : {
                  name: 'room',
                  label: 'Room',
                  type: 'select',
                  options: ['room_1', 'room_2', 'room_3'],
                },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['booked', 'checked_in', 'in_consult', 'done', 'no_show', 'cancelled'],
              required: true,
            },
          ],
          rows: appts,
        },
        {
          name: 'visit_notes',
          label: 'Visit notes',
          one: 'Visit note',
          title: 'summary',
          owner: 'doctor_id',
          columns: [
            {
              name: 'appointment_id',
              label: 'Appointment',
              type: 'ref',
              ref: 'appointments',
              required: true,
            },
            {
              name: 'doctor_id',
              label: 'Doctor',
              type: 'user',
              role: 'doctor',
              required: true,
            },
            {
              name: 'summary',
              label: 'Summary',
              type: 'text',
              required: true,
            },
            {
              name: 'details',
              label: 'Details',
              type: 'longtext',
            },
            {
              name: 'follow_up_on',
              label: 'Follow up on',
              type: 'date',
            },
          ],
          rows: done.map((id, i) => ({
            appointment_id: id,
            doctor_id: appts[id - 1].doctor_id,
            summary: notes[i][0],
            details: notes[i][1],
            follow_up_on: notes[i][2],
          })),
        },
      ],
      users: [
        {
          name: 'Sara Malik',
          role: 'receptionist',
        },
        {
          name: 'Hamza Tariq',
          role: 'receptionist',
        },
        {
          name: 'Dr. Ayesha Rahman',
          role: 'doctor',
        },
        {
          name: 'Dr. Bilal Qureshi',
          role: 'doctor',
        },
        {
          name: 'Dr. Nadia Hussain',
          role: 'doctor',
        },
        {
          name: 'Imran Sheikh',
          role: 'manager',
        },
      ],
    };
  },
  backend: (ctx) => ({
    status: {
      table: 'appointments',
      column: 'status',
      initial: 'booked',
      states: [
        {
          id: 'booked',
          label: 'Booked',
          tone: 'info',
        },
        {
          id: 'checked_in',
          label: 'Checked in',
          tone: 'warning',
        },
        {
          id: 'in_consult',
          label: 'In consult',
          tone: 'warning',
        },
        {
          id: 'done',
          label: 'Done',
          tone: 'success',
        },
        {
          id: 'no_show',
          label: 'No-show',
          tone: 'danger',
        },
        {
          id: 'cancelled',
          label: 'Cancelled',
          tone: 'neutral',
        },
      ],
      transitions: [
        {
          id: 'check_in',
          label: 'Check in',
          from: ['booked'],
          to: 'checked_in',
          roles: ['receptionist'],
        },
        {
          id: 'start',
          label: 'Start visit',
          from: ['checked_in'],
          to: 'in_consult',
          roles: ['doctor'],
        },
        {
          id: 'complete',
          label: 'Complete visit',
          from: ['in_consult'],
          to: 'done',
          roles: ['doctor'],
        },
        {
          id: 'no_show',
          label: 'Mark no-show',
          from: ['booked'],
          to: 'no_show',
          roles: ['receptionist', 'manager'],
        },
        {
          id: 'cancel',
          label: 'Cancel',
          from: ['booked', 'checked_in'],
          to: 'cancelled',
          roles: ['receptionist', 'manager'],
        },
      ],
    },
    access: [
      {
        table: 'patients',
        role: 'receptionist',
        list: 'all',
        create: true,
        update: 'all',
        delete: false,
      },
      {
        table: 'patients',
        role: 'doctor',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'patients',
        role: 'manager',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'appointments',
        role: 'receptionist',
        list: 'all',
        create: true,
        update: 'all',
        delete: false,
      },
      {
        table: 'appointments',
        role: 'doctor',
        list: 'own',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'appointments',
        role: 'manager',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'visit_notes',
        role: 'receptionist',
        list: ctx.answer === 1 ? 'all' : 'none',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'visit_notes',
        role: 'doctor',
        list: 'own',
        create: true,
        update: 'own',
        delete: false,
      },
      {
        table: 'visit_notes',
        role: 'manager',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'appointments',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'Visits move through stages, so the front desk can drag a card from one to the next.',
          },
          {
            type: 'calendar',
            date: 'starts_at',
            why: 'Every visit has a start time.',
          },
          {
            type: 'timeline',
            start: 'starts_at',
            lane: 'doctor_id',
            why: 'One lane per doctor shows who is busy and when.',
          },
          {
            type: 'table',
            why: 'For sorting, grouping and totals.',
          },
          {
            type: 'chart',
            x: 'status',
            split: 'doctor_id',
            why: 'No-shows and completed visits, per doctor.',
          },
          {
            type: 'pivot',
            rows: 'doctor_id',
            cols: 'status',
            why: 'Doctor against status in one grid.',
          },
          {
            type: 'tree',
            levels: ['doctor_id', 'status'],
            why: 'Visits nested under each doctor, then by status.',
          },
        ],
      },
      {
        table: 'patients',
        use: [
          {
            type: 'table',
            why: 'A register is read as a list.',
          },
          {
            type: 'cards',
            why: 'One contact card per patient.',
          },
          {
            type: 'chart',
            x: 'gender',
            why: 'A quick split of the register.',
          },
        ],
      },
      {
        table: 'visit_notes',
        use: [
          {
            type: 'table',
            why: 'For sorting by follow-up date.',
          },
          {
            type: 'cards',
            why: 'Notes are mostly text, which reads better on cards.',
          },
          {
            type: 'calendar',
            date: 'follow_up_on',
            why: 'Follow-ups fall on a date.',
          },
          {
            type: 'timeline',
            start: 'follow_up_on',
            lane: 'doctor_id',
            why: 'Upcoming follow-ups per doctor.',
          },
          {
            type: 'tree',
            levels: ['doctor_id'],
            why: 'Notes grouped under the doctor who wrote them.',
          },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: {
        table: 'appointments',
        column: 'starts_at',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Appointments',
          table: 'appointments',
        },
        {
          kind: 'kpi',
          label: 'Completed',
          table: 'appointments',
          where: {
            status: 'done',
          },
        },
        {
          kind: 'kpi',
          label: 'No-shows',
          table: 'appointments',
          where: {
            status: 'no_show',
          },
        },
        {
          kind: 'kpi',
          label: 'Patients',
          table: 'patients',
        },
        {
          kind: 'bar',
          label: 'Visits by status',
          table: 'appointments',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Visits per doctor, by status',
          table: 'appointments',
          x: 'doctor_id',
          split: 'status',
        },
        {
          kind: 'line',
          label: 'Visits per day',
          table: 'appointments',
          x: 'starts_at',
          bucket: 'day',
        },
        {
          kind: 'bar',
          label: 'Visits by room',
          table: 'appointments',
          x: 'room',
        },
        {
          kind: 'recent',
          label: 'Latest appointments',
          table: 'appointments',
        },
      ],
    },
  }),
  ui: (ctx) => ({
    theme: {
      accent: 'teal',
      nav: 'side',
      icon: 'stethoscope',
    },
    screens: [
      {
        name: 'Front desk',
        type: 'board',
        table: 'appointments',
        roles: ['receptionist', 'manager'],
        group: 'status',
        date: 'starts_at',
        range: 'today',
        label: 'patient_id',
        columns: ['patient_id', 'doctor_id', 'starts_at', 'room'],
        icon: 'board',
      },
      {
        name: 'Schedule',
        type: 'calendar',
        table: 'appointments',
        roles: ['receptionist', 'manager'],
        date: 'starts_at',
        label: 'patient_id',
        icon: 'calendar',
      },
      {
        name: 'Book appointment',
        type: 'form',
        table: 'appointments',
        roles: ['receptionist'],
        icon: 'add',
      },
      {
        name: 'My day',
        type: 'table',
        table: 'appointments',
        roles: ['doctor'],
        columns: ['starts_at', 'patient_id', 'reason', 'room', 'status'],
        date: 'starts_at',
        range: 'today',
        icon: 'clock',
      },
      {
        name: 'My schedule',
        type: 'calendar',
        table: 'appointments',
        roles: ['doctor'],
        date: 'starts_at',
        label: 'patient_id',
        icon: 'calendar',
      },
      {
        name: 'Patients',
        type: 'table',
        table: 'patients',
        roles: ['receptionist', 'doctor', 'manager'],
        columns: ['full_name', 'phone', 'date_of_birth', 'gender'],
        icon: 'people',
      },
      {
        name: 'Visit notes',
        type: 'table',
        table: 'visit_notes',
        roles: ctx.answer === 1 ? ['doctor', 'manager', 'receptionist'] : ['doctor', 'manager'],
        columns: ['summary', 'appointment_id', 'doctor_id', 'follow_up_on'],
        icon: 'notebook',
      },
      {
        name: 'Overview',
        type: 'dashboard',
        table: 'appointments',
        roles: ['manager'],
        icon: 'pie',
      },
    ],
    tour: [
      {
        role: 'receptionist',
        do: 'create',
        table: 'appointments',
        values: {
          patient_id: 3,
          doctor_id: 3,
          starts_at: '0 16:30',
          reason: 'Follow-up: blood pressure review',
          room: 'room_2',
        },
        say: 'Sara at the front desk books a follow-up for Khadija Butt with Dr. Ayesha.',
      },
      {
        role: 'doctor',
        do: 'see',
        table: 'appointments',
        screen: 'My schedule',
        say: "Dr. Ayesha signs in and finds the new visit. She sees her own appointments and nobody else's.",
      },
      {
        role: 'receptionist',
        do: 'transition',
        table: 'appointments',
        transition: 'check_in',
        say: 'The patient arrives and Sara checks her in.',
      },
      {
        role: 'doctor',
        do: 'transition',
        table: 'appointments',
        transition: 'start',
        say: 'Dr. Ayesha starts the visit.',
      },
      {
        role: 'doctor',
        do: 'transition',
        table: 'appointments',
        transition: 'complete',
        say: 'She completes it. The board at the front desk shows Done.',
      },
      {
        role: 'receptionist',
        do: 'denied',
        table: 'visit_notes',
        action: 'create',
        say: 'Sara tries to write a visit note. The backend refuses, because notes belong to doctors.',
      },
      {
        role: 'manager',
        do: 'open',
        screen: 'Overview',
        say: 'Imran, the manager, opens the overview to see no-shows and visits per doctor.',
      },
    ],
  }),
};
REC.helpdesk = {
  ...CARDS.helpdesk,
  usage: {
    research: [1280, 640, 6100],
    database: [2520, 3120, 15600],
    backend: [3480, 1090, 8800],
    views: [2740, 1260, 8600],
    views2: [3010, 1240, 8100],
    ui: [4390, 1560, 10900],
  },
  lookup: {
    connector: 'wikipedia',
    tool: 'search_pages',
    args: {
      q: 'help desk issue tracking',
    },
    say: 'I checked the usual ticket states so the queue reads the way a service desk expects.',
    note: 'Common ticket states',
  },
  say: {
    research: [
      'Reading the request. Employees raise tickets, agents work them, a lead watches the queue.',
      'Three roles, three kinds of record, one process on tickets. One question for you about closing tickets.',
    ],
    database: ["Creating tables for tickets, devices and agents' work notes, with 24 made-up tickets at different stages."],
    backend: ['Writing the workflow. Employees see only their own tickets, and work notes stay with the support team.'],
    views: [
      'Matching each table to the views its columns can carry. Tickets have a status, a priority, a category, people and a due date, so nearly the whole catalog fits.',
      'The dashboard tracks the queue: unassigned, urgent, load per agent and what is due.',
    ],
    views2: [
      'The check is right. Work notes have no choice field, so a board has no columns to make. I took it out and kept the tree, which nests notes under their ticket.',
    ],
    ui: [
      'Laying out the pages from the recommended views: a form to raise a ticket, a queue board, a due-date calendar. Purple, top navigation. I also wired a Suggest docs action to the Microsoft Learn connection.',
    ],
  },
  research: () => ({
    name: 'DeskLine',
    summary: 'Employees raise IT tickets, agents work a shared queue, and the team lead watches what is due.',
    roles: [
      {
        id: 'employee',
        name: 'Employee',
        can: 'Raises tickets and follows their own',
      },
      {
        id: 'agent',
        name: 'Support agent',
        can: 'Takes tickets from the queue and resolves them',
      },
      {
        id: 'lead',
        name: 'Team lead',
        can: 'Sees everything, reopens and removes tickets',
      },
    ],
    entities: [
      {
        name: 'tickets',
        what: 'A request for help',
      },
      {
        name: 'devices',
        what: 'Laptops, phones and other equipment',
      },
      {
        name: 'work_notes',
        what: "Agents' internal notes on a ticket",
      },
    ],
    process: {
      entity: 'tickets',
      states: ['new', 'assigned', 'in_progress', 'waiting_on_user', 'resolved', 'closed'],
      note: 'An agent takes a ticket, works it, and resolves it.',
    },
    stories: [
      {
        role: 'employee',
        want: 'raise a ticket in under a minute',
        so: 'I can get back to work',
      },
      {
        role: 'employee',
        want: 'see only my own tickets and where they stand',
        so: 'I do not have to chase',
      },
      {
        role: 'agent',
        want: 'take the next ticket from a shared queue',
        so: 'nothing sits unowned',
      },
      {
        role: 'agent',
        want: 'keep internal work notes on a ticket',
        so: 'a colleague can pick it up',
      },
      {
        role: 'lead',
        want: 'see tickets by status, priority and agent',
        so: 'I can balance the team',
      },
    ],
    rules: [
      'Employees see only their own tickets and devices',
      'Work notes are never visible to employees',
      'Status changes only through the workflow actions',
    ],
    question: {
      text: 'When an agent resolves a ticket, who closes it?',
      options: ['The employee confirms the fix, then it closes', 'The team lead closes it'],
      recommended: 0,
    },
  }),
  database: () => {
    const T = [
      ['VPN drops every 20 minutes on home Wi-Fi', 'network', 'high'],
      ['Cannot sign in after password change', 'access', 'urgent'],
      ['Laptop battery lasts under an hour', 'hardware', 'normal'],
      ['Need access to the Finance shared drive', 'access', 'normal'],
      ['Outlook keeps asking for credentials', 'email', 'high'],
      ['Second monitor not detected after update', 'hardware', 'low'],
      ['Request: install Power BI Desktop', 'software', 'normal'],
      ['Printer on floor 2 jams on duplex', 'hardware', 'low'],
      ['Teams calls echo in meeting room B', 'software', 'normal'],
      ['New joiner needs laptop and accounts by Monday', 'access', 'high'],
      ['Wi-Fi very slow near the cafeteria', 'network', 'normal'],
      ['Shared mailbox not showing in Outlook', 'email', 'normal'],
      ['Laptop fan loud and overheating', 'hardware', 'normal'],
      ['MFA prompts not arriving on new phone', 'access', 'urgent'],
      ['Excel crashes opening a large workbook', 'software', 'high'],
      ['Request: larger mailbox quota', 'email', 'low'],
      ['Docking station not charging laptop', 'hardware', 'normal'],
      ['Cannot connect to the staging database', 'network', 'high'],
      ['Licence expired for the design tool', 'software', 'normal'],
      ['Phone screen cracked, needs replacement', 'hardware', 'low'],
      ['Guest Wi-Fi password for a client visit', 'network', 'low'],
      ['Account locked after failed sign-ins', 'access', 'urgent'],
      ['Calendar invites sent in the wrong time zone', 'email', 'normal'],
      ['Keyboard keys sticking on laptop', 'hardware', 'low'],
    ];
    const ST = [
      'new',
      'in_progress',
      'assigned',
      'resolved',
      'waiting_on_user',
      'new',
      'closed',
      'in_progress',
      'assigned',
      'in_progress',
      'closed',
      'resolved',
      'new',
      'in_progress',
      'waiting_on_user',
      'closed',
      'assigned',
      'in_progress',
      'resolved',
      'closed',
      'closed',
      'assigned',
      'new',
      'closed',
    ];
    const D: Dict<string> = {
      access: 'Started this morning. Blocks work on the month-end report.',
      hardware: 'Happens every day. The device is still under warranty.',
      software: 'Reproduced on two machines after the latest update.',
      network: 'Worse in the afternoon. A wired connection is fine.',
      email: 'Affects desktop Outlook only. Webmail works.',
    };
    const DEV = [
      ['LT-0412', 'laptop', 'Latitude 5440', 1, '2024-02-12'],
      ['LT-0417', 'laptop', 'ThinkPad T14 Gen 4', 2, '2024-03-04'],
      ['LT-0398', 'laptop', 'Surface Laptop 5', 3, '2023-09-18'],
      ['LT-0431', 'laptop', 'MacBook Air M2', 4, '2024-06-10'],
      ['LT-0440', 'laptop', 'Latitude 7450', 5, '2024-11-21'],
      ['DT-0102', 'desktop', 'OptiPlex 7010', 6, '2022-05-30'],
      ['PH-0220', 'phone', 'iPhone 13', 7, '2023-01-16'],
      ['PH-0231', 'phone', 'Galaxy A54', 1, '2023-08-07'],
      ['MN-0308', 'monitor', 'Dell U2422H', 2, '2022-11-14'],
      ['PR-0021', 'printer', 'LaserJet Pro M404', null, '2021-07-01'],
    ];
    const N = [
      [2, 5, 'Reset the password from the admin console. Waiting for the user to confirm.'],
      [2, 6, 'User confirmed sign-in works. Asked them to enrol MFA again.'],
      [4, 6, 'Finance approved access by email. Added to the FIN-Shared group.'],
      [5, 5, 'Cleared cached credentials. Asked the user to restart Outlook.'],
      [8, 6, 'Replaced the duplex roller. Watching it for a week.'],
      [10, 5, 'Laptop imaged. Accounts created and licences assigned.'],
      [12, 6, 'Added the shared mailbox again with full access rights.'],
      [14, 5, 'The old phone was still registered. Removed it so the new one can enrol.'],
      [15, 6, 'Crash dump sent to the vendor. Workaround: open in safe mode.'],
      [18, 5, 'Firewall rule missing for the staging subnet. Change request raised.'],
      [19, 6, 'Licence renewed for 12 months.'],
      [22, 5, 'Unlocked the account. Suggested a password manager.'],
    ];
    return {
      tables: [
        {
          name: 'devices',
          label: 'Devices',
          one: 'Device',
          title: 'asset_tag',
          owner: 'assigned_to',
          columns: [
            {
              name: 'asset_tag',
              label: 'Asset tag',
              type: 'text',
              required: true,
            },
            {
              name: 'kind',
              label: 'Kind',
              type: 'select',
              options: ['laptop', 'desktop', 'phone', 'monitor', 'printer'],
            },
            {
              name: 'model',
              label: 'Model',
              type: 'text',
            },
            {
              name: 'assigned_to',
              label: 'Assigned to',
              type: 'user',
            },
            {
              name: 'purchased_on',
              label: 'Purchased on',
              type: 'date',
            },
          ],
          rows: DEV.map((d) => ({
            asset_tag: d[0],
            kind: d[1],
            model: d[2],
            assigned_to: d[3],
            purchased_on: d[4],
          })),
        },
        {
          name: 'tickets',
          label: 'Tickets',
          one: 'Ticket',
          title: 'subject',
          owner: 'requester_id',
          columns: [
            {
              name: 'subject',
              label: 'Subject',
              type: 'text',
              required: true,
            },
            {
              name: 'details',
              label: 'Details',
              type: 'longtext',
            },
            {
              name: 'category',
              label: 'Category',
              type: 'select',
              options: ['access', 'hardware', 'software', 'network', 'email'],
            },
            {
              name: 'priority',
              label: 'Priority',
              type: 'select',
              options: ['urgent', 'high', 'normal', 'low'],
              required: true,
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['new', 'assigned', 'in_progress', 'waiting_on_user', 'resolved', 'closed'],
              required: true,
            },
            {
              name: 'requester_id',
              label: 'Requester',
              type: 'user',
              role: 'employee',
              required: true,
            },
            {
              name: 'assignee_id',
              label: 'Assignee',
              type: 'user',
              role: 'agent',
            },
            {
              name: 'device_id',
              label: 'Device',
              type: 'ref',
              ref: 'devices',
            },
            {
              name: 'due_on',
              label: 'Due on',
              type: 'date',
            },
          ],
          rows: T.map((t, i) => ({
            subject: t[0],
            details: D[t[1]],
            category: t[1],
            priority: t[2],
            status: ST[i],
            requester_id: 1 + (i % 4),
            assignee_id: ST[i] === 'new' ? null : 5 + (i % 2),
            device_id: t[1] === 'hardware' ? 1 + (i % 9) : null,
            due_on: (i % 9) - 3,
          })),
        },
        {
          name: 'work_notes',
          label: 'Work notes',
          one: 'Work note',
          title: 'note',
          owner: 'author_id',
          columns: [
            {
              name: 'ticket_id',
              label: 'Ticket',
              type: 'ref',
              ref: 'tickets',
              required: true,
            },
            {
              name: 'author_id',
              label: 'Author',
              type: 'user',
              required: true,
            },
            {
              name: 'note',
              label: 'Note',
              type: 'text',
              required: true,
            },
          ],
          rows: N.map((n) => ({
            ticket_id: n[0],
            author_id: n[1],
            note: n[2],
          })),
        },
      ],
      users: [
        {
          name: 'Zainab Akhtar',
          role: 'employee',
        },
        {
          name: 'Usman Javed',
          role: 'employee',
        },
        {
          name: 'Maria Fernandes',
          role: 'employee',
        },
        {
          name: 'Daniyal Sheikh',
          role: 'employee',
        },
        {
          name: 'Hira Baig',
          role: 'agent',
        },
        {
          name: 'Omar Farooq',
          role: 'agent',
        },
        {
          name: 'Saad Mirza',
          role: 'lead',
        },
      ],
    };
  },
  backend: (ctx) => ({
    status: {
      table: 'tickets',
      column: 'status',
      initial: 'new',
      states: [
        {
          id: 'new',
          label: 'New',
          tone: 'info',
        },
        {
          id: 'assigned',
          label: 'Assigned',
          tone: 'info',
        },
        {
          id: 'in_progress',
          label: 'In progress',
          tone: 'warning',
        },
        {
          id: 'waiting_on_user',
          label: 'Waiting on user',
          tone: 'neutral',
        },
        {
          id: 'resolved',
          label: 'Resolved',
          tone: 'success',
        },
        {
          id: 'closed',
          label: 'Closed',
          tone: 'neutral',
        },
      ],
      transitions: [
        {
          id: 'take',
          label: 'Take ticket',
          from: ['new'],
          to: 'assigned',
          roles: ['agent'],
          set: {
            assignee_id: ':me',
          },
        },
        {
          id: 'start',
          label: 'Start work',
          from: ['assigned'],
          to: 'in_progress',
          roles: ['agent'],
        },
        {
          id: 'ask_requester',
          label: 'Ask the requester',
          from: ['in_progress'],
          to: 'waiting_on_user',
          roles: ['agent'],
        },
        {
          id: 'resume',
          label: 'Requester replied',
          from: ['waiting_on_user'],
          to: 'in_progress',
          roles: ['agent', 'employee'],
        },
        {
          id: 'resolve',
          label: 'Resolve',
          from: ['in_progress', 'waiting_on_user'],
          to: 'resolved',
          roles: ['agent'],
        },
        ctx.answer === 1
          ? {
              id: 'close',
              label: 'Close',
              from: ['resolved'],
              to: 'closed',
              roles: ['lead'],
            }
          : {
              id: 'close',
              label: 'Confirm it is fixed',
              from: ['resolved'],
              to: 'closed',
              roles: ['employee'],
            },
        {
          id: 'reopen',
          label: 'Reopen',
          from: ['resolved'],
          to: 'in_progress',
          roles: ['employee', 'lead'],
        },
      ],
    },
    access: [
      {
        table: 'tickets',
        role: 'employee',
        list: 'own',
        create: true,
        update: 'none',
        delete: false,
      },
      {
        table: 'tickets',
        role: 'agent',
        list: 'all',
        create: true,
        update: 'all',
        delete: false,
      },
      {
        table: 'tickets',
        role: 'lead',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'work_notes',
        role: 'employee',
        list: 'none',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'work_notes',
        role: 'agent',
        list: 'all',
        create: true,
        update: 'own',
        delete: false,
      },
      {
        table: 'work_notes',
        role: 'lead',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'devices',
        role: 'employee',
        list: 'own',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'devices',
        role: 'agent',
        list: 'all',
        create: true,
        update: 'all',
        delete: false,
      },
      {
        table: 'devices',
        role: 'lead',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
    ],
  }),
  views: (ctx, attempt) => ({
    views: [
      {
        table: 'tickets',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'Tickets move through a queue, so agents drag them from one stage to the next.',
          },
          {
            type: 'table',
            why: 'For sorting by priority and due date, with grouping.',
          },
          {
            type: 'calendar',
            date: 'due_on',
            why: 'Each ticket has a due date.',
          },
          {
            type: 'timeline',
            start: 'due_on',
            lane: 'assignee_id',
            why: 'What each agent has coming due.',
          },
          {
            type: 'chart',
            x: 'category',
            split: 'priority',
            why: 'Where the load comes from, and how urgent it is.',
          },
          {
            type: 'pivot',
            rows: 'assignee_id',
            cols: 'status',
            why: 'Agent against status shows who is stuck.',
          },
          {
            type: 'tree',
            levels: ['category', 'priority'],
            why: 'Tickets nested by category, then priority.',
          },
          {
            type: 'cards',
            why: 'A card per ticket for a quick scan.',
          },
        ],
      },
      {
        table: 'devices',
        use: [
          {
            type: 'table',
            why: 'An asset register is read as a list.',
          },
          {
            type: 'cards',
            why: 'One card per device.',
          },
          {
            type: 'chart',
            x: 'kind',
            why: 'How many of each kind of device.',
          },
          {
            type: 'pivot',
            rows: 'assigned_to',
            cols: 'kind',
            why: 'Who holds what.',
          },
          {
            type: 'tree',
            levels: ['kind'],
            why: 'Devices grouped by kind.',
          },
        ],
      },
      {
        table: 'work_notes',
        use: [
          {
            type: 'table',
            why: 'The log, newest first.',
          },
          {
            type: 'tree',
            levels: ['ticket_id'],
            why: 'Notes nested under their ticket.',
          },
          {
            type: 'cards',
            why: 'Notes are text, which reads better on cards.',
          },
        ].concat(
          attempt === 1
            ? [
                {
                  type: 'board',
                  why: 'Notes as cards in columns.',
                },
              ]
            : [],
        ),
      },
    ],
    dashboard: {
      title: 'Overview',
      date: {
        table: 'tickets',
        column: 'due_on',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Tickets',
          table: 'tickets',
        },
        {
          kind: 'kpi',
          label: 'Unassigned',
          table: 'tickets',
          where: {
            status: 'new',
          },
        },
        {
          kind: 'kpi',
          label: 'Urgent',
          table: 'tickets',
          where: {
            priority: 'urgent',
          },
        },
        {
          kind: 'kpi',
          label: 'Resolved',
          table: 'tickets',
          where: {
            status: 'resolved',
          },
        },
        {
          kind: 'bar',
          label: 'Tickets by status',
          table: 'tickets',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Tickets per agent, by priority',
          table: 'tickets',
          x: 'assignee_id',
          split: 'priority',
        },
        {
          kind: 'line',
          label: 'Tickets due per day',
          table: 'tickets',
          x: 'due_on',
          bucket: 'day',
        },
        {
          kind: 'bar',
          label: 'Tickets by category',
          table: 'tickets',
          x: 'category',
        },
        {
          kind: 'recent',
          label: 'Latest tickets',
          table: 'tickets',
        },
      ],
    },
  }),
  ui: (ctx) => ({
    theme: {
      accent: 'purple',
      nav: 'top',
      icon: 'headset',
    },
    screens: [
      {
        name: 'Raise a ticket',
        type: 'form',
        table: 'tickets',
        roles: ['employee'],
        icon: 'add',
      },
      {
        name: 'My tickets',
        type: 'table',
        table: 'tickets',
        roles: ['employee'],
        columns: ['subject', 'status', 'priority', 'due_on'],
        icon: 'ticket',
      },
      {
        name: 'My devices',
        type: 'table',
        table: 'devices',
        roles: ['employee'],
        columns: ['asset_tag', 'kind', 'model', 'purchased_on'],
        icon: 'desktop',
      },
      {
        name: 'Queue',
        type: 'board',
        table: 'tickets',
        roles: ['agent', 'lead'],
        group: 'status',
        columns: ['priority', 'requester_id', 'assignee_id', 'due_on'],
        icon: 'board',
      },
      {
        name: 'All tickets',
        type: 'table',
        table: 'tickets',
        roles: ['agent', 'lead'],
        columns: ['subject', 'priority', 'status', 'requester_id', 'assignee_id', 'due_on'],
        icon: 'ticket',
      },
      {
        name: 'Due dates',
        type: 'calendar',
        table: 'tickets',
        roles: ['agent', 'lead'],
        date: 'due_on',
        icon: 'calendar',
      },
      {
        name: 'Devices',
        type: 'table',
        table: 'devices',
        roles: ['agent', 'lead'],
        columns: ['asset_tag', 'kind', 'model', 'assigned_to', 'purchased_on'],
        icon: 'desktop',
      },
      {
        name: 'Overview',
        type: 'dashboard',
        table: 'tickets',
        roles: ['lead'],
        icon: 'pie',
      },
    ],
    actions: [
      {
        id: 'docs',
        label: 'Suggest docs',
        table: 'tickets',
        connector: 'mslearn',
        tool: 'microsoft_docs_search',
        arg: 'subject',
      },
    ],
    tour: [
      {
        role: 'employee',
        do: 'create',
        table: 'tickets',
        values: {
          subject: 'Laptop will not wake from sleep after docking',
          details: 'I have to hold the power button every morning.',
          category: 'hardware',
          priority: 'high',
          due_on: 2,
        },
        say: 'Zainab raises a ticket about her laptop.',
      },
      {
        role: 'agent',
        do: 'see',
        table: 'tickets',
        screen: 'Queue',
        say: 'Hira, a support agent, finds it in the shared queue.',
      },
      {
        role: 'agent',
        do: 'transition',
        table: 'tickets',
        transition: 'take',
        say: 'Hira takes the ticket. The backend stamps her as the assignee.',
      },
      {
        role: 'agent',
        do: 'transition',
        table: 'tickets',
        transition: 'start',
        say: 'She starts work on it.',
      },
      {
        role: 'agent',
        do: 'transition',
        table: 'tickets',
        transition: 'resolve',
        say: 'She resolves it.',
      },
      ctx.answer === 1
        ? {
            role: 'lead',
            do: 'transition',
            table: 'tickets',
            transition: 'close',
            say: 'Saad, the team lead, closes the ticket.',
          }
        : {
            role: 'employee',
            do: 'transition',
            table: 'tickets',
            transition: 'close',
            say: 'Zainab confirms the fix and the ticket closes.',
          },
      {
        role: 'employee',
        do: 'denied',
        table: 'work_notes',
        action: 'list',
        say: "Zainab tries to read the agents' work notes. The backend refuses.",
      },
      {
        role: 'lead',
        do: 'open',
        screen: 'Overview',
        say: 'Saad opens the overview to see the queue and the load per agent.',
      },
    ],
  }),
};
REC.leave = {
  ...CARDS.leave,
  usage: {
    research: [1190, 580, 5800],
    database: [2380, 2640, 13200],
    backend: [3190, 870, 7400],
    views: [2590, 1210, 8300],
    ui: [4010, 1420, 9800],
  },
  lookup: {
    connector: 'wikipedia',
    tool: 'search_pages',
    args: {
      q: 'annual leave types',
    },
    say: 'I checked the usual kinds of leave so the choices match what HR teams use.',
    note: 'Common kinds of leave',
  },
  say: {
    research: [
      'Reading the request. Employees ask, managers decide, HR keeps the books.',
      'Three roles, three kinds of record, one process on leave requests. One question for you about cancelling approved leave.',
    ],
    database: ['Creating tables for requests, balances and holidays, with a few months of made-up leave around today.'],
    backend: ['Writing the workflow. Employees see only their own requests and balances, and only managers approve.'],
    views: [
      'Leave has a start and an end date, so a calendar and a timeline with one lane per person are the natural views. Days is a number, so charts and the pivot can total it.',
      'The dashboard totals approved days, shows what is waiting, and plots days starting each week.',
    ],
    ui: [
      'Laying out the pages from the recommended views: a request form, an approvals board, a team calendar and a who-is-away timeline. Green, with a compact icon rail.',
    ],
  },
  research: () => ({
    name: 'TimeOff',
    summary: 'Employees request leave, managers approve or reject it, and HR keeps balances and the team calendar.',
    roles: [
      {
        id: 'employee',
        name: 'Employee',
        can: 'Requests leave and follows their own requests and balance',
      },
      {
        id: 'manager',
        name: 'Manager',
        can: 'Approves or rejects requests',
      },
      {
        id: 'hr',
        name: 'HR officer',
        can: 'Keeps balances and holidays, cancels approved leave',
      },
    ],
    entities: [
      {
        name: 'leave_requests',
        what: 'One request for days off',
      },
      {
        name: 'leave_balances',
        what: 'Days entitled and used, per person and kind',
      },
      {
        name: 'holidays',
        what: 'Days the office is closed',
      },
    ],
    process: {
      entity: 'leave_requests',
      states: ['pending', 'approved', 'rejected', 'cancelled'],
      note: 'A manager approves or rejects. The employee may withdraw a pending request.',
    },
    stories: [
      {
        role: 'employee',
        want: 'request leave with dates and a reason',
        so: 'my manager can decide quickly',
      },
      {
        role: 'employee',
        want: 'see only my own requests and balance',
        so: 'I know where I stand',
      },
      {
        role: 'manager',
        want: 'approve or reject pending requests',
        so: 'the team stays covered',
      },
      {
        role: 'hr',
        want: "see everyone's leave on one calendar",
        so: 'I can spot clashes',
      },
      {
        role: 'hr',
        want: 'maintain balances and holidays',
        so: 'the numbers stay right',
      },
    ],
    rules: [
      'Employees see only their own requests and balances',
      'Only managers approve or reject',
      'Status changes only through the workflow actions',
    ],
    question: {
      text: 'After leave is approved, who may cancel it?',
      options: ['Only HR', 'HR, or the employee who asked'],
      recommended: 0,
    },
  }),
  database: () => {
    const R = [
      [1, 'annual', -40, -36, 5, 'Trip to Hunza with family', 'approved', 'Enjoy. Handover is done.'],
      [2, 'sick', -21, -20, 2, 'Flu', 'approved', ''],
      [3, 'casual', -14, -14, 1, 'Bank and passport errands', 'approved', ''],
      [4, 'annual', -10, -6, 5, "Sister's wedding in Lahore", 'approved', 'Cover arranged with Ali.'],
      [1, 'sick', -5, -5, 1, 'Migraine', 'approved', ''],
      [2, 'annual', 3, 7, 5, 'Travel abroad with parents', 'approved', 'Approved.'],
      [3, 'annual', 10, 12, 3, 'Moving house', 'pending', ''],
      [4, 'casual', 2, 2, 1, 'Parent-teacher meeting', 'pending', ''],
      [1, 'annual', 20, 24, 5, 'Year-end family visit to Karachi', 'pending', ''],
      [2, 'unpaid', 30, 38, 9, 'Preparing for a professional exam', 'pending', ''],
      [3, 'sick', -2, -1, 2, 'Dental surgery', 'approved', ''],
      [4, 'annual', -60, -58, 3, 'Short break', 'rejected', 'Release week. Please pick dates after the 15th.'],
      [1, 'casual', 6, 6, 1, 'Car registration', 'cancelled', ''],
      [2, 'casual', -30, -30, 1, 'Family event', 'approved', ''],
      [3, 'annual', 45, 49, 5, 'Winter holiday', 'pending', ''],
      [4, 'sick', 0, 0, 1, 'Fever', 'approved', 'Get well soon.'],
    ];
    const used = {
        annual: [5, 5, 0, 5],
        sick: [1, 2, 2, 1],
        casual: [0, 1, 1, 0],
      },
      ent = {
        annual: 20,
        sick: 10,
        casual: 8,
      },
      bal: Dict<string | number>[] = [],
      yr = new Date().getFullYear();
    [1, 2, 3, 4].forEach((e) =>
      (['annual', 'sick', 'casual'] as const).forEach((k) =>
        bal.push({
          employee_id: e,
          leave_type: k,
          year: yr,
          entitled_days: ent[k],
          used_days: used[k][e - 1],
        }),
      ),
    );
    return {
      tables: [
        {
          name: 'leave_requests',
          label: 'Leave requests',
          one: 'Leave request',
          title: 'reason',
          owner: 'employee_id',
          columns: [
            {
              name: 'employee_id',
              label: 'Employee',
              type: 'user',
              role: 'employee',
              required: true,
            },
            {
              name: 'leave_type',
              label: 'Leave type',
              type: 'select',
              options: ['annual', 'sick', 'casual', 'unpaid'],
              required: true,
            },
            {
              name: 'starts_on',
              label: 'Starts on',
              type: 'date',
              required: true,
            },
            {
              name: 'ends_on',
              label: 'Ends on',
              type: 'date',
              required: true,
            },
            {
              name: 'days',
              label: 'Days',
              type: 'number',
              required: true,
            },
            {
              name: 'reason',
              label: 'Reason',
              type: 'text',
              required: true,
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['pending', 'approved', 'rejected', 'cancelled'],
              required: true,
            },
            {
              name: 'manager_note',
              label: 'Manager note',
              type: 'text',
            },
          ],
          rows: R.map((r) => ({
            employee_id: r[0],
            leave_type: r[1],
            starts_on: r[2],
            ends_on: r[3],
            days: r[4],
            reason: r[5],
            status: r[6],
            manager_note: r[7],
          })),
        },
        {
          name: 'leave_balances',
          label: 'Leave balances',
          one: 'Leave balance',
          title: 'leave_type',
          owner: 'employee_id',
          columns: [
            {
              name: 'employee_id',
              label: 'Employee',
              type: 'user',
              role: 'employee',
              required: true,
            },
            {
              name: 'leave_type',
              label: 'Leave type',
              type: 'select',
              options: ['annual', 'sick', 'casual'],
              required: true,
            },
            {
              name: 'year',
              label: 'Year',
              type: 'number',
              required: true,
            },
            {
              name: 'entitled_days',
              label: 'Entitled days',
              type: 'number',
              required: true,
            },
            {
              name: 'used_days',
              label: 'Used days',
              type: 'number',
            },
          ],
          rows: bal,
        },
        {
          name: 'holidays',
          label: 'Holidays',
          one: 'Holiday',
          title: 'name',
          owner: null,
          columns: [
            {
              name: 'name',
              label: 'Name',
              type: 'text',
              required: true,
            },
            {
              name: 'on_date',
              label: 'Date',
              type: 'date',
              required: true,
            },
            {
              name: 'kind',
              label: 'Kind',
              type: 'select',
              options: ['public', 'company'],
            },
          ],
          rows: [
            {
              name: "New Year's Day",
              on_date: nextDate(1, 1),
              kind: 'public',
            },
            {
              name: 'Labour Day',
              on_date: nextDate(5, 1),
              kind: 'public',
            },
            {
              name: 'Company offsite',
              on_date: 18,
              kind: 'company',
            },
            {
              name: 'Annual town hall (half day)',
              on_date: 33,
              kind: 'company',
            },
            {
              name: "Founders' day",
              on_date: 52,
              kind: 'company',
            },
            {
              name: 'Office deep-clean day',
              on_date: -12,
              kind: 'company',
            },
          ],
        },
      ],
      users: [
        {
          name: 'Fatima Noor',
          role: 'employee',
        },
        {
          name: 'Ali Raza',
          role: 'employee',
        },
        {
          name: 'Sana Iqbal',
          role: 'employee',
        },
        {
          name: 'Hassan Mahmood',
          role: 'employee',
        },
        {
          name: 'Kamran Yousaf',
          role: 'manager',
        },
        {
          name: 'Mehwish Aslam',
          role: 'hr',
        },
      ],
    };
  },
  backend: (ctx) => ({
    status: {
      table: 'leave_requests',
      column: 'status',
      initial: 'pending',
      states: [
        {
          id: 'pending',
          label: 'Pending',
          tone: 'warning',
        },
        {
          id: 'approved',
          label: 'Approved',
          tone: 'success',
        },
        {
          id: 'rejected',
          label: 'Rejected',
          tone: 'danger',
        },
        {
          id: 'cancelled',
          label: 'Cancelled',
          tone: 'neutral',
        },
      ],
      transitions: [
        {
          id: 'approve',
          label: 'Approve',
          from: ['pending'],
          to: 'approved',
          roles: ['manager'],
        },
        {
          id: 'reject',
          label: 'Reject',
          from: ['pending'],
          to: 'rejected',
          roles: ['manager'],
        },
        {
          id: 'withdraw',
          label: 'Withdraw',
          from: ['pending'],
          to: 'cancelled',
          roles: ['employee'],
        },
        {
          id: 'cancel_approved',
          label: 'Cancel approved leave',
          from: ['approved'],
          to: 'cancelled',
          roles: ctx.answer === 1 ? ['hr', 'employee'] : ['hr'],
        },
      ],
    },
    access: [
      {
        table: 'leave_requests',
        role: 'employee',
        list: 'own',
        create: true,
        update: 'none',
        delete: false,
      },
      {
        table: 'leave_requests',
        role: 'manager',
        list: 'all',
        create: false,
        update: 'all',
        delete: false,
      },
      {
        table: 'leave_requests',
        role: 'hr',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'leave_balances',
        role: 'employee',
        list: 'own',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'leave_balances',
        role: 'manager',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'leave_balances',
        role: 'hr',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'holidays',
        role: 'employee',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'holidays',
        role: 'manager',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
      {
        table: 'holidays',
        role: 'hr',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
    ],
  }),
  views: () => ({
    views: [
      {
        table: 'leave_requests',
        use: [
          {
            type: 'calendar',
            date: 'starts_on',
            end: 'ends_on',
            why: 'Leave covers a run of days, and a calendar shows the overlap.',
          },
          {
            type: 'timeline',
            start: 'starts_on',
            end: 'ends_on',
            lane: 'employee_id',
            why: 'One lane per person shows who is away at the same time.',
          },
          {
            type: 'board',
            by: 'status',
            why: 'Managers decide by moving a request to approved or rejected.',
          },
          {
            type: 'table',
            why: 'For sorting, with days totalled at the bottom.',
          },
          {
            type: 'chart',
            x: 'leave_type',
            split: 'status',
            measure: 'sum:days',
            why: 'Days requested by kind of leave.',
          },
          {
            type: 'pivot',
            rows: 'employee_id',
            cols: 'leave_type',
            measure: 'sum:days',
            why: 'Days per person and kind of leave.',
          },
          {
            type: 'tree',
            levels: ['employee_id', 'leave_type'],
            why: 'Requests nested under each person.',
          },
        ],
      },
      {
        table: 'leave_balances',
        use: [
          {
            type: 'table',
            why: 'Balances are a ledger.',
          },
          {
            type: 'pivot',
            rows: 'employee_id',
            cols: 'leave_type',
            measure: 'sum:used_days',
            why: 'Days used per person and kind of leave.',
          },
          {
            type: 'chart',
            x: 'employee_id',
            split: 'leave_type',
            measure: 'sum:used_days',
            why: 'Who has used the most leave.',
          },
          {
            type: 'cards',
            why: 'A card per balance.',
          },
        ],
      },
      {
        table: 'holidays',
        use: [
          {
            type: 'calendar',
            date: 'on_date',
            why: 'Holidays are dates.',
          },
          {
            type: 'table',
            why: 'A short list.',
          },
          {
            type: 'timeline',
            start: 'on_date',
            lane: 'kind',
            why: 'Public and company days through the year.',
          },
          {
            type: 'cards',
            why: 'One card per holiday.',
          },
        ],
      },
    ],
    dashboard: {
      title: 'Overview',
      date: {
        table: 'leave_requests',
        column: 'starts_on',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Requests',
          table: 'leave_requests',
        },
        {
          kind: 'kpi',
          label: 'Waiting for a decision',
          table: 'leave_requests',
          where: {
            status: 'pending',
          },
        },
        {
          kind: 'kpi',
          label: 'Approved days',
          table: 'leave_requests',
          measure: 'sum:days',
          where: {
            status: 'approved',
          },
        },
        {
          kind: 'kpi',
          label: 'Holidays',
          table: 'holidays',
        },
        {
          kind: 'bar',
          label: 'Requests by status',
          table: 'leave_requests',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Days by kind of leave',
          table: 'leave_requests',
          x: 'leave_type',
          split: 'status',
          measure: 'sum:days',
        },
        {
          kind: 'line',
          label: 'Days of leave starting each week',
          table: 'leave_requests',
          x: 'starts_on',
          bucket: 'week',
          measure: 'sum:days',
        },
        {
          kind: 'bar',
          label: 'Days used per person',
          table: 'leave_balances',
          x: 'employee_id',
          measure: 'sum:used_days',
        },
        {
          kind: 'recent',
          label: 'Latest requests',
          table: 'leave_requests',
        },
      ],
    },
  }),
  ui: () => ({
    theme: {
      accent: 'forest',
      nav: 'rail',
      icon: 'beach',
      density: 'compact',
    },
    screens: [
      {
        name: 'Request leave',
        type: 'form',
        table: 'leave_requests',
        roles: ['employee'],
        icon: 'add',
      },
      {
        name: 'My requests',
        type: 'table',
        table: 'leave_requests',
        roles: ['employee'],
        columns: ['leave_type', 'starts_on', 'ends_on', 'days', 'status'],
        icon: 'list',
      },
      {
        name: 'My balance',
        type: 'table',
        table: 'leave_balances',
        roles: ['employee'],
        columns: ['leave_type', 'year', 'entitled_days', 'used_days'],
        icon: 'calculator',
      },
      {
        name: 'Approvals',
        type: 'board',
        table: 'leave_requests',
        roles: ['manager'],
        group: 'status',
        label: 'employee_id',
        columns: ['employee_id', 'leave_type', 'starts_on', 'days'],
        icon: 'board',
      },
      {
        name: 'Team calendar',
        type: 'calendar',
        table: 'leave_requests',
        roles: ['manager', 'hr'],
        date: 'starts_on',
        end: 'ends_on',
        label: 'employee_id',
        icon: 'calendar',
      },
      {
        name: 'Who is away',
        type: 'timeline',
        table: 'leave_requests',
        roles: ['manager', 'hr'],
        date: 'starts_on',
        end: 'ends_on',
        label: 'employee_id',
        icon: 'timeline',
      },
      {
        name: 'All requests',
        type: 'table',
        table: 'leave_requests',
        roles: ['hr', 'manager'],
        columns: ['employee_id', 'leave_type', 'starts_on', 'ends_on', 'days', 'status'],
        icon: 'list',
      },
      {
        name: 'Balances',
        type: 'table',
        table: 'leave_balances',
        roles: ['hr', 'manager'],
        columns: ['employee_id', 'leave_type', 'year', 'entitled_days', 'used_days'],
        icon: 'calculator',
      },
      {
        name: 'Holidays',
        type: 'table',
        table: 'holidays',
        roles: ['employee', 'manager', 'hr'],
        columns: ['name', 'on_date', 'kind'],
        icon: 'flag',
      },
      {
        name: 'Overview',
        type: 'dashboard',
        table: 'leave_requests',
        roles: ['hr'],
        icon: 'pie',
      },
    ],
    tour: [
      {
        role: 'employee',
        do: 'create',
        table: 'leave_requests',
        values: {
          leave_type: 'annual',
          starts_on: 14,
          ends_on: 16,
          days: 3,
          reason: 'Family wedding in Multan',
        },
        say: 'Fatima requests three days of annual leave.',
      },
      {
        role: 'manager',
        do: 'see',
        table: 'leave_requests',
        screen: 'Approvals',
        say: 'Kamran, her manager, finds the request on the approvals board.',
      },
      {
        role: 'manager',
        do: 'transition',
        table: 'leave_requests',
        transition: 'approve',
        say: 'Kamran approves it.',
      },
      {
        role: 'hr',
        do: 'see',
        table: 'leave_requests',
        screen: 'Team calendar',
        say: 'Mehwish in HR sees the approved leave on the team calendar.',
      },
      {
        role: 'employee',
        do: 'denied',
        table: 'leave_balances',
        action: 'update',
        say: 'Fatima tries to edit her own balance. The backend refuses.',
      },
      {
        role: 'hr',
        do: 'open',
        screen: 'Overview',
        say: 'Mehwish opens the overview to see approved days and what is still waiting.',
      },
    ],
  }),
};
/* Sales bidding: a team that bids on tenders. It shows an app with its own screens, its own team of agents and its own
   agent room (scores, price options, a go or no-go verdict). The saved Backend answer keeps one slip on purpose, so the
   Tester has something to catch and the repair loop is visible in Demo. Clients, tenders and prices are made up. */
// The bid desk's records start from its saved cases, which come later in the same object.
const bidCases = (): SavedCase[] => REC.biddesk.cases || [];
REC.biddesk = {
  ...CARDS.biddesk,
  usage: {
    research: [1310, 690, 6300],
    database: [2610, 3340, 16200],
    backend: [3720, 1480, 10100],
    views: [3090, 1420, 9300],
    ui: [4480, 1610, 11200],
  },
  say: {
    research: [
      'Reading the request. Bid managers prepare bids, a director approves them, finance looks on, and three agents assess each tender.',
      'Three roles, four kinds of record, one process on tenders, four rules.',
    ],
    database: ['Creating tables for tenders, score lines, price options and risks, with eight made-up tenders at different stages.'],
    backend: [
      'Writing the workflow from new to won, lost or no bid, the access rules, and the bid team: a Qualifier, Pricing and a Red team. The run pauses before the Red team so a person can add a condition.',
    ],
    views: [
      'Tenders have a status, a deadline and a value, so a pipeline board, a deadline calendar and a chart all fit. Risks sort by kind.',
      "For the agents' room I chose a scorecard with a weighted total, the price options side by side with the recommended one marked, and strengths, risks and conditions in groups. The verdict shows go or no-go with the chance of winning.",
    ],
    ui: [
      'Laying out the pages: a bid room where the agents work, the pipeline, a deadline calendar, an approvals list for the director, prices, risks and scores. Green, side navigation, and a shield for the icon.',
    ],
  },
  research: () => ({
    name: 'BidDesk',
    summary: "A sales team records tenders, assesses each one with three agents, and bids only with the director's approval.",
    roles: [
      {
        id: 'bid_manager',
        name: 'Bid manager',
        can: 'Records tenders and runs the bid team',
      },
      {
        id: 'director',
        name: 'Sales director',
        can: 'Approves or declines bids, records the result and removes tenders',
      },
      {
        id: 'finance',
        name: 'Finance analyst',
        can: 'Reads every tender, score and price, and changes nothing',
      },
    ],
    entities: [
      {
        name: 'tenders',
        what: 'A request for a bid from a client',
      },
      {
        name: 'score_lines',
        what: 'One criterion the tender was scored on',
      },
      {
        name: 'price_options',
        what: 'A price we could bid, with its margin and chance of winning',
      },
      {
        name: 'risks',
        what: 'A strength, a risk or a condition for bidding',
      },
    ],
    process: {
      entity: 'tenders',
      states: ['new', 'assessing', 'assessed', 'approved', 'won', 'lost', 'no_bid'],
      note: 'The agents take a tender from new to assessed. The director approves or declines, and later records the result.',
    },
    stories: [
      {
        role: 'bid_manager',
        want: 'know within minutes whether a tender is worth bidding on',
        so: 'the team does not write proposals it cannot win',
      },
      {
        role: 'bid_manager',
        want: 'see three prices with the margin and the chance of winning',
        so: 'I can defend the price I propose',
      },
      {
        role: 'director',
        want: 'approve a bid with the score, the price and the risks on one page',
        so: 'I decide in one look',
      },
      {
        role: 'director',
        want: 'see the pipeline by stage and what is due this week',
        so: 'no deadline is missed',
      },
      {
        role: 'finance',
        want: 'read every price and margin',
        so: 'I can plan revenue',
      },
    ],
    rules: [
      'Only the sales director approves a bid',
      'Only the sales director removes a tender',
      'Finance reads everything and changes nothing',
      'A tender needs a client and a deadline',
    ],
    question: null,
  }),
  database: () => {
    const T = [
      ['Fleet tracking for the port authority', 'Harbour Authority', 'Transport', 480000, 12, 1, 'new', 'undecided', null, null],
      ['Queue screens for the city hospital', 'City Hospital Trust', 'Health', 150000, 6, 2, 'new', 'undecided', null, null],
      [
        'Smart meters data platform',
        'Northern Power',
        'Energy',
        920000,
        20,
        1,
        'assessed',
        'bid_with_conditions',
        55,
        'Bid at the balanced price if the data migration is priced separately.',
      ],
      [
        'Bus timetable app',
        'Metro Transit',
        'Transport',
        210000,
        9,
        2,
        'approved',
        'bid',
        64,
        'A strong fit. Bid at the lean price to win the reference.',
      ],
      [
        'Patient reminders by text message',
        'Lakeside Clinics',
        'Health',
        95000,
        3,
        1,
        'approved',
        'bid',
        58,
        'Small, quick and repeatable. Bid.',
      ],
      ['Substation inspection tablets', 'Northern Power', 'Energy', 340000, -8, 2, 'won', 'bid', 61, 'Won on delivery time, not on price.'],
      [
        'Toll plaza reporting',
        'Highways Agency',
        'Transport',
        610000,
        -15,
        1,
        'lost',
        'bid_with_conditions',
        37,
        'Lost to the incumbent, who undercut by a fifth.',
      ],
      [
        'Ward staffing dashboard',
        'City Hospital Trust',
        'Health',
        130000,
        -4,
        2,
        'no_bid',
        'no_bid',
        18,
        'No capacity in the analytics team before the deadline.',
      ],
    ];
    const D: Dict<string> = {
      Transport:
        'The client wants live positions on a map, alerts for late arrivals and a monthly report. Delivery within four months of award.',
      Health:
        'The client wants a simple screen for staff and patients, text messages in two languages and no patient data leaving the country.',
      Energy: 'The client wants field data collected offline, synchronised overnight and shown on a dashboard for regional managers.',
    };
    const SC = ['Fit with what we sell', 'Team capacity', 'Relationship with the client', 'Competition', 'Time to the deadline'],
      W = [3, 2, 2, 2, 1],
      SV: Dict<number[]> = {
        3: [4, 3, 4, 3, 4],
        4: [5, 4, 3, 4, 3],
        5: [4, 5, 3, 3, 2],
      };
    const PO: Dict<(string | number | boolean)[][]> = {
      3: [
        ['Lean', 790000, 12, 61, false],
        ['Balanced', 868000, 20, 55, true],
        ['Full scope', 960000, 26, 31, false],
      ],
      4: [
        ['Lean', 186000, 13, 64, true],
        ['Balanced', 204000, 20, 52, false],
        ['Full scope', 228000, 27, 30, false],
      ],
      5: [
        ['Lean', 84000, 15, 63, false],
        ['Balanced', 92000, 22, 58, true],
        ['Full scope', 104000, 29, 34, false],
      ],
    };
    const RK = [
      [3, 'strength', 'We built the same collection app for a water utility', 'high'],
      [3, 'risk', 'Data migration from the old system is not described in the tender', 'high'],
      [3, 'condition', 'Bid only if migration is priced as a separate item', 'medium'],
      [4, 'strength', 'Two of our team have worked with this client', 'medium'],
      [4, 'risk', 'A fixed launch date before the school term', 'medium'],
      [5, 'strength', 'A product we can configure in days', 'high'],
      [5, 'risk', 'Text message costs are outside our control', 'low'],
      [5, 'condition', 'Cap the number of messages in the contract', 'low'],
    ];
    return {
      tables: [
        {
          name: 'tenders',
          label: 'Tenders',
          one: 'Tender',
          title: 'title',
          owner: 'bid_manager',
          columns: [
            {
              name: 'title',
              label: 'Title',
              type: 'text',
              required: true,
            },
            {
              name: 'client',
              label: 'Client',
              type: 'text',
              required: true,
            },
            {
              name: 'sector',
              label: 'Sector',
              type: 'text',
            },
            {
              name: 'description',
              label: 'What the client asks for',
              type: 'longtext',
              required: true,
            },
            {
              name: 'value',
              label: 'Estimated value',
              type: 'money',
            },
            {
              name: 'deadline',
              label: 'Deadline',
              type: 'date',
              required: true,
            },
            {
              name: 'bid_manager',
              label: 'Bid manager',
              type: 'user',
            },
            {
              name: 'status',
              label: 'Status',
              type: 'select',
              options: ['new', 'assessing', 'assessed', 'approved', 'won', 'lost', 'no_bid'],
            },
            {
              name: 'recommendation',
              label: 'Recommendation',
              type: 'select',
              options: ['undecided', 'bid', 'bid_with_conditions', 'no_bid'],
            },
            {
              name: 'win_chance',
              label: 'Chance of winning',
              type: 'number',
            },
            {
              name: 'summary',
              label: 'Verdict',
              type: 'longtext',
            },
          ],
          rows: T.map((t, i) => ({
            title: t[0],
            client: t[1],
            sector: t[2],
            description: i < 2 ? bidCases()[i].values.description : D[t[2] as string],
            value: t[3],
            deadline: t[4],
            bid_manager: t[5],
            status: t[6],
            recommendation: t[7],
            win_chance: t[8],
            summary: t[9],
          })),
        },
        {
          name: 'score_lines',
          label: 'Score lines',
          one: 'Score line',
          title: 'criterion',
          owner: null,
          columns: [
            {
              name: 'tender_id',
              label: 'Tender',
              type: 'ref',
              ref: 'tenders',
              required: true,
            },
            {
              name: 'criterion',
              label: 'Criterion',
              type: 'text',
              required: true,
            },
            {
              name: 'score',
              label: 'Score',
              type: 'number',
              required: true,
            },
            {
              name: 'weight',
              label: 'Weight',
              type: 'number',
            },
            {
              name: 'note',
              label: 'Why',
              type: 'longtext',
            },
          ],
          rows: ([] as Dict<unknown>[]).concat.apply(
            [],
            [3, 4, 5].map((id) =>
              SC.map((c, i) => ({
                tender_id: id,
                criterion: c,
                score: SV[id][i],
                weight: W[i],
                note: null,
              })),
            ),
          ),
        },
        {
          name: 'price_options',
          label: 'Price options',
          one: 'Price option',
          title: 'label',
          owner: null,
          columns: [
            {
              name: 'tender_id',
              label: 'Tender',
              type: 'ref',
              ref: 'tenders',
              required: true,
            },
            {
              name: 'label',
              label: 'Option',
              type: 'text',
              required: true,
            },
            {
              name: 'price',
              label: 'Price',
              type: 'money',
              required: true,
            },
            {
              name: 'margin',
              label: 'Margin %',
              type: 'number',
            },
            {
              name: 'win_chance',
              label: 'Chance of winning %',
              type: 'number',
            },
            {
              name: 'recommended',
              label: 'Recommended',
              type: 'bool',
            },
            {
              name: 'note',
              label: 'Why',
              type: 'longtext',
            },
          ],
          rows: ([] as Dict<unknown>[]).concat.apply(
            [],
            [3, 4, 5].map((id) =>
              PO[id].map((p) => ({
                tender_id: id,
                label: p[0],
                price: p[1],
                margin: p[2],
                win_chance: p[3],
                recommended: p[4],
                note: null,
              })),
            ),
          ),
        },
        {
          name: 'risks',
          label: 'Risks',
          one: 'Risk',
          title: 'risk',
          owner: null,
          columns: [
            {
              name: 'tender_id',
              label: 'Tender',
              type: 'ref',
              ref: 'tenders',
              required: true,
            },
            {
              name: 'kind',
              label: 'Kind',
              type: 'select',
              options: ['strength', 'risk', 'condition'],
              required: true,
            },
            {
              name: 'risk',
              label: 'Point',
              type: 'text',
              required: true,
            },
            {
              name: 'severity',
              label: 'Weight',
              type: 'select',
              options: ['high', 'medium', 'low'],
            },
          ],
          rows: RK.map((r) => ({
            tender_id: r[0],
            kind: r[1],
            risk: r[2],
            severity: r[3],
          })),
        },
      ],
      users: [
        {
          name: 'Sana Malik',
          role: 'bid_manager',
        },
        {
          name: 'Bilal Qureshi',
          role: 'bid_manager',
        },
        {
          name: 'Omar Farooq',
          role: 'director',
        },
        {
          name: 'Hira Siddiqui',
          role: 'finance',
        },
      ],
    };
  },
  backend: () => ({
    status: {
      table: 'tenders',
      column: 'status',
      initial: 'new',
      states: [
        {
          id: 'new',
          label: 'New',
          tone: 'neutral',
        },
        {
          id: 'assessing',
          label: 'Assessing',
          tone: 'warning',
        },
        {
          id: 'assessed',
          label: 'Awaiting approval',
          tone: 'info',
        },
        {
          id: 'approved',
          label: 'Approved to bid',
          tone: 'success',
        },
        {
          id: 'won',
          label: 'Won',
          tone: 'success',
        },
        {
          id: 'lost',
          label: 'Lost',
          tone: 'danger',
        },
        {
          id: 'no_bid',
          label: 'No bid',
          tone: 'neutral',
        },
      ],
      transitions: [
        {
          id: 'start_assessment',
          label: 'Start the assessment',
          from: ['new'],
          to: 'assessing',
          roles: ['bid_manager', 'director'],
        },
        {
          id: 'finish_assessment',
          label: 'Finish the assessment',
          from: ['assessing'],
          to: 'assessed',
          roles: ['bid_manager', 'director'],
        },
        {
          id: 'approve_bid',
          label: 'Approve the bid',
          from: ['assessed'],
          to: 'approved',
          roles: ['director'],
        },
        {
          id: 'decline_bid',
          label: 'Decline to bid',
          from: ['assessed', 'approved'],
          to: 'no_bid',
          roles: ['director'],
        },
        {
          id: 'mark_won',
          label: 'Record a win',
          from: ['approved'],
          to: 'won',
          roles: ['director'],
        },
        {
          id: 'mark_lost',
          label: 'Record a loss',
          from: ['approved'],
          to: 'lost',
          roles: ['director'],
        },
      ],
    },
    access: [
      {
        table: 'tenders',
        role: 'bid_manager',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'tenders',
        role: 'director',
        list: 'all',
        create: true,
        update: 'all',
        delete: true,
      },
      {
        table: 'tenders',
        role: 'finance',
        list: 'all',
        create: false,
        update: 'none',
        delete: false,
      },
    ].concat(
      ['score_lines', 'price_options', 'risks'].reduce<AccessRule[]>(
        (a, tn) =>
          a.concat([
            {
              table: tn,
              role: 'bid_manager',
              list: 'all',
              create: true,
              update: 'all',
              delete: false,
            },
            {
              table: tn,
              role: 'director',
              list: 'all',
              create: true,
              update: 'all',
              delete: true,
            },
            {
              table: tn,
              role: 'finance',
              list: 'all',
              create: false,
              update: 'none',
              delete: false,
            },
          ]),
        [],
      ),
    ),
    team: {
      title: 'Bid team',
      about:
        'Three agents assess one tender: is it worth bidding on, at what price, and what could go wrong. You can add a condition of your own before the verdict.',
      input: {
        table: 'tenders',
        column: 'description',
      },
      start: 'start_assessment',
      done: 'finish_assessment',
      agents: [
        {
          id: 'qualifier',
          name: 'Qualifier',
          icon: 'target',
          acc: 'royalBlue',
          job: 'Scores the tender from 0 to 5 on five criteria: fit, capacity, relationship, competition and time.',
          hint: 'One row per criterion, with "weight" from 1 to 3.',
          writes: 'score_lines',
        },
        {
          id: 'pricer',
          name: 'Pricing',
          icon: 'calculator',
          acc: 'forest',
          job: 'Works out three prices with the margin and the chance of winning for each, and marks one as recommended.',
          hint: 'Exactly three rows, and exactly one with "recommended" true.',
          writes: 'price_options',
        },
        {
          id: 'red_team',
          name: 'Red team',
          icon: 'shield',
          acc: 'cranberry',
          job: 'Challenges the bid: strengths, risks and conditions, then a go or no-go with the chance of winning.',
          hint: 'Use kind "strength", "risk" or "condition".',
          writes: 'risks',
          sets: ['recommendation', 'win_chance', 'summary'],
        },
      ],
      pause: {
        before: 'red_team',
        text: 'Scores and prices are in. Add a risk or a condition of your own before the Red team gives its verdict, or continue.',
      },
      jump: {
        table: 'risks',
        column: 'risk',
        set: {
          kind: 'condition',
          severity: 'medium',
        },
        label: 'Add a condition or a risk',
      },
      samples: bidCases().map((c) => ({
        label: c.label,
        values: c.values,
      })),
    },
  }),
  views: () => ({
    views: [
      {
        table: 'tenders',
        use: [
          {
            type: 'board',
            by: 'status',
            why: 'A tender moves from new to won or lost.',
          },
          {
            type: 'calendar',
            date: 'deadline',
            why: 'Every tender has a deadline that cannot move.',
          },
          {
            type: 'table',
            why: 'For sorting by value and client.',
          },
          {
            type: 'chart',
            x: 'status',
            split: 'recommendation',
            why: 'How the recommendations spread across the pipeline.',
          },
          {
            type: 'cards',
            why: 'A tender and its verdict read well on a card.',
          },
          {
            type: 'timeline',
            start: 'deadline',
            lane: 'bid_manager',
            why: 'Deadlines per bid manager.',
          },
        ],
      },
      {
        table: 'score_lines',
        use: [
          {
            type: 'table',
            why: 'Scores are numbers to scan.',
          },
          {
            type: 'tree',
            levels: ['tender_id'],
            why: 'Score lines belong to a tender.',
          },
          {
            type: 'cards',
            why: 'One criterion per card.',
          },
        ],
      },
      {
        table: 'price_options',
        use: [
          {
            type: 'cards',
            why: 'Three options side by side.',
          },
          {
            type: 'table',
            why: 'For comparing margins.',
          },
          {
            type: 'tree',
            levels: ['tender_id'],
            why: 'Options belong to a tender.',
          },
        ],
      },
      {
        table: 'risks',
        use: [
          {
            type: 'board',
            by: 'kind',
            why: 'Strengths, risks and conditions as columns.',
          },
          {
            type: 'table',
            why: 'Everything in one list.',
          },
          {
            type: 'tree',
            levels: ['tender_id', 'kind'],
            why: 'Points nested under their tender.',
          },
          {
            type: 'chart',
            x: 'kind',
            split: 'severity',
            why: 'How heavy the risks are.',
          },
        ],
      },
    ],
    board: {
      why: 'The agents produce a score, three prices and a list of points, so the room shows a scorecard with a weighted total, the price options side by side with the recommended one marked, and the points in groups. The verdict leads with go or no-go and the chance of winning.',
      verdict: {
        pick: 'recommendation',
        meter: 'win_chance',
        text: 'summary',
      },
      panels: [
        {
          table: 'score_lines',
          layout: 'scores',
          title: 'Is it worth bidding on?',
          score: 'score',
          weight: 'weight',
          max: 5,
          text: 'note',
        },
        {
          table: 'price_options',
          layout: 'options',
          title: 'What price?',
          facts: ['price', 'margin', 'win_chance'],
          flag: 'recommended',
          text: 'note',
        },
        {
          table: 'risks',
          layout: 'groups',
          title: 'What could go wrong?',
          by: 'kind',
        },
      ],
    },
    dashboard: {
      title: 'Bid pipeline',
      date: {
        table: 'tenders',
        column: 'deadline',
      },
      widgets: [
        {
          kind: 'kpi',
          label: 'Tenders',
          table: 'tenders',
        },
        {
          kind: 'kpi',
          label: 'Awaiting approval',
          table: 'tenders',
          where: {
            status: 'assessed',
          },
        },
        {
          kind: 'kpi',
          label: 'Pipeline value',
          table: 'tenders',
          measure: 'sum:value',
        },
        {
          kind: 'kpi',
          label: 'Won',
          table: 'tenders',
          where: {
            status: 'won',
          },
        },
        {
          kind: 'bar',
          label: 'Tenders by stage',
          table: 'tenders',
          x: 'status',
        },
        {
          kind: 'stack',
          label: 'Recommendation by stage',
          table: 'tenders',
          x: 'status',
          split: 'recommendation',
        },
        {
          kind: 'bar',
          label: 'Points by kind',
          table: 'risks',
          x: 'kind',
        },
        {
          kind: 'line',
          label: 'Deadlines by week',
          table: 'tenders',
          x: 'deadline',
          bucket: 'week',
        },
        {
          kind: 'recent',
          label: 'Latest tenders',
          table: 'tenders',
        },
      ],
    },
  }),
  ui: () => ({
    theme: {
      accent: 'forest',
      nav: 'side',
      icon: 'briefcase',
      logo: {
        shape: 'shield',
        fill: 'gradient',
        mark: 'spark',
      },
    },
    screens: [
      {
        name: 'Bid room',
        type: 'agents',
        table: 'tenders',
        roles: ['bid_manager', 'director'],
        icon: 'bot',
      },
      {
        name: 'Pipeline',
        type: 'board',
        table: 'tenders',
        roles: ['bid_manager', 'director', 'finance'],
        group: 'status',
        columns: ['client', 'value', 'deadline', 'recommendation'],
        icon: 'board',
      },
      {
        name: 'Deadlines',
        type: 'calendar',
        table: 'tenders',
        roles: ['bid_manager', 'director'],
        columns: ['title', 'client', 'status'],
        icon: 'calendar',
      },
      {
        name: 'Approvals',
        type: 'table',
        table: 'tenders',
        roles: ['director'],
        columns: ['title', 'client', 'value', 'win_chance', 'recommendation', 'status'],
        icon: 'approved',
      },
      {
        name: 'Prices',
        type: 'cards',
        table: 'price_options',
        roles: ['bid_manager', 'director', 'finance'],
        columns: ['label', 'price', 'margin', 'win_chance', 'tender_id'],
        icon: 'money',
      },
      {
        name: 'Risks',
        type: 'board',
        table: 'risks',
        roles: ['bid_manager', 'director', 'finance'],
        group: 'kind',
        columns: ['severity', 'tender_id'],
        icon: 'warning',
      },
      {
        name: 'Scores',
        type: 'table',
        table: 'score_lines',
        roles: ['bid_manager', 'director', 'finance'],
        columns: ['criterion', 'score', 'weight', 'tender_id'],
        icon: 'target',
      },
    ],
    tour: [
      {
        role: 'bid_manager',
        do: 'create',
        table: 'tenders',
        values: {
          title: 'Parking permits portal',
          client: 'Riverside Council',
          sector: 'Transport',
          description: 'The council wants residents to buy and renew parking permits online, with a back office for wardens.',
          value: 260000,
          deadline: 14,
        },
        say: 'Sana, a bid manager, records a new tender.',
      },
      {
        role: 'director',
        do: 'see',
        table: 'tenders',
        screen: 'Pipeline',
        say: 'Omar, the sales director, sees it in the pipeline.',
      },
      {
        role: 'bid_manager',
        do: 'transition',
        table: 'tenders',
        transition: 'start_assessment',
        say: 'Sana starts the assessment. In the bid room the three agents take it from here.',
      },
      {
        role: 'bid_manager',
        do: 'transition',
        table: 'tenders',
        transition: 'finish_assessment',
        say: 'The assessment is finished and the bid waits for approval.',
      },
      {
        role: 'bid_manager',
        do: 'denied',
        table: 'tenders',
        action: 'approve_bid',
        say: "Sana tries to approve her own bid. The backend refuses, because that is the director's decision.",
      },
      {
        role: 'director',
        do: 'transition',
        table: 'tenders',
        transition: 'approve_bid',
        say: 'Omar approves the bid.',
      },
      {
        role: 'finance',
        do: 'denied',
        table: 'price_options',
        action: 'create',
        say: 'Hira, a finance analyst, tries to add a price option. The backend refuses.',
      },
    ],
  }),
  tester: () => ({
    cases: [
      {
        name: 'Only the sales director approves a bid',
        why: 'Rule in the brief: only the sales director approves a bid.',
        steps: [
          {
            role: 'bid_manager',
            do: 'create',
            table: 'tenders',
            values: {
              title: 'Library self-checkout',
              client: 'County Libraries',
              sector: 'Health',
              description: 'Self-service kiosks for twelve branches, with a report for the head librarian.',
              value: 175000,
              deadline: 10,
            },
            say: 'Sana records a tender.',
          },
          {
            role: 'bid_manager',
            do: 'transition',
            table: 'tenders',
            transition: 'start_assessment',
            say: 'Sana starts the assessment.',
          },
          {
            role: 'bid_manager',
            do: 'transition',
            table: 'tenders',
            transition: 'finish_assessment',
            say: 'Sana finishes it.',
          },
          {
            role: 'bid_manager',
            do: 'denied',
            table: 'tenders',
            action: 'approve_bid',
            say: 'Sana tries to approve it and is refused.',
          },
          {
            role: 'director',
            do: 'transition',
            table: 'tenders',
            transition: 'approve_bid',
            say: 'Omar approves it.',
          },
        ],
      },
      {
        name: 'A bid manager cannot remove a tender',
        why: 'Rule in the brief: only the sales director removes a tender.',
        steps: [
          {
            role: 'bid_manager',
            do: 'denied',
            table: 'tenders',
            action: 'delete',
            say: 'Sana tries to delete a tender and must be refused.',
          },
        ],
      },
      {
        name: 'Finance reads everything and changes nothing',
        why: 'Rule in the brief: finance reads everything and changes nothing.',
        steps: [
          {
            role: 'finance',
            do: 'open',
            screen: 'Pipeline',
            say: 'Hira opens the pipeline.',
          },
          {
            role: 'finance',
            do: 'denied',
            table: 'tenders',
            action: 'create',
            say: 'Hira tries to add a tender.',
          },
          {
            role: 'finance',
            do: 'denied',
            table: 'price_options',
            action: 'update',
            say: 'Hira tries to change a price.',
          },
          {
            role: 'finance',
            do: 'denied',
            table: 'risks',
            action: 'delete',
            say: 'Hira tries to delete a risk.',
          },
        ],
      },
      {
        name: 'A tender without a client and a deadline is refused',
        why: 'Rule in the brief: a tender needs a client and a deadline.',
        steps: [
          {
            role: 'bid_manager',
            do: 'invalid',
            table: 'tenders',
            values: {
              title: 'Untitled tender',
            },
            say: 'Sana tries to save a tender with only a title.',
          },
        ],
      },
      {
        name: 'Finance cannot start the bid team',
        why: 'User story: bid managers run the assessment. Finance only reads.',
        steps: [
          {
            role: 'finance',
            do: 'denied',
            table: 'tenders',
            action: 'start_assessment',
            say: 'Hira tries to start an assessment and is refused.',
          },
        ],
      },
      {
        name: 'The director sees a tender as soon as it is recorded',
        why: 'User story: the director sees the pipeline by stage.',
        steps: [
          {
            role: 'bid_manager',
            do: 'create',
            table: 'tenders',
            values: {
              title: 'Depot access control',
              client: 'Metro Transit',
              sector: 'Transport',
              description: 'Badge readers and a visitor log for four depots.',
              value: 88000,
              deadline: 21,
            },
            say: 'Bilal records a tender.',
          },
          {
            role: 'director',
            do: 'see',
            table: 'tenders',
            say: 'Omar finds it in his list.',
          },
        ],
      },
    ],
  }),
  cases: [
    {
      label: 'Port fleet tracking',
      values: {
        title: 'Fleet tracking for the port authority',
        client: 'Harbour Authority',
        sector: 'Transport',
        description:
          'The port wants live positions for 140 vehicles on a map, alerts when a vehicle leaves its zone, and a monthly report. Delivery within four months of award.',
        value: 480000,
        deadline: 12,
      },
      script: [
        {
          agent: 'qualifier',
          say: 'Scored on five criteria. The fit is excellent and the competition is the weak spot.',
          rows: [
            {
              criterion: 'Fit with what we sell',
              score: 5,
              weight: 3,
              note: 'Our tracking product covers the map, the zones and the report without custom work.',
            },
            {
              criterion: 'Team capacity',
              score: 3,
              weight: 2,
              note: 'The integration team is booked until the end of next month.',
            },
            {
              criterion: 'Relationship with the client',
              score: 4,
              weight: 2,
              note: 'We delivered their gate system two years ago.',
            },
            {
              criterion: 'Competition',
              score: 2,
              weight: 2,
              note: 'The incumbent supplier knows the site and can price low.',
            },
            {
              criterion: 'Time to the deadline',
              score: 3,
              weight: 1,
              note: 'Twelve days is enough for a proposal built on the standard product.',
            },
          ],
        },
        {
          agent: 'pricer',
          say: 'Three prices. I recommend the balanced one: the lean price wins more often but leaves too little margin.',
          rows: [
            {
              label: 'Lean',
              price: 398000,
              margin: 14,
              win_chance: 62,
              recommended: false,
              note: 'Standard product only, client hosts it.',
            },
            {
              label: 'Balanced',
              price: 436000,
              margin: 21,
              win_chance: 48,
              recommended: true,
              note: 'Standard product, hosting and one year of support.',
            },
            {
              label: 'Full scope',
              price: 495000,
              margin: 27,
              win_chance: 28,
              recommended: false,
              note: 'Adds custom reports and on-site training.',
            },
          ],
        },
        {
          agent: 'red_team',
          say: 'Worth bidding, with one condition on the start date.',
          rows: [
            {
              kind: 'strength',
              risk: 'We run the same product for two other ports',
              severity: 'high',
            },
            {
              kind: 'risk',
              risk: 'The incumbent can undercut us on price',
              severity: 'high',
            },
            {
              kind: 'risk',
              risk: 'Our integration team is booked until the end of next month',
              severity: 'medium',
            },
            {
              kind: 'condition',
              risk: 'Bid only if delivery can start six weeks after award',
              severity: 'medium',
            },
          ],
          jumped: {
            say: 'I also weighed the point added by the team.',
            rows: [
              {
                kind: 'condition',
                risk: 'From the team: {{jump}}',
                severity: 'medium',
              },
            ],
          },
          summary: {
            recommendation: 'bid_with_conditions',
            win_chance: 48,
            summary:
              'Bid at the balanced price, on the condition that delivery starts six weeks after award. The fit is strong; the incumbent is the main threat.',
          },
        },
      ],
    },
    {
      label: 'Hospital queue screens',
      values: {
        title: 'Queue screens for the city hospital',
        client: 'City Hospital Trust',
        sector: 'Health',
        description: 'The hospital wants queue screens in six departments, text messages in two languages and a go-live in five weeks.',
        value: 150000,
        deadline: 6,
      },
      script: [
        {
          agent: 'qualifier',
          say: 'Scored on five criteria. Capacity and time are both poor.',
          rows: [
            {
              criterion: 'Fit with what we sell',
              score: 3,
              weight: 3,
              note: 'Screens are standard. Two-language messaging is new work.',
            },
            {
              criterion: 'Team capacity',
              score: 1,
              weight: 2,
              note: 'Nobody is free before the go-live date.',
            },
            {
              criterion: 'Relationship with the client',
              score: 2,
              weight: 2,
              note: 'One earlier bid, which we lost.',
            },
            {
              criterion: 'Competition',
              score: 2,
              weight: 2,
              note: 'Two local firms sell this as a product.',
            },
            {
              criterion: 'Time to the deadline',
              score: 1,
              weight: 1,
              note: 'Six days to bid and five weeks to deliver.',
            },
          ],
        },
        {
          agent: 'pricer',
          say: 'Three prices. None of them combines a fair margin with a real chance.',
          rows: [
            {
              label: 'Lean',
              price: 121000,
              margin: 6,
              win_chance: 34,
              recommended: false,
              note: 'Below our usual margin.',
            },
            {
              label: 'Balanced',
              price: 139000,
              margin: 15,
              win_chance: 21,
              recommended: true,
              note: 'The only price that covers the new messaging work.',
            },
            {
              label: 'Full scope',
              price: 158000,
              margin: 22,
              win_chance: 9,
              recommended: false,
              note: 'Above the estimated value.',
            },
          ],
        },
        {
          agent: 'red_team',
          say: 'I would not bid on this one.',
          rows: [
            {
              kind: 'risk',
              risk: 'A five-week go-live with no free team',
              severity: 'high',
            },
            {
              kind: 'risk',
              risk: 'Two-language messaging has never been delivered by us',
              severity: 'medium',
            },
            {
              kind: 'strength',
              risk: 'The screens themselves are a standard product',
              severity: 'low',
            },
          ],
          jumped: {
            say: 'I also weighed the point added by the team.',
            rows: [
              {
                kind: 'condition',
                risk: 'From the team: {{jump}}',
                severity: 'medium',
              },
            ],
          },
          summary: {
            recommendation: 'no_bid',
            win_chance: 21,
            summary: 'Do not bid. The score is low, the team is booked and the best price has a one in five chance.',
          },
        },
      ],
    },
  ],
};
