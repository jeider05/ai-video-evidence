// Overlay markup shared by both recorders.
// Playwright mode passes the HTML to page.screencast.showOverlay(); gdigrab mode mounts it in the
// page DOM with domOverlay() through page.evaluate(), because a desktop grab has no overlay layer.

const KIND_STYLE = {
  actual: { color: '#b42318', label: 'Actual' },
  expected: { color: '#067647', label: 'Esperado' },
  info: { color: '#175cd3', label: 'Nota' },
};

/** Color of the full-viewport calibration box used to locate the page on screen (gdigrab). */
export const CALIBRATION_COLOR = { r: 255, g: 0, b: 255 };

export const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function captionHtml(text) {
  return `<div style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);max-width:80%;` +
    `padding:10px 18px;border-radius:8px;background:rgba(16,24,40,.82);color:#fff;` +
    `font:500 20px/1.35 system-ui,Segoe UI,sans-serif;text-align:center;">${escapeHtml(text)}</div>`;
}

export function calloutHtml({ kind = 'info', title, text, html }) {
  const k = KIND_STYLE[kind] ?? KIND_STYLE.info;
  const body = html ?? `<div>${escapeHtml(text)}</div>`;
  return `<div style="position:fixed;top:24px;left:24px;max-width:46%;padding:14px 18px;border-radius:10px;` +
    `background:#fff;border:3px solid ${k.color};box-shadow:0 8px 24px rgba(0,0,0,.25);` +
    `font:500 18px/1.4 system-ui,Segoe UI,sans-serif;color:#101828;">` +
    `<div style="font-weight:700;color:${k.color};margin-bottom:6px;">${escapeHtml(title ?? k.label)}</div>${body}</div>`;
}

/** Centered title card over a blurred backdrop (the gdigrab counterpart of screencast.showChapter). */
export function chapterHtml({ title, description }) {
  const desc = description
    ? `<div style="margin-top:10px;font:500 20px/1.4 system-ui,Segoe UI,sans-serif;color:#475467;">${escapeHtml(description)}</div>`
    : '';
  return `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;` +
    `background:rgba(16,24,40,.35);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">` +
    `<div style="max-width:60%;padding:28px 40px;border-radius:16px;background:rgba(255,255,255,.96);` +
    `box-shadow:0 16px 48px rgba(0,0,0,.3);text-align:center;">` +
    `<div style="font:700 34px/1.25 system-ui,Segoe UI,sans-serif;color:#101828;">${escapeHtml(title)}</div>${desc}</div></div>`;
}

export function calibrationHtml() {
  const { r, g, b } = CALIBRATION_COLOR;
  return `<div style="position:fixed;inset:0;background:rgb(${r},${g},${b});"></div>`;
}

/**
 * Browser-side helper, passed to page.evaluate(domOverlay, { op, id, html, durationMs }).
 * It must stay self-contained (it is serialized into the page).
 * op "mount" replaces the element with that id; op "remove" deletes it.
 * The host never intercepts clicks and sits above everything.
 */
export function domOverlay({ op, id, html, durationMs }) {
  const old = document.getElementById(id);
  if (old) old.remove();
  if (op !== 'mount') return true;
  const host = document.createElement('div');
  host.id = id;
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
  host.innerHTML = html;
  (document.body || document.documentElement).appendChild(host);
  if (durationMs) setTimeout(() => host.remove(), durationMs);
  return true;
}
