import '@testing-library/jest-dom';

// Mock window.scrollTo
if (typeof window !== 'undefined') {
  window.scrollTo = () => {};
}
