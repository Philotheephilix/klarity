import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ThemeToggle, THEME_KEY } from '../components/ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => cleanup());

  it('hydrates from the data-theme already on <html> (no-flash script)', () => {
    document.documentElement.setAttribute('data-theme', 'light');
    render(<ThemeToggle />);
    const btn = screen.getByRole('button');
    // light theme -> aria-pressed true, label "Light"
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Light')).toBeInTheDocument();
  });

  it('toggles data-theme on <html> and persists to localStorage', () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    render(<ThemeToggle />);
    const btn = screen.getByRole('button');
    expect(screen.getByText('Dark')).toBeInTheDocument();

    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('light');
    expect(screen.getByText('Light')).toBeInTheDocument();

    fireEvent.click(btn);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(window.localStorage.getItem(THEME_KEY)).toBe('dark');
  });
});
