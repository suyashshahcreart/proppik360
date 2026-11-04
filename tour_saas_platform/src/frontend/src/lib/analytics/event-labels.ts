const MAP: Record<string, string> = {
  session_start: 'Session started',
  page_view: 'Page view',
  tour_ready: 'Tour ready',
  scene_enter: 'Scene change',
  scene_exit: 'Scene exit',
  pano_rotate: '360° rotations',
  pano_zoom: 'Zooms',
  nav_arrow_click: 'Arrow navigation',
  marker_click: 'Info points opened',
  info_open: 'Info panel opened',
  info_close: 'Info panel closed',
  cta_click: 'CTA clicks',
  form_view: 'Lead form viewed',
  form_start: 'Lead form started',
  form_submit: 'Lead form submits',
  ui_action: 'Controls used',
  autorotate: 'Autorotate',
  session_end: 'Session ended',
  visibility: 'Tab visibility',
}

const INTERACTION_WHITELIST = new Set([
  'scene_enter',
  'pano_rotate',
  'pano_zoom',
  'nav_arrow_click',
  'info_open',
  'cta_click',
  'form_view',
  'form_start',
  'form_submit',
  'ui_action',
  'autorotate',
])

export function isVisitorInteractionEvent(t: string): boolean {
  return INTERACTION_WHITELIST.has(t)
}

export function labelForEvent(t: string): string {
  return MAP[t] || t.replace(/_/g, ' ')
}
