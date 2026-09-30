export type ToastTone = "info" | "success" | "warning" | "critical";
export type ToastInput = { title: string; body?: string; tone: ToastTone; href?: string };
export type ToastItem = ToastInput & { id: number };

export const MAX_TOASTS = 3;
export const TOAST_MS = 5000;

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const timers = new Map<number, ReturnType<typeof setTimeout>>();

function emit() {
  listeners.forEach((l) => l());
}

export function getToasts(): ToastItem[] {
  return items;
}

export function subscribeToasts(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function dismissToast(id: number): void {
  const t = timers.get(id);
  if (t) clearTimeout(t);
  timers.delete(id);
  const next = items.filter((i) => i.id !== id);
  if (next.length !== items.length) {
    items = next;
    emit();
  }
}

/** Queue of up to 3, oldest dropped first, auto-dismiss after 5s. */
export function toast(input: ToastInput): number {
  const id = nextId++;
  items = [...items, { ...input, id }];
  while (items.length > MAX_TOASTS) {
    const dropped = items[0];
    const t = timers.get(dropped.id);
    if (t) clearTimeout(t);
    timers.delete(dropped.id);
    items = items.slice(1);
  }
  timers.set(
    id,
    setTimeout(() => dismissToast(id), TOAST_MS),
  );
  emit();
  return id;
}

export function clearToasts(): void {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  items = [];
  emit();
}
