import { describe, it, expect, beforeEach } from 'vitest';
import { attachCopyOnSelect } from './copy-on-select';

function fakeTerm(text = '') {
  return {
    hasSelection: () => text.length > 0,
    getSelection: () => text,
  };
}

function setup() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

function pointerup(el: HTMLElement, pointerType: string) {
  el.dispatchEvent(Object.assign(new Event('pointerup', { bubbles: true }), { pointerType }));
}

describe('attachCopyOnSelect', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('copies the selection on a mouse pointer-up (desktop "copy on select")', () => {
    const container = setup();
    const copied: string[] = [];
    attachCopyOnSelect(container, fakeTerm('hello') as never, (t) => copied.push(t));
    pointerup(container, 'mouse');
    expect(copied).toEqual(['hello']);
  });

  it('does nothing when there is no selection', () => {
    const container = setup();
    const copied: string[] = [];
    attachCopyOnSelect(container, fakeTerm('') as never, (t) => copied.push(t));
    pointerup(container, 'mouse');
    expect(copied).toEqual([]);
  });

  it('ignores touch pointer-up (touch is not desktop copy-on-select)', () => {
    const container = setup();
    const copied: string[] = [];
    attachCopyOnSelect(container, fakeTerm('hello') as never, (t) => copied.push(t));
    pointerup(container, 'touch');
    expect(copied).toEqual([]);
  });

  it('stops copying after destroy', () => {
    const container = setup();
    const copied: string[] = [];
    const ref = attachCopyOnSelect(container, fakeTerm('hello') as never, (t) => copied.push(t));
    ref.destroy();
    pointerup(container, 'mouse');
    expect(copied).toEqual([]);
  });
});
