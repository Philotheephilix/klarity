import '@testing-library/jest-dom/vitest';

// Guarantee a working localStorage in the jsdom test environment. Some jsdom
// configurations leave window.localStorage undefined; the theme toggle and
// bookmark hook depend on it, so provide a minimal in-memory implementation.
if (typeof window !== 'undefined' && !window.localStorage) {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => [...store.keys()][index] ?? null,
    removeItem: (key: string) => void store.delete(key),
    setItem: (key: string, value: string) => void store.set(key, String(value)),
  };
  Object.defineProperty(window, 'localStorage', {
    value: mock,
    configurable: true,
    writable: true,
  });
}
