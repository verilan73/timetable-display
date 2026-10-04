'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/**
 * Loads the <script> contents of Index.html into a fresh Node vm context.
 *
 * Only a handful of functions in Index.html are actually pure (subjectColour,
 * formatTime, rowHeight, densityClass) — everything else (teacher filtering,
 * step-through navigation, rendering) is deeply entangled with the DOM and
 * google.script.run, and isn't practically unit-testable this way. Those are
 * better covered by manual /dev smoke-testing, same reasoning as the
 * XmlService-dependent backend functions.
 *
 * The script runs init() unconditionally at load time (the last line of the
 * file), so a handful of no-op DOM/google stubs are provided purely to let
 * the file finish loading without throwing — not to make the DOM-dependent
 * functions meaningfully testable.
 *
 * @returns {object} The vm context — pure top-level functions are properties
 *   on it (e.g. context.subjectColour).
 */
function loadFrontend() {
  const html = fs.readFileSync(path.join(__dirname, '..', '..', 'Index.html'), 'utf8');
  const match = html.match(/<script>([\s\S]*)<\/script>/);
  if (!match) throw new Error('Could not find <script> block in Index.html');
  const code = match[1];

  const fakeElement = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {},
    appendChild() {},
    querySelectorAll: () => [],
    querySelector: () => null,
  });

  const context = {
    // Index.html builds its localStorage keys from location.pathname at load time.
    window: { location: { pathname: '/test', search: '' } },
    document: {
      getElementById: fakeElement,
      querySelectorAll: () => [],
      createElement: fakeElement,
    },
    google: undefined,
    // The current-time indicator starts a refresh timer at load; tests don't need it to fire.
    setInterval: () => 0,
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'Index.html script' });
  return context;
}

module.exports = { loadFrontend };
