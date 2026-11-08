import { proj, state } from "./state";
import type { Project } from "./project";

/** Undo history for the current family's project, kept as JSON snapshots. */
let undoStack: string[] = [];
let redoStack: string[] = [];
let listener: () => void = () => {};

const LIMIT = 200;

export function onHistoryChange(fn: () => void): void {
  listener = fn;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

/** Call before every change to the project. */
export function pushUndo(): void {
  undoStack.push(JSON.stringify(proj()));
  if (undoStack.length > LIMIT) undoStack.shift();
  redoStack = [];
  listener();
}

export function clearHistory(): void {
  undoStack = [];
  redoStack = [];
}

function restore(s: string): void {
  state.store.projects[state.store.slug] = JSON.parse(s) as Project;
}

/** Returns true if something was undone. */
export function undo(): boolean {
  if (!undoStack.length) return false;
  redoStack.push(JSON.stringify(proj()));
  restore(undoStack.pop()!);
  return true;
}

export function redo(): boolean {
  if (!redoStack.length) return false;
  undoStack.push(JSON.stringify(proj()));
  restore(redoStack.pop()!);
  return true;
}
