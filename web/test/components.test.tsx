import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Card } from '../components/Card';
import { Chip, TagChip } from '../components/Chip';
import { NavLink } from '../components/NavLink';
import { SearchBar } from '../components/SearchBar';
import { CodeBlock, MonoLabel } from '../components/CodeBlock';

describe('Card', () => {
  it('renders an article.bench-card with its children', () => {
    render(<Card>hello card</Card>);
    const el = screen.getByText('hello card');
    expect(el.closest('article')).toHaveClass('bench-card');
  });
});

describe('Chip', () => {
  it('active chip has data-on/aria-pressed true and fires onClick', () => {
    const onClick = vi.fn();
    render(<Chip label="Press" active onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Press' });
    expect(btn).toHaveClass('bench-chip');
    expect(btn).toHaveAttribute('data-on', 'true');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('inactive chip reports aria-pressed false', () => {
    render(<Chip label="Hover" />);
    expect(screen.getByRole('button', { name: 'Hover' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('TagChip', () => {
  it('renders a span.ctx-chip', () => {
    render(<TagChip>eip712</TagChip>);
    const el = screen.getByText('eip712');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveClass('ctx-chip');
  });
});

describe('NavLink', () => {
  it('active link is a.bench-navlink[data-on=true]', () => {
    render(<NavLink href="/contracts" active>Contracts</NavLink>);
    const a = screen.getByRole('link', { name: 'Contracts' });
    expect(a).toHaveClass('bench-navlink');
    expect(a).toHaveAttribute('data-on', 'true');
    expect(a).toHaveAttribute('href', '/contracts');
  });
});

describe('SearchBar', () => {
  it('renders input.bench-findbox with placeholder and a kbd.nav-kbd, and fires onChange', () => {
    const onChange = vi.fn();
    render(<SearchBar value="" onChange={onChange} placeholder="Search corpus" />);
    const input = screen.getByPlaceholderText('Search corpus');
    expect(input).toHaveClass('bench-findbox');
    const kbd = document.querySelector('kbd.nav-kbd');
    expect(kbd).not.toBeNull();
    fireEvent.change(input, { target: { value: 'aave' } });
    expect(onChange).toHaveBeenCalledWith('aave');
  });
});

describe('CodeBlock / MonoLabel', () => {
  it('CodeBlock renders pre.code-block with its text', () => {
    render(<CodeBlock>0xdeadbeef</CodeBlock>);
    const el = screen.getByText('0xdeadbeef');
    expect(el.tagName).toBe('PRE');
    expect(el).toHaveClass('code-block');
  });

  it('MonoLabel renders span.mono', () => {
    render(<MonoLabel>Calldata</MonoLabel>);
    const el = screen.getByText('Calldata');
    expect(el.tagName).toBe('SPAN');
    expect(el).toHaveClass('mono');
  });
});

describe('component sources', () => {
  it('contain no emoji', () => {
    const files = ['Card.tsx', 'Chip.tsx', 'NavLink.tsx', 'SearchBar.tsx', 'CodeBlock.tsx'];
    const emoji =
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}\u{1F100}-\u{1F1FF}]/u;
    for (const f of files) {
      const src = readFileSync(resolve(__dirname, '../components', f), 'utf8');
      expect(src, `${f} must contain no emoji`).not.toMatch(emoji);
    }
  });
});
