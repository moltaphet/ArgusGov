"use client";

import { useSyncExternalStore } from "react";

export interface ToastItem {
  id: string;
  title: string;
  tone: "pending" | "success" | "error";
  detail?: string;
  hash?: string;
}

let items: ToastItem[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit() {
  items = [...items];
  listeners.forEach((l) => l());
}

export function dismissToast(id: string) {
  clearTimeout(timers.get(id));
  timers.delete(id);
  items = items.filter((t) => t.id !== id);
  emit();
}

export function upsertToast(item: ToastItem) {
  const exists = items.some((t) => t.id === item.id);
  items = exists ? items.map((t) => (t.id === item.id ? item : t)) : [...items, item];
  clearTimeout(timers.get(item.id));
  if (item.tone === "success") timers.set(item.id, setTimeout(() => dismissToast(item.id), 7000));
  emit();
}

export function useToasts(): ToastItem[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => items,
    () => [],
  );
}
