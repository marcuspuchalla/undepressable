// Stand-in for `virtual:pwa-register` in builds without a service worker (the
// browser extension): an extension updates through its store or by hand.
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {}
}
