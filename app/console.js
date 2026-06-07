/**
 * Debug Console for Engineer Scheduler Widget
 * Provides a visual log panel for debugging API calls.
 */

function log(label, data, type = 'info') {
  const body = document.getElementById('consoleBody');
  const empty = document.getElementById('emptyState');
  if (empty) empty.remove();

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;

  const text = typeof data === 'object'
    ? JSON.stringify(data, null, 2)
    : String(data);

  entry.innerHTML = `
    <div class="log-label">${escapeHtml(label)}</div>
    <div class="log-text">${escapeHtml(text)}</div>
  `;

  body.appendChild(entry);
  body.scrollTop = body.scrollHeight;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&')
    .replace(/</g, '<')
    .replace(/>/g, '>')
    .replace(/"/g, '"');
}

// Intercept native console.log / console.error / console.warn
const _nativeLog = console.log.bind(console);
const _nativeError = console.error.bind(console);
const _nativeWarn = console.warn.bind(console);

console.log = function(...args) {
  _nativeLog(...args);
  const msg = args.length === 1 ? args[0] : args;
  log('console.log', msg, 'info');
};

console.error = function(...args) {
  _nativeError(...args);
  const msg = args.length === 1 ? args[0] : args;
  log('console.error', msg, 'error');
};

console.warn = function(...args) {
  _nativeWarn(...args);
  const msg = args.length === 1 ? args[0] : args;
  log('console.warn', msg, 'warn');
};

// Toggle console visibility
document.addEventListener('DOMContentLoaded', function() {
  const toggleBtn = document.getElementById('consoleToggle');
  const panel = document.getElementById('consolePanel');
  const arrow = document.getElementById('consoleArrow');
  const clearBtn = document.getElementById('clearConsole');

  if (toggleBtn && panel) {
    toggleBtn.addEventListener('click', function() {
      panel.classList.toggle('open');
      if (arrow) arrow.classList.toggle('open');
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', function() {
      const body = document.getElementById('consoleBody');
      if (body) {
        body.innerHTML = '<div class="empty-state" id="emptyState">Console cleared.</div>';
      }
    });
  }
});