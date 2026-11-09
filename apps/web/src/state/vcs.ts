import {
  createVcsActionManager,
  createVcsEnvironmentAtoms,
  createVcsStatusRevalidationAtomFamily,
} from "@t3tools/client-runtime/state/vcs";

import type {
  EnvironmentId,
  VcsListWorktreesInput,
  VcsListWorktreesResult,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";

import { connectionAtomRuntime } from "../connection/runtime";
import { subscribeDocumentReturn } from "../lib/documentActivity";

export const vcsEnvironment = createVcsEnvironmentAtoms(connectionAtomRuntime);
export const vcsActionManager = createVcsActionManager(connectionAtomRuntime);

/**
 * Refreshes a checkout's status when the user comes back to the window, where
 * edits made in another app or terminal may be waiting.
 */
export const vcsStatusRevalidation = createVcsStatusRevalidationAtomFamily({
  refreshStatus: vcsEnvironment.refreshStatus,
  subscribeWake: subscribeDocumentReturn,
  wakeDebounceMs: 250,
});

const lastWorktreeLists = new Map<string, VcsListWorktreesResult>();

/**
 * The worktree lists of every sidebar folder, keyed by `worktreeListKey`. The last
 * list is retained so adding a worktree cannot flatten the tree while it reloads.
 */
export const vcsWorktreeLists = Atom.family((targetsJson: string) => {
  const targets = JSON.parse(targetsJson) as ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly input: VcsListWorktreesInput;
  }>;
  return Atom.make((get): ReadonlyMap<string, VcsListWorktreesResult | null> => {
    const lists = new Map<string, VcsListWorktreesResult | null>();
    for (const target of targets) {
      const key = `${target.environmentId}:${target.input.cwd}`;
      const fresh = AsyncResult.getOrElse(get(vcsEnvironment.listWorktrees(target)), () => null);
      if (fresh !== null) lastWorktreeLists.set(key, fresh);
      lists.set(key, fresh ?? lastWorktreeLists.get(key) ?? null);
    }
    return lists;
  });
});
