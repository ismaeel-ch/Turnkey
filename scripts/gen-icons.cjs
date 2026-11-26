// Extracts the Fluent System Icons the workspace uses into src/workspace/icons.ts.
// Only needed when an icon is added: `npm install --no-save @fluentui/svg-icons && npm run icons`.
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..', 'node_modules', '@fluentui', 'svg-icons', 'icons');
const want = {
  dbSearch: 'database_search_20_regular', options: 'options_20_regular', shieldKey: 'shield_keyhole_20_regular', textEdit: 'text_edit_style_20_regular', addSquare: 'add_square_20_regular', approved: 'person_available_20_regular', glasses: 'glasses_20_regular',
  fit: 'zoom_fit_20_regular', map: 'map_20_regular', share: 'share_20_regular', qr: 'qr_code_20_regular', beaker: 'beaker_20_regular', guest: 'guest_20_regular', bookOpen: 'book_open_20_regular', moreV: 'more_vertical_20_regular', addCircle: 'add_circle_20_filled', homeFilled: 'home_20_filled',
  add: 'add_20_regular', dismiss: 'dismiss_20_regular', chevDown: 'chevron_down_20_regular', chevRight: 'chevron_right_20_regular',
  chevLeft: 'chevron_left_20_regular', chevUp: 'chevron_up_20_regular', more: 'more_horizontal_20_regular', search: 'search_20_regular',
  settings: 'settings_20_regular', help: 'question_circle_20_regular', bug: 'bug_20_regular', play: 'play_20_filled', stop: 'stop_20_filled',
  rerun: 'arrow_clockwise_20_regular', undo: 'arrow_undo_20_regular', arrowRight: 'arrow_right_20_regular', arrowLeft: 'arrow_left_20_regular',
  download: 'arrow_download_20_regular', copy: 'copy_20_regular', trash: 'delete_20_regular', edit: 'edit_20_regular', check: 'checkmark_20_regular',
  checkCircle: 'checkmark_circle_20_filled', errorCircle: 'dismiss_circle_20_filled', warning: 'warning_20_filled', info: 'info_20_regular',
  send: 'send_20_filled', person: 'person_20_regular', people: 'people_20_regular', signOut: 'sign_out_20_regular', lock: 'lock_closed_20_regular',
  key: 'key_20_regular', eye: 'eye_20_regular', wifiOff: 'wifi_off_20_regular', wifi: 'wifi_1_20_regular', desktop: 'desktop_20_regular',
  install: 'desktop_arrow_down_20_regular', window: 'window_20_regular', panelRight: 'panel_right_20_regular', open: 'open_20_regular',
  home: 'home_20_regular', apps: 'apps_20_regular', grid: 'grid_20_regular', table: 'table_20_regular', board: 'board_20_regular',
  calendar: 'calendar_ltr_20_regular', dashboard: 'data_bar_vertical_20_regular', form: 'form_20_regular', database: 'database_20_regular',
  server: 'server_20_regular', plug: 'plug_connected_20_regular', plugOff: 'plug_disconnected_20_regular', flow: 'flow_20_regular',
  bot: 'bot_20_regular', sparkle: 'sparkle_20_regular', design: 'design_ideas_20_regular', code: 'code_20_regular', braces: 'braces_20_regular',
  document: 'document_text_20_regular', clipboard: 'clipboard_task_20_regular', shield: 'shield_checkmark_20_regular', timeline: 'timeline_20_regular',
  list: 'text_bullet_list_ltr_20_regular', history: 'history_20_regular', clock: 'clock_20_regular', lightbulb: 'lightbulb_20_regular',
  compass: 'compass_northwest_20_regular', flag: 'flag_20_regular', star: 'star_20_regular', filter: 'filter_20_regular', sort: 'arrow_sort_20_regular',
  link: 'link_20_regular', globe: 'globe_20_regular', cloud: 'cloud_20_regular', cloudOff: 'cloud_off_20_regular', wrench: 'wrench_20_regular',
  rocket: 'rocket_20_regular', color: 'color_20_regular', dark: 'dark_theme_20_regular', reset: 'arrow_reset_20_regular', save: 'save_20_regular',
  tag: 'tag_20_regular', book: 'book_20_regular', stethoscope: 'stethoscope_20_regular', headset: 'headset_20_regular', beach: 'beach_20_regular',
  box: 'box_20_regular', building: 'building_20_regular', briefcase: 'briefcase_20_regular', mail: 'mail_20_regular', call: 'call_20_regular',
  money: 'money_20_regular', cart: 'cart_20_regular', heart: 'heart_pulse_20_regular', ticket: 'ticket_diagonal_20_regular',
  split: 'split_vertical_20_regular', maximize: 'full_screen_maximize_20_regular', minimize: 'subtract_20_regular', chat: 'chat_20_regular',
  menu: 'navigation_20_regular', pulse: 'pulse_20_regular', gauge: 'gauge_20_regular', storage: 'storage_20_regular', production: 'production_20_regular',
  devtools: 'window_dev_tools_20_regular', broom: 'broom_20_regular', circle: 'circle_20_regular', personSwap: 'person_swap_20_regular',
  sync: 'arrow_sync_20_regular', tasks: 'task_list_ltr_20_regular', comment: 'comment_20_regular', note: 'note_20_regular', receipt: 'receipt_20_regular',
  hourglass: 'hourglass_half_20_regular', target: 'target_20_regular', trending: 'arrow_trending_20_regular', pie: 'data_pie_20_regular',
  swap: 'arrow_swap_20_regular', wand: 'wand_20_regular', forward: 'arrow_forward_20_regular', tab: 'tab_desktop_20_regular', phone: 'phone_20_regular',
  alert: 'alert_20_regular', pause: 'pause_20_filled', fast: 'fast_forward_20_regular', infoFilled: 'info_20_filled', arrowUp: 'arrow_up_20_regular',
  arrowDown: 'arrow_down_20_regular', drag: 're_order_dots_vertical_20_regular', graduation: 'hat_graduation_20_regular', food: 'food_20_regular',
  car: 'vehicle_car_20_regular', dumbbell: 'dumbbell_20_regular', leaf: 'leaf_two_20_regular', paw: 'animal_dog_20_regular', airplane: 'airplane_20_regular',
  bed: 'bed_20_regular', library: 'library_20_regular', scales: 'scales_20_regular', team: 'people_team_20_regular', certificate: 'certificate_20_regular',
  payment: 'payment_20_regular', calculator: 'calculator_20_regular', pill: 'pill_20_regular', camera: 'camera_20_regular', music: 'music_note_2_20_regular',
  wrenchScrew: 'wrench_screwdriver_20_regular', truck: 'vehicle_truck_profile_20_regular', location: 'location_20_regular', keyboard: 'keyboard_20_regular',
  checkbox: 'checkbox_checked_20_regular', square: 'square_20_regular', expand: 'arrow_maximize_20_regular', eyeOff: 'eye_off_20_regular',
  layout: 'apps_list_detail_20_regular', number: 'number_symbol_20_regular', text: 'text_t_20_regular', toggle: 'toggle_left_20_regular',
  record: 'record_20_regular', handRight: 'hand_right_20_regular', cursor: 'cursor_click_20_regular', appFolder: 'app_folder_20_regular',
  playOutline: 'play_20_regular', questionChat: 'chat_help_20_regular', dataUsage: 'data_usage_20_regular', branch: 'branch_20_regular',
  attach: 'attach_20_regular', notebook: 'notebook_20_regular', doctor: 'doctor_20_regular', clockAlarm: 'clock_alarm_20_regular',
  arrowExport: 'arrow_export_ltr_20_regular', lockOpen: 'lock_open_20_regular', personAdd: 'person_add_20_regular', error: 'error_circle_20_regular',
  checkCircleO: 'checkmark_circle_20_regular', starFilled: 'star_20_filled', circleFilled: 'circle_20_filled', sparkleFilled: 'sparkle_20_filled',
  slide: 'slide_text_20_regular', power: 'power_20_regular', puzzle: 'puzzle_piece_20_regular', layer: 'layer_20_regular'
};
const out = {}; const missing = [];
for (const [k, f] of Object.entries(want)) {
  const p = path.join(dir, f + '.svg');
  if (!fs.existsSync(p)) { missing.push(k + ':' + f); continue; }
  let s = fs.readFileSync(p, 'utf8');
  s = s.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/\sfill="[^"]*"/g, '').replace(/\n\s*/g, '').trim();
  out[k] = s;
}
const js = '// Fluent System Icons (MIT), 20px. Generated by scripts/gen-icons.cjs\nexport const ICONS: Record<string, string> = ' + JSON.stringify(out) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'src', 'workspace', 'icons.ts'), js);
console.log('icons:', Object.keys(out).length, 'bytes:', js.length);
if (missing.length) console.log('MISSING:', missing.join(' '));
