// Generic timeout wrapper. Rejects with Error after `ms` if `p` hasn't settled.
// Note: the underlying promise is not cancelled — only the wait is bounded.
export function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout> | undefined;
  const timer = new Promise<T>((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timer]).finally(() => { if (id) clearTimeout(id); });
}
