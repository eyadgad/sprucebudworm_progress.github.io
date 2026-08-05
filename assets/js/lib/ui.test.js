/* Tests for the Modal lifecycle.
   Run:  node assets/js/lib/ui.test.js     (from the site folder)

   These cover three bugs found in review, all of which left the page in a
   broken state rather than merely looking wrong:
     1. the key handler outlived the dialog, so a closed dialog reopened on an
        arrow press;
     2. the handler was re-bound on every scene render, stacking listeners;
     3. navigating away with the dialog open left the page scroll-locked.
   A DOM stub is used so the file runs under plain node with no dependencies. */

let fails = 0, ran = 0;
const ok = (name, cond, detail = '') => {
  ran++;
  if (!cond) { fails++; console.log(`  FAIL  ${name}  ${detail}`); }
  else console.log(`  PASS  ${name}`);
};

/* ---------------- minimal DOM ---------------- */
class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.attrs = {};
    this.style = {};
    this.listeners = {};
    this.disabled = false;
    this.offsetParent = {};          // "visible" by default
    this._html = '';
  }
  set innerHTML(v) {
    this._html = v;
    // only what the Modal needs: does a .modal exist, and which controls
    this.children = v.includes('class="modal"') ? [makeDialog(v)] : [];
  }
  get innerHTML() { return this._html; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const out = [];
    const walk = n => {
      if (n.matches?.(sel)) out.push(n);
      (n.children || []).forEach(walk);
    };
    this.children.forEach(walk);
    return out;
  }
  matches(sel) {
    if (sel.includes('.modal')) return this.attrs.class === 'modal';
    if (sel.startsWith('button')) return this.tagName === 'BUTTON' && !(sel.includes(':not([disabled])') && this.disabled);
    return false;
  }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  removeEventListener(t, f) { this.listeners[t] = (this.listeners[t] || []).filter(x => x !== f); }
  setAttribute(k, v) { this.attrs[k] = v; }
  focus() { global.document.activeElement = this; }
}
function makeDialog(html) {
  const d = new El('div');
  d.attrs.class = 'modal';
  const mk = (id, disabled = false) => { const b = new El('button'); b.attrs.id = id; b.disabled = disabled; return b; };
  // first control disabled, mirroring the prev button at the start of a list
  d.children = [mk('prev', html.includes('DISABLE_PREV')), mk('next'), mk('x')];
  return d;
}

const docListeners = {};
global.document = {
  activeElement: null,
  body: {style: {}},
  addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); },
  removeEventListener: (t, f) => { docListeners[t] = (docListeners[t] || []).filter(x => x !== f); },
  contains: () => true,
};
const fire = (key) => (docListeners.keydown || []).slice().forEach(f => f({key, preventDefault() {}, shiftKey: false}));
const keyHandlerCount = () => (docListeners.keydown || []).length;

const { Modal } = await import('./ui.js');

console.log('Modal lifecycle');

/* ---------------- open / close ---------------- */
console.log('\n[open and close]');
const mount = new El();
const m = new Modal(mount);
let prevCalls = 0, nextCalls = 0, closeCalls = 0;
const handlers = {onPrev: () => prevCalls++, onNext: () => nextCalls++, onClose: () => closeCalls++};

m.open('<div class="modal">x</div>', handlers);
ok('reports open', m.isOpen === true);
ok('locks page scroll', document.body.style.overflow === 'hidden');
ok('binds exactly one key handler', keyHandlerCount() === 1, keyHandlerCount());
ok('moves focus into the dialog', document.activeElement !== null);
ok('skips the disabled control', document.activeElement?.attrs.id !== 'prev', document.activeElement?.attrs.id);

m.close();
ok('reports closed', m.isOpen === false);
ok('releases the scroll lock', document.body.style.overflow === '');
ok('unbinds the key handler', keyHandlerCount() === 0, keyHandlerCount());
ok('fires onClose once', closeCalls === 1, closeCalls);

/* ---------------- bug 1: handler outliving the dialog ---------------- */
console.log('\n[regression: no ghost handler after close]');
prevCalls = nextCalls = 0;
m.open('<div class="modal">x</div>', handlers);
m.close();
fire('ArrowRight'); fire('ArrowLeft'); fire('Escape');
ok('arrow keys do nothing once closed', nextCalls === 0 && prevCalls === 0, `${nextCalls}/${prevCalls}`);

/* ---------------- bug 2: stacked handlers across re-renders ---------------- */
console.log('\n[regression: re-render does not stack handlers]');
m.open('<div class="modal">a</div>', handlers);
m.open('<div class="modal">b</div>', handlers);   // navigating to the next scene
m.open('<div class="modal">c</div>', handlers);
ok('still exactly one key handler after 3 renders', keyHandlerCount() === 1, keyHandlerCount());
nextCalls = 0;
fire('ArrowRight');
ok('one arrow press advances exactly once', nextCalls === 1, nextCalls);
m.close();

/* ---------------- bug 3: teardown by the router ---------------- */
console.log('\n[regression: destroy releases everything]');
m.open('<div class="modal">x</div>', handlers);
m.destroy();                                        // what the router calls
ok('destroy releases the scroll lock', document.body.style.overflow === '', document.body.style.overflow);
ok('destroy unbinds the key handler', keyHandlerCount() === 0, keyHandlerCount());
nextCalls = 0;
fire('ArrowRight');
ok('no handler survives destroy', nextCalls === 0, nextCalls);
ok('destroy on an already-closed modal is safe', (() => { m.destroy(); return true; })());

/* ---------------- escape ---------------- */
console.log('\n[escape closes]');
m.open('<div class="modal">x</div>', handlers);
fire('Escape');
ok('escape closes the dialog', m.isOpen === false);
ok('escape releases the scroll lock', document.body.style.overflow === '');

console.log('\n' + '-'.repeat(52));
console.log(fails ? `FAILED: ${fails} of ${ran}` : `all ${ran} checks passed`);
process.exit(fails ? 1 : 0);
