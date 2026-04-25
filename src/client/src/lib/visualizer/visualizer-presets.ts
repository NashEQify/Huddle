/**
 * Curated Milkdrop presets for the audio visualizer.
 *
 * Spec: 95.4.1
 * Uses the minimal preset pack from butterchurn-presets (~29 presets).
 * Dead presets (zero/near-zero audio reactivity) are filtered out.
 * This module is lazy-loaded together with Butterchurn via dynamic import().
 */

// Use the pre-bundled dist version (UMD, no require() calls).
// The root-level minimal.js uses require() which fails in browsers.
import presets from 'butterchurn-presets/dist/minimal.min';

/** Presets with 0 or near-0 audio reactivity — excluded from rotation. */
const DEAD_PRESETS = [
  'Flexi - alien fish pond',
  'Geiss - Cauldron - painterly 2 (saturation remix)',
  'martin - mandelbox explorer - high speed demo version',
  '_Mig_085',
  'Geiss - Thumb Drum',
];

// Build filtered preset set
const allPresets: Record<string, object> = { ...presets };
for (const name of DEAD_PRESETS) {
  delete allPresets[name];
}

export const curatedPresets: Record<string, object> = allPresets;

export const presetNames: string[] = Object.keys(curatedPresets);

export const DEFAULT_PRESET_NAME =
  'ShadowHarlequin - LovelyShinySquares [ liquid starburst rmx ] - unchained + rovaster - luckless - martin - starfield sector';

export function getPresetByIndex(index: number): { name: string; preset: object } {
  const wrappedIndex = ((index % presetNames.length) + presetNames.length) % presetNames.length;
  const name = presetNames[wrappedIndex];
  return { name, preset: curatedPresets[name] };
}
