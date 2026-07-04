export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: number;
  kind: ToastKind;
  text: string;
}

type Listener = (toast: ToastMessage) => void;
const listeners = new Set<Listener>();
let nextId = 1;

export function toast(text: string, kind: ToastKind = 'info'): void {
  const msg = { id: nextId++, kind, text };
  listeners.forEach((l) => l(msg));
}

export function onToast(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
