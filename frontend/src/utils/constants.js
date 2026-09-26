export const API_BASE = (
  import.meta.env.VITE_API_URL ||
  (import.meta.env.DEV ? '' : 'https://lecturescribe-api-4hysn7vtva-uc.a.run.app')
).replace(/\/+$/, '');
