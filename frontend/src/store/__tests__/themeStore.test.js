import { describe, it, expect, beforeEach } from 'vitest';
import {
  useThemeStore,
  LMS_THEMES,
  applyThemeCssVariables,
  createAppMuiTheme
} from '../themeStore';

describe('themeStore & styling utilities', () => {
  beforeEach(() => {
    useThemeStore.setState({ currentThemeId: 'academic' });
  });

  it('contains valid LMS themes including academic, canvas, blackboard, moodle_boost, coursera', () => {
    expect(LMS_THEMES.academic).toBeDefined();
    expect(LMS_THEMES.canvas).toBeDefined();
    expect(LMS_THEMES.blackboard).toBeDefined();
    expect(LMS_THEMES.moodle_boost).toBeDefined();
    expect(LMS_THEMES.coursera).toBeDefined();
  });

  it('updates currentThemeId via setTheme', () => {
    const { setTheme } = useThemeStore.getState();
    setTheme('canvas');
    expect(useThemeStore.getState().currentThemeId).toBe('canvas');
    expect(useThemeStore.getState().getCurrentTheme().name).toBe('Canvas LMS');
  });

  it('applies CSS custom variables to document.documentElement', () => {
    applyThemeCssVariables(LMS_THEMES.academic);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--theme-primary')).toBe(LMS_THEMES.academic.palette.primary);
    expect(root.style.getPropertyValue('--header-bg')).toBe(LMS_THEMES.academic.palette.headerBg);
  });

  it('builds a valid Material-UI theme via createAppMuiTheme', () => {
    const theme = createAppMuiTheme(LMS_THEMES.academic);
    expect(theme.palette.primary.main).toBe(LMS_THEMES.academic.palette.primary);
    expect(theme.palette.background.default).toBe(LMS_THEMES.academic.palette.background);
    expect(theme.shape.borderRadius).toBe(8);
  });
});
