import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import StatusDot from './StatusDot.svelte';

describe('StatusDot', () => {
  it('renders the status as a title for accessibility', () => {
    render(StatusDot, { props: { status: 'online' } });
    expect(screen.getByTitle('online')).toBeInTheDocument();
  });

  it('renders the off status as a muted dot, distinct from offline', () => {
    render(StatusDot, { props: { status: 'off' } });
    const dot = screen.getByTitle('off');
    expect(dot.style.backgroundColor).toBe('var(--text-dim)');
  });
});
