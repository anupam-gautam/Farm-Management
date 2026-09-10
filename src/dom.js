// Small shared DOM helpers.

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Show a translated toast near the top of the screen; auto-dismisses. */
export function toast(message, kind = 'ok') {
  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.className = `fixed top-16 left-1/2 -translate-x-1/2 z-[60] px-5 py-3 rounded-xl shadow-lg font-semibold border-2 ${
    kind === 'ok'
      ? 'bg-green-50 border-farm-greenLight text-farm-green'
      : 'bg-red-50 border-farm-urgent text-farm-urgent'
  }`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}
