"use client";

// Saved chat sessions, kept in this browser (localStorage). Nothing is sent to a server.
// Cards that could move money (sign buttons, deposit addresses) are archived when a chat is
// restored, so an old quote can never be signed or paid later; the user asks for a fresh one.

import type { ActionCard } from "./cards";

export type Msg = { role: "user" | "assistant"; content: string; cards?: ActionCard[] };
export type Chat = { id: string; title: string; account?: string; createdAt: number; updatedAt: number; msgs: Msg[] };
type State = { chats: Chat[]; activeId: string | null };

const KEY = "allpilot.chats.v1";
const MAX_CHATS = 40;
const MAX_ICON = 60_000; // keep small uploaded token pictures, drop anything bigger
const EMPTY: State = { chats: [], activeId: null };

let state: State | null = null;
const listeners = new Set<() => void>();

const isMoneyCard = (c: ActionCard) => c.transactions.length > 0 || !!c.intents?.depositAddress;
const archive = (m: Msg): Msg => (m.cards?.some(isMoneyCard) ? { ...m, cards: m.cards.map((c) => (isMoneyCard(c) ? { ...c, archived: true } : c)) } : m);

function readStored(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const s = JSON.parse(raw) as Partial<State>;
    if (!Array.isArray(s.chats)) return EMPTY;
    const chats = s.chats.filter((c) => c && typeof c.id === "string" && Array.isArray(c.msgs)).map((c) => ({ ...c, msgs: c.msgs.map(archive) }));
    return { chats, activeId: typeof s.activeId === "string" && chats.some((c) => c.id === s.activeId) ? s.activeId : null };
  } catch {
    return EMPTY;
  }
}

const slim = (m: Msg): Msg =>
  m.cards?.some((c) => c.icon && c.icon.length > MAX_ICON) ? { ...m, cards: m.cards.map((c) => (c.icon && c.icon.length > MAX_ICON ? { ...c, icon: undefined } : c)) } : m;

function write(next: State) {
  let chats = [...next.chats].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_CHATS).map((c) => ({ ...c, msgs: c.msgs.map(slim) }));
  // if the browser's storage is full, drop the oldest chats until it fits
  while (chats.length) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ chats, activeId: next.activeId }));
      return;
    } catch {
      chats = chats.slice(0, -1);
    }
  }
}

function set(next: State, persist = true) {
  state = next;
  if (persist) {
    // merge with what other tabs saved, so two open tabs don't erase each other's chats
    const stored = readStored();
    const mine = new Map(next.chats.map((c) => [c.id, c]));
    const merged = [...next.chats, ...stored.chats.filter((c) => !mine.has(c.id) && !deleted.has(c.id))];
    write({ chats: merged, activeId: next.activeId });
  }
  listeners.forEach((l) => l());
}
const deleted = new Set<string>();

export function subscribeChats(cb: () => void) {
  listeners.add(cb);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY || !state) return;
    // pick up chats saved in other tabs; keep this tab's open chat as it is
    const stored = readStored();
    const active = state.chats.find((c) => c.id === state!.activeId);
    const chats = stored.chats.filter((c) => c.id !== active?.id && !deleted.has(c.id));
    set({ chats: active ? [active, ...chats] : chats, activeId: state.activeId }, false);
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", onStorage);
  };
}
export function getChats(): State {
  if (!state) state = readStored();
  return state;
}
export const getServerChats = () => EMPTY;

const cur = () => getChats();
const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 42 ? `${t.slice(0, 40)}…` : t || "New chat";
};

export function newChat() {
  set({ ...cur(), activeId: null });
}
export function openChat(id: string) {
  if (cur().chats.some((c) => c.id === id)) set({ ...cur(), activeId: id });
}
export function deleteChat(id: string) {
  deleted.add(id);
  const s = cur();
  set({ chats: s.chats.filter((c) => c.id !== id), activeId: s.activeId === id ? null : s.activeId });
}
/** Starts a chat from its first message and makes it the open one. Returns its id. */
export function startChat(firstText: string, account?: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const now = Date.now();
  set({ chats: [{ id, title: titleFrom(firstText), account, createdAt: now, updatedAt: now, msgs: [] }, ...cur().chats], activeId: id });
  return id;
}
/** Appends a message to a chat (even if the user switched to another chat meanwhile). */
export function addMessage(id: string, msg: Msg, account?: string) {
  const s = cur();
  set({
    ...s,
    chats: s.chats.map((c) => (c.id === id ? { ...c, msgs: [...c.msgs, msg], updatedAt: Date.now(), account: c.account ?? account } : c)),
  });
}
