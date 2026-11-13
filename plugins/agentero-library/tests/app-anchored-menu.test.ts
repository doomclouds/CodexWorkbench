import { describe, expect, it } from 'vitest';
import { menuPosition } from '../src/app/ui/AnchoredMenu';

describe('anchored menu viewport placement', () => {
  it('opens by its row trigger and flips above the final row without clipping', () => {
    expect(menuPosition({ left: 40, top: 100, bottom: 124 }, { width: 190, height: 160 }, { width: 800, height: 600 })).toEqual({ left: 40, top: 128 });
    expect(menuPosition({ left: 760, top: 550, bottom: 578 }, { width: 190, height: 160 }, { width: 800, height: 600 })).toEqual({ left: 602, top: 386 });
  });
  it('clamps a pointer menu within a narrow app viewport', () => {
    expect(menuPosition({ left: 300, top: 12, bottom: 12 }, { width: 190, height: 200 }, { width: 320, height: 180 })).toEqual({ left: 122, top: 8 });
  });
});
