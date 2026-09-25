import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const LMS_THEMES = {
  iiitdwd: {
    id: 'iiitdwd',
    name: 'IIIT Dharwad BAZ',
    shortName: 'IIIT Dharwad',
    icon: '🏛️',
    badge: 'Default • Official IIITD Portal',
    mode: 'light',
    palette: {
      headerBg: '#022758',
      headerGradient: 'linear-gradient(135deg, #022758 0%, #011b3e 60%, #0642CD 120%)',
      headerText: '#ffffff',
      primary: '#0075ED',
      primaryHover: '#005ec0',
      secondary: '#027654',
      accentCta: '#0075ED',
      background: '#f4f6f9',
      panelBg: '#ffffff',
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      cardShadow: '0 1px 3px rgba(2, 39, 88, 0.08), 0 4px 14px rgba(2, 39, 88, 0.04)',
      cardHoverShadow: '0 8px 24px rgba(2, 39, 88, 0.15)',
      textPrimary: '#0f172a',
      textSecondary: '#64748b',
      badgeBg: 'rgba(0, 117, 237, 0.1)',
      badgeBorder: 'rgba(0, 117, 237, 0.25)',
      badgeColor: '#0062c4',
      highlightBg: 'rgba(0, 117, 237, 0.12)',
      inputBg: '#ffffff',
      inputBorder: '#cbd5e1'
    }
  },
  canvas: {
    id: 'canvas',
    name: 'Canvas LMS',
    shortName: 'Canvas',
    icon: '🎓',
    badge: 'Instructure • Higher-Ed',
    mode: 'light',
    palette: {
      headerBg: '#E02424',
      headerGradient: 'linear-gradient(135deg, #C81E1E 0%, #9B1C1C 100%)',
      headerText: '#ffffff',
      primary: '#E02424',
      primaryHover: '#b91c1c',
      secondary: '#008EE2',
      accentCta: '#E02424',
      background: '#f5f5f7',
      panelBg: '#ffffff',
      cardBg: '#ffffff',
      cardBorder: '#e5e7eb',
      cardShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 14px rgba(0, 0, 0, 0.04)',
      cardHoverShadow: '0 8px 24px rgba(224, 36, 36, 0.14)',
      textPrimary: '#2d3b45',
      textSecondary: '#596b79',
      badgeBg: 'rgba(224, 36, 36, 0.08)',
      badgeBorder: 'rgba(224, 36, 36, 0.25)',
      badgeColor: '#c81e1e',
      highlightBg: 'rgba(224, 36, 36, 0.1)',
      inputBg: '#ffffff',
      inputBorder: '#d1d5db'
    }
  },
  moodle_boost: {
    id: 'moodle_boost',
    name: 'Moodle Classic',
    shortName: 'Moodle',
    icon: '🧡',
    badge: 'Open-Source • Boost',
    mode: 'light',
    palette: {
      headerBg: '#0F6CBF',
      headerGradient: 'linear-gradient(135deg, #0F6CBF 0%, #084882 100%)',
      headerText: '#ffffff',
      primary: '#F98012',
      primaryHover: '#e06f0a',
      secondary: '#10b981',
      accentCta: '#F98012',
      background: '#f8f9fa',
      panelBg: '#ffffff',
      cardBg: '#ffffff',
      cardBorder: '#e5e7eb',
      cardShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 14px rgba(15, 108, 191, 0.04)',
      cardHoverShadow: '0 8px 24px rgba(249, 128, 18, 0.16)',
      textPrimary: '#1f2937',
      textSecondary: '#6b7280',
      badgeBg: 'rgba(249, 128, 18, 0.1)',
      badgeBorder: 'rgba(249, 128, 18, 0.3)',
      badgeColor: '#c25e00',
      highlightBg: 'rgba(249, 128, 18, 0.12)',
      inputBg: '#ffffff',
      inputBorder: '#d1d5db'
    }
  },
  coursera: {
    id: 'coursera',
    name: 'Coursera / edX',
    shortName: 'Coursera',
    icon: '🌐',
    badge: 'MOOC • Modern Learning',
    mode: 'light',
    palette: {
      headerBg: '#0056D2',
      headerGradient: 'linear-gradient(135deg, #0056D2 0%, #003e99 100%)',
      headerText: '#ffffff',
      primary: '#0056D2',
      primaryHover: '#0043a8',
      secondary: '#00875A',
      accentCta: '#0056D2',
      background: '#f8fafc',
      panelBg: '#ffffff',
      cardBg: '#ffffff',
      cardBorder: '#e2e8f0',
      cardShadow: '0 1px 3px rgba(0, 86, 210, 0.06), 0 4px 14px rgba(0, 86, 210, 0.04)',
      cardHoverShadow: '0 8px 24px rgba(0, 86, 210, 0.16)',
      textPrimary: '#1e293b',
      textSecondary: '#64748b',
      badgeBg: 'rgba(0, 86, 210, 0.08)',
      badgeBorder: 'rgba(0, 86, 210, 0.25)',
      badgeColor: '#004aad',
      highlightBg: 'rgba(0, 86, 210, 0.12)',
      inputBg: '#ffffff',
      inputBorder: '#cbd5e1'
    }
  },
  blackboard: {
    id: 'blackboard',
    name: 'Blackboard Ultra',
    shortName: 'Blackboard',
    icon: '⚡',
    badge: 'Blackboard • Enterprise',
    mode: 'light',
    palette: {
      headerBg: '#18181b',
      headerGradient: 'linear-gradient(135deg, #27272a 0%, #18181b 100%)',
      headerText: '#ffffff',
      primary: '#CA8A04',
      primaryHover: '#a16207',
      secondary: '#0284c7',
      accentCta: '#CA8A04',
      background: '#f4f4f5',
      panelBg: '#ffffff',
      cardBg: '#ffffff',
      cardBorder: '#e4e4e7',
      cardShadow: '0 1px 3px rgba(0, 0, 0, 0.06), 0 4px 14px rgba(0, 0, 0, 0.04)',
      cardHoverShadow: '0 8px 24px rgba(202, 138, 4, 0.18)',
      textPrimary: '#18181b',
      textSecondary: '#71717a',
      badgeBg: 'rgba(202, 138, 4, 0.1)',
      badgeBorder: 'rgba(202, 138, 4, 0.3)',
      badgeColor: '#9a3412',
      highlightBg: 'rgba(202, 138, 4, 0.14)',
      inputBg: '#ffffff',
      inputBorder: '#d4d4d8'
    }
  }
};

/**
 * Injects theme CSS variables into the root document element.
 */
export const applyThemeCssVariables = (theme) => {
  if (typeof document === 'undefined' || !theme?.palette) return;
  const p = theme.palette;
  const root = document.documentElement;

  root.style.setProperty('--header-bg', p.headerBg);
  root.style.setProperty('--header-gradient', p.headerGradient);
  root.style.setProperty('--header-text', p.headerText);
  root.style.setProperty('--theme-primary', p.primary);
  root.style.setProperty('--theme-hover', p.primaryHover || p.primary);
  root.style.setProperty('--vimeo-blue', p.primary);
  root.style.setProperty('--vimeo-hover', p.primaryHover || p.primary);
  root.style.setProperty('--bg-dark', p.background);
  root.style.setProperty('--panel-bg', p.panelBg);
  root.style.setProperty('--card-bg', p.cardBg);
  root.style.setProperty('--border-color', p.cardBorder);
  root.style.setProperty('--text-primary', p.textPrimary);
  root.style.setProperty('--text-secondary', p.textSecondary);
  root.style.setProperty('--highlight-bg', p.highlightBg || 'rgba(0, 117, 237, 0.12)');
  root.style.setProperty('--badge-bg', p.badgeBg);
  root.style.setProperty('--badge-color', p.badgeColor);
  root.style.setProperty('--badge-border', p.badgeBorder);
  root.style.setProperty('--card-shadow', p.cardShadow);
};

export const useThemeStore = create(
  persist(
    (set, get) => ({
      currentThemeId: 'iiitdwd',
      setTheme: (themeId) => {
        const targetTheme = LMS_THEMES[themeId] || LMS_THEMES.iiitdwd;
        applyThemeCssVariables(targetTheme);
        set({ currentThemeId: targetTheme.id });
      },
      getCurrentTheme: () => {
        const { currentThemeId } = get();
        return LMS_THEMES[currentThemeId] || LMS_THEMES.iiitdwd;
      }
    }),
    {
      name: 'lecturescribe_theme',
      onRehydrateStorage: () => (state) => {
        if (state) {
          const targetTheme = LMS_THEMES[state.currentThemeId] || LMS_THEMES.iiitdwd;
          applyThemeCssVariables(targetTheme);
        }
      }
    }
  )
);
