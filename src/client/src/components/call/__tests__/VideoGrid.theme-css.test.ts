/**
 * VideoGrid Theme CSS Tests (L2)
 * TC-006, TC-019, TC-021
 *
 * Tests that theme.css contains the required CSS rules for VideoGrid polish.
 * No DOM rendering required — reads the CSS file directly.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const THEME_CSS_PATH = path.resolve(__dirname, '../../../styles/theme.css');

describe('VideoGrid theme.css rules', () => {
  const css = fs.readFileSync(THEME_CSS_PATH, 'utf8');

  // TC-006 (AC-05, L2 Unit, Positiv)
  it('TC-006: theme.css contains .video-grid-tile with aspect-ratio and @supports fallback', () => {
    expect(css).toContain('.video-grid-tile');
    expect(css).toContain('aspect-ratio: 16 / 9');
    expect(css).toContain('@supports not (aspect-ratio');
    // The @supports block must contain .video-grid-tile with height: 200px
    expect(css).toMatch(
      /@supports not \(aspect-ratio[^)]*\)\s*\{[\s\S]*?\.video-grid-tile[\s\S]*?height:\s*200px/
    );
  });

  // TC-019 (FM-1, L2 Unit, Degradation)
  it('TC-019: @supports fallback specifies height 200px for .video-grid-tile', () => {
    const supportsBlock = css.match(
      /@supports not \(aspect-ratio[^)]*\)\s*\{[\s\S]*?\}/
    )?.[0] ?? '';
    expect(supportsBlock).toContain('.video-grid-tile');
    expect(supportsBlock).toContain('200px');
  });

  // TC-021 (FM-3, L2 Unit, Positiv)
  it('TC-021: theme.css contains scrollbar styling for .video-grid-container--scrollable', () => {
    // Webkit scrollbar rules
    expect(css).toContain('.video-grid-container--scrollable::-webkit-scrollbar');
    expect(css).toContain('width: 6px');
    expect(css).toContain('.video-grid-container--scrollable::-webkit-scrollbar-track');
    expect(css).toContain('background: var(--bg-input)');
    expect(css).toContain('.video-grid-container--scrollable::-webkit-scrollbar-thumb');
    expect(css).toContain('background: var(--accent-muted)');
    // Firefox scrollbar
    expect(css).toContain('scrollbar-width: thin');
    expect(css).toContain('scrollbar-color: var(--accent-muted) var(--bg-input)');
  });
});
