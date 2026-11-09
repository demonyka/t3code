import type { EnvironmentId, VcsListWorktreesResult } from "@t3tools/contracts";
import { isTemporaryWorktreeBranch } from "@t3tools/shared/git";

type ListedWorktree = VcsListWorktreesResult["worktrees"][number];
export type WorktreeLists = ReadonlyMap<string, VcsListWorktreesResult | null>;

type TreeThread = {
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly worktreePath: string | null;
  readonly branch: string | null;
  readonly createdAt: string;
};

type TreeProject = {
  readonly environmentId: EnvironmentId;
  readonly id: string;
  readonly workspaceRoot: string;
  readonly environmentLabel?: string | null;
};

export interface SidebarWorktreeNode<TThread> {
  readonly key: string;
  readonly environmentId: EnvironmentId;
  readonly projectId: string;
  readonly path: string;
  readonly branch: string | null;
  // Set when this node is another machine's checkout of the same repository.
  readonly checkoutLabel: string | null;
  readonly baseBranch: string | null;
  readonly aheadOfBase: number | null;
  readonly behindBase: number | null;
  readonly threads: readonly TThread[];
  readonly children: ReadonlyArray<SidebarWorktreeNode<TThread>>;
}

export interface SidebarWorktreeTree<TThread> {
  readonly rootThreads: readonly TThread[];
  readonly nodes: ReadonlyArray<SidebarWorktreeNode<TThread>>;
}

export type SidebarTreeRow<TThread> =
  | {
      readonly kind: "thread";
      readonly thread: TThread;
      readonly depth: number;
      readonly parentRow: string | null;
    }
  | {
      readonly kind: "worktree";
      readonly node: SidebarWorktreeNode<TThread>;
      readonly depth: number;
      readonly parentRow: string | null;
      readonly collapsed: boolean;
      readonly hiddenThreads: readonly TThread[];
    };

export function sidebarWorktreeRowId(nodeKey: string) {
  return `worktree:${nodeKey}`;
}

export function worktreeListKey(environmentId: EnvironmentId, cwd: string) {
  return `${environmentId}:${cwd}`;
}

function belongsTo(thread: TreeThread, project: TreeProject) {
  return thread.environmentId === project.environmentId && thread.projectId === project.id;
}

/** Only projects with a worktree chat need a list; the rest cost no git calls. */
export function buildSidebarWorktreeTargets(
  groups: ReadonlyArray<{ readonly memberProjects: readonly TreeProject[] }>,
  threads: readonly TreeThread[],
) {
  return groups.flatMap((group) =>
    group.memberProjects.flatMap((project) => {
      const paths = new Set<string>();
      for (const thread of threads) {
        if (thread.worktreePath !== null && belongsTo(thread, project)) {
          paths.add(thread.worktreePath);
        }
      }
      return paths.size === 0
        ? []
        : [
            {
              environmentId: project.environmentId,
              input: { cwd: project.workspaceRoot, compareWorktreePaths: [...paths].toSorted() },
            },
          ];
    }),
  );
}

// A temporary name is about to be replaced; the thread hears the new one first.
function resolveBranchLabel(listed: ListedWorktree | undefined, threadBranch: string | null) {
  const liveBranch = listed?.refName ?? null;
  return liveBranch !== null && !isTemporaryWorktreeBranch(liveBranch)
    ? liveBranch
    : (threadBranch ?? liveBranch);
}

function resolveParents(
  paths: Iterable<string>,
  listedByPath: ReadonlyMap<string, ListedWorktree>,
  worktreeByBranch: ReadonlyMap<string, ListedWorktree>,
) {
  const parentOf = (path: string) => {
    const base = listedByPath.get(path)?.baseRefName;
    const parent = base == null ? undefined : worktreeByBranch.get(base)?.path;
    return parent === undefined || parent === path ? null : parent;
  };
  const parents = new Map<string, string | null>();
  for (const start of paths) {
    const trail = new Set([start]);
    let current = start;
    while (!parents.has(current)) {
      const parent = parentOf(current);
      // A renamed branch can leave two worktrees naming each other as base.
      if (parent === null || trail.has(parent)) {
        parents.set(current, null);
        break;
      }
      parents.set(current, parent);
      trail.add(parent);
      current = parent;
    }
  }
  return parents;
}

function earliestCreatedAt<TThread extends TreeThread>(node: SidebarWorktreeNode<TThread>): number {
  return Math.min(
    ...node.threads.map((thread) => Date.parse(thread.createdAt) || 0),
    ...node.children.map(earliestCreatedAt),
    Number.POSITIVE_INFINITY,
  );
}

// Newest first, by when the worktree began: a new message must never move it.
function sortNodes<TThread extends TreeThread>(nodes: Array<SidebarWorktreeNode<TThread>>) {
  return nodes.toSorted(
    (left, right) =>
      earliestCreatedAt(right) - earliestCreatedAt(left) || left.path.localeCompare(right.path),
  );
}

function buildSidebarWorktreeTree<TThread extends TreeThread>(input: {
  readonly project: TreeProject;
  readonly threads: readonly TThread[];
  readonly worktrees: readonly ListedWorktree[] | null;
}): SidebarWorktreeTree<TThread> {
  const { project } = input;
  const worktrees = input.worktrees ?? [];
  const listedByPath = new Map(worktrees.map((worktree) => [worktree.path, worktree]));
  const worktreeByBranch = new Map(
    worktrees.flatMap((worktree) =>
      worktree.isMain || worktree.refName === null ? [] : [[worktree.refName, worktree] as const],
    ),
  );
  const mainPath = worktrees.find((worktree) => worktree.isMain)?.path ?? project.workspaceRoot;
  const rootThreads: TThread[] = [];
  const threadsByPath = new Map<string, TThread[]>();
  for (const thread of input.threads) {
    if (thread.worktreePath === null || thread.worktreePath === mainPath) {
      rootThreads.push(thread);
      continue;
    }
    const threads = threadsByPath.get(thread.worktreePath);
    if (threads === undefined) threadsByPath.set(thread.worktreePath, [thread]);
    else threads.push(thread);
  }

  const parents = resolveParents(threadsByPath.keys(), listedByPath, worktreeByBranch);
  const childPaths = new Map<string | null, string[]>();
  for (const [path, parent] of parents) {
    const siblings = childPaths.get(parent);
    if (siblings === undefined) childPaths.set(parent, [path]);
    else siblings.push(path);
  }
  const buildNode = (path: string): SidebarWorktreeNode<TThread> => {
    const listed = listedByPath.get(path);
    const threads = threadsByPath.get(path) ?? [];
    return {
      key: worktreeListKey(project.environmentId, path),
      environmentId: project.environmentId,
      projectId: project.id,
      path,
      branch: resolveBranchLabel(listed, threads[0]?.branch ?? null),
      checkoutLabel: null,
      baseBranch: listed?.baseRefName ?? null,
      aheadOfBase: listed?.aheadOfBase ?? null,
      behindBase: listed?.behindBase ?? null,
      threads,
      children: sortNodes((childPaths.get(path) ?? []).map(buildNode)),
    };
  };
  return { rootThreads, nodes: sortNodes((childPaths.get(null) ?? []).map(buildNode)) };
}

/**
 * One folder can merge the same repository from several machines. The folder's
 * own project is the root; every other machine's checkout becomes a node.
 */
export function buildSidebarFolderTree<TThread extends TreeThread>(input: {
  readonly group: {
    readonly environmentId: EnvironmentId;
    readonly id: string;
    readonly memberProjects: readonly TreeProject[];
  };
  readonly threads: readonly TThread[];
  readonly worktreeLists: WorktreeLists;
}): SidebarWorktreeTree<TThread> {
  const { group, threads, worktreeLists } = input;
  const isPrimary = (project: TreeProject) =>
    project.environmentId === group.environmentId && project.id === group.id;
  const primary = group.memberProjects.find(isPrimary) ?? group.memberProjects[0];
  if (primary === undefined) return { rootThreads: threads, nodes: [] };
  const treeOf = (project: TreeProject) =>
    buildSidebarWorktreeTree({
      project,
      threads: threads.filter((thread) => belongsTo(thread, project)),
      worktrees:
        worktreeLists.get(worktreeListKey(project.environmentId, project.workspaceRoot))
          ?.worktrees ?? null,
    });
  const root = treeOf(primary);
  const checkouts = group.memberProjects.flatMap((project): SidebarWorktreeNode<TThread>[] => {
    if (project === primary) return [];
    const tree = treeOf(project);
    if (tree.rootThreads.length === 0 && tree.nodes.length === 0) return [];
    return [
      {
        key: worktreeListKey(project.environmentId, project.workspaceRoot),
        environmentId: project.environmentId,
        projectId: project.id,
        path: project.workspaceRoot,
        branch: tree.rootThreads[0]?.branch ?? null,
        checkoutLabel: project.environmentLabel ?? project.workspaceRoot,
        baseBranch: null,
        aheadOfBase: null,
        behindBase: null,
        threads: tree.rootThreads,
        children: tree.nodes,
      },
    ];
  });
  return { rootThreads: root.rootThreads, nodes: [...root.nodes, ...checkouts] };
}

function subtreeThreads<TThread>(node: SidebarWorktreeNode<TThread>): TThread[] {
  return [...node.threads, ...node.children.flatMap(subtreeThreads)];
}

/** A closed node keeps showing the open thread and hints at the rest. */
export function flattenSidebarWorktreeTree<TThread>(
  tree: SidebarWorktreeTree<TThread>,
  options: {
    readonly isCollapsed: (nodeKey: string) => boolean;
    readonly isRouteThread: (thread: TThread) => boolean;
  },
): Array<SidebarTreeRow<TThread>> {
  const rows: Array<SidebarTreeRow<TThread>> = tree.rootThreads.map((thread) => ({
    kind: "thread",
    thread,
    depth: 0,
    parentRow: null,
  }));
  const visit = (node: SidebarWorktreeNode<TThread>, depth: number, parentRow: string | null) => {
    const rowId = sidebarWorktreeRowId(node.key);
    const collapsed = options.isCollapsed(node.key);
    const hidden = collapsed ? subtreeThreads(node) : [];
    rows.push({
      kind: "worktree",
      node,
      depth,
      parentRow,
      collapsed,
      hiddenThreads: hidden.filter((thread) => !options.isRouteThread(thread)),
    });
    const visible = collapsed ? hidden.filter(options.isRouteThread) : node.threads;
    for (const thread of visible) {
      rows.push({ kind: "thread", thread, depth: depth + 1, parentRow: rowId });
    }
    if (!collapsed) for (const child of node.children) visit(child, depth + 1, rowId);
  };
  for (const node of tree.nodes) visit(node, 0, null);
  return rows;
}
