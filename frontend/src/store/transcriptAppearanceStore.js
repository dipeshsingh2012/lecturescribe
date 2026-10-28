import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const FONT_FAMILIES = [
  { id: 'sans', name: 'Sans', value: 'inherit' },
  { id: 'serif', name: 'Serif', value: 'Georgia, Cambria, "Times New Roman", serif' },
  { id: 'mono', name: 'Monospace', value: '"JetBrains Mono", Consolas, Menlo, monospace' },
  { id: 'casual', name: 'Casual', value: '"Caveat", "Comic Sans MS", cursive, sans-serif' },
  { id: 'small-caps', name: 'Small Caps', value: 'inherit', fontVariant: 'small-caps' }
];

export const FONT_COLORS = [
  { id: 'default', name: 'Theme', value: '', swatch: 'var(--text-primary)' },
  { id: 'yellow', name: 'Netflix Yellow', value: '#facc15', swatch: '#facc15' },
  { id: 'white', name: 'Crisp White', value: '#f8fafc', swatch: '#f8fafc' },
  { id: 'green', name: 'Emerald', value: '#4ade80', swatch: '#4ade80' },
  { id: 'cyan', name: 'Cyan Sky', value: '#38bdf8', swatch: '#38bdf8' },
  { id: 'lavender', name: 'Lavender', value: '#c084fc', swatch: '#c084fc' },
  { id: 'amber', name: 'Warm Amber', value: '#fbbf24', swatch: '#fbbf24' }
];

export const FONT_SIZES = [
  { id: 'small', label: 'S', value: '0.76rem' },
  { id: 'medium', label: 'M', value: '0.84rem' },
  { id: 'large', label: 'L', value: '0.96rem' },
  { id: 'xlarge', label: 'XL', value: '1.12rem' }
];

export const LINE_SPACINGS = [
  { id: 'compact', label: 'Compact', value: '1.25' },
  { id: 'normal', label: 'Normal', value: '1.45' },
  { id: 'relaxed', label: 'Relaxed', value: '1.75' }
];

export const PRESETS = [
  { id: 'default', name: 'Default', fontFamily: 'sans', fontColor: 'default', fontSize: 'medium', lineSpacing: 'normal' },
  { id: 'netflix', name: 'Netflix Classic', fontFamily: 'sans', fontColor: 'yellow', fontSize: 'medium', lineSpacing: 'normal' },
  { id: 'reader', name: 'Reader', fontFamily: 'serif', fontColor: 'amber', fontSize: 'large', lineSpacing: 'relaxed' },
  { id: 'terminal', name: 'Terminal', fontFamily: 'mono', fontColor: 'green', fontSize: 'small', lineSpacing: 'compact' }
];

const DEFAULT_STATE = {
  fontFamily: 'sans',
  fontColor: 'default',
  fontSize: 'medium',
  lineSpacing: 'normal'
};

export const computeAppearanceCssVariables = ({ fontFamily, fontColor, fontSize, lineSpacing } = {}) => {
  const fontObj = FONT_FAMILIES.find((f) => f.id === fontFamily) || FONT_FAMILIES[0];
  const colorObj = FONT_COLORS.find((c) => c.id === fontColor) || FONT_COLORS[0];
  const sizeObj = FONT_SIZES.find((s) => s.id === fontSize) || FONT_SIZES[1];
  const spacingObj = LINE_SPACINGS.find((l) => l.id === lineSpacing) || LINE_SPACINGS[1];

  return {
    '--cue-font-family': fontObj.value,
    '--cue-font-variant': fontObj.fontVariant || 'normal',
    '--cue-color': colorObj.value || 'inherit',
    '--cue-font-size': sizeObj.value,
    '--cue-line-height': spacingObj.value
  };
};

export const useTranscriptAppearanceStore = create(
  persist(
    (set, get) => ({
      ...DEFAULT_STATE,
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setFontColor: (fontColor) => set({ fontColor }),
      setFontSize: (fontSize) => set({ fontSize }),
      setLineSpacing: (lineSpacing) => set({ lineSpacing }),
      applyPreset: (presetId) => {
        const preset = PRESETS.find((p) => p.id === presetId);
        if (preset) {
          set({
            fontFamily: preset.fontFamily,
            fontColor: preset.fontColor,
            fontSize: preset.fontSize,
            lineSpacing: preset.lineSpacing
          });
        }
      },
      resetDefaults: () => set(DEFAULT_STATE),
      getCssVariables: () => {
        return computeAppearanceCssVariables(get());
      }
    }),
    {
      name: 'lecturescribe_cue_appearance'
    }
  )
);

