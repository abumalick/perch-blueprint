import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ProjectFilterSelect from './ProjectFilterSelect.svelte';
import type { ProjectFolder } from '../core/project-folders';

const folders: ProjectFolder[] = [
  { key: 'perch', label: 'perch', count: 3, depth: 0 },
  { key: 'other', label: 'other', count: 1, depth: 0 },
];

describe('ProjectFilterSelect', () => {
  it('shows a nested folder by its short label, indented under its parent', async () => {
    const tree: ProjectFolder[] = [
      { key: 'bar', label: 'bar', count: 2, depth: 0 },
      { key: 'bar/baz', label: 'baz', count: 2, depth: 1 },
    ];
    const ontoggle = vi.fn();
    render(ProjectFilterSelect, { props: { folders: tree, selected: new Set<string>(), ontoggle } });
    await fireEvent.click(screen.getByLabelText(/filter by project/i));
    const child = screen.getByRole('checkbox', { name: /baz/i });
    const parent = screen.getByRole('checkbox', { name: /^bar/i });
    expect(child.closest('label')!.getAttribute('style')).toContain('--depth: 1');
    expect(parent.closest('label')!.getAttribute('style')).toContain('--depth: 0');
    await fireEvent.click(child);
    expect(ontoggle).toHaveBeenCalledWith('bar/baz');
  });

  it('summarizes a single nested selection by its full path', () => {
    const tree: ProjectFolder[] = [
      { key: 'bar', label: 'bar', count: 2, depth: 0 },
      { key: 'bar/baz', label: 'baz', count: 2, depth: 1 },
    ];
    render(ProjectFilterSelect, { props: { folders: tree, selected: new Set(['bar/baz']), ontoggle: vi.fn() } });
    expect(screen.getByLabelText(/filter by project/i)).toHaveTextContent('bar/baz');
  });

  it('opens the menu when the summary is clicked', async () => {
    render(ProjectFilterSelect, { props: { folders, selected: new Set<string>(), ontoggle: vi.fn() } });
    expect(screen.queryByRole('button', { name: /close project filter/i })).toBeNull();
    await fireEvent.click(screen.getByLabelText(/filter by project/i));
    expect(screen.getByRole('group', { name: /projects/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /close project filter/i })).toBeTruthy();
  });

  it('closes on an outside tap via the backdrop', async () => {
    render(ProjectFilterSelect, { props: { folders, selected: new Set<string>(), ontoggle: vi.fn() } });
    await fireEvent.click(screen.getByLabelText(/filter by project/i));
    await fireEvent.click(screen.getByRole('button', { name: /close project filter/i }));
    expect(screen.queryByRole('button', { name: /close project filter/i })).toBeNull();
  });

  it('closes on Escape', async () => {
    render(ProjectFilterSelect, { props: { folders, selected: new Set<string>(), ontoggle: vi.fn() } });
    await fireEvent.click(screen.getByLabelText(/filter by project/i));
    expect(screen.getByRole('button', { name: /close project filter/i })).toBeTruthy();
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: /close project filter/i })).toBeNull();
  });

  it('does not close when a checkbox inside the menu is clicked', async () => {
    const ontoggle = vi.fn();
    render(ProjectFilterSelect, { props: { folders, selected: new Set<string>(), ontoggle } });
    await fireEvent.click(screen.getByLabelText(/filter by project/i));
    await fireEvent.click(screen.getByRole('checkbox', { name: /perch/i }));
    expect(ontoggle).toHaveBeenCalledWith('perch');
    expect(screen.getByRole('button', { name: /close project filter/i })).toBeTruthy();
  });
});
