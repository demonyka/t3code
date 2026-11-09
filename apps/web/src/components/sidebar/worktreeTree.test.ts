import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildSidebarFolderTree,
  flattenSidebarWorktreeTree,
  worktreeListKey,
} from "./worktreeTree";

const environmentId = EnvironmentId.make("env-1");
const remoteEnvironmentId = EnvironmentId.make("env-2");
const project = { environmentId, id: "p1", workspaceRoot: "/repo" };

function thread(
  id: string,
  worktreePath: string | null,
  createdAt = "2026-01-01T00:00:00.000Z",
  branch: string | null = null,
) {
  return { id, environmentId, projectId: "p1", worktreePath, branch, createdAt };
}

function worktree(path: string, refName: string | null, baseRefName: string | null = "main") {
  return { path, refName, isMain: false, baseRefName, aheadOfBase: null, behindBase: null };
}

const main = { ...worktree("/repo", "main", null), isMain: true };

function build(
  threads: ReadonlyArray<ReturnType<typeof thread>>,
  worktrees: ReadonlyArray<ReturnType<typeof worktree>> | null,
) {
  return buildSidebarFolderTree({
    group: { environmentId, id: "p1", memberProjects: [project] },
    threads,
    worktreeLists: new Map(
      worktrees === null ? [] : [[worktreeListKey(environmentId, "/repo"), { worktrees }]],
    ),
  });
}

function shape(tree: ReturnType<typeof build>) {
  return flattenSidebarWorktreeTree(tree, {
    isCollapsed: () => false,
    isRouteThread: () => false,
  }).map((row) =>
    row.kind === "thread"
      ? `${"  ".repeat(row.depth)}${row.thread.id}`
      : `${"  ".repeat(row.depth)}[${row.node.branch}]`,
  );
}

describe("buildSidebarFolderTree", () => {
  it("nests chats under their worktree and worktrees under their base", () => {
    const tree = build(
      [
        thread("root", null),
        thread("a1", "/w/a"),
        thread("a2", "/w/a"),
        thread("b1", "/w/b"),
        thread("main-path", "/repo"),
      ],
      [main, worktree("/w/a", "feat-a"), worktree("/w/b", "feat-b", "feat-a")],
    );
    expect(shape(tree)).toEqual([
      "root",
      "main-path",
      "[feat-a]",
      "  a1",
      "  a2",
      "  [feat-b]",
      "    b1",
    ]);
  });

  it("keeps a chatless ancestor so its child stays nested", () => {
    const tree = build(
      [thread("b1", "/w/b")],
      [main, worktree("/w/a", "feat-a"), worktree("/w/b", "feat-b", "feat-a")],
    );
    expect(shape(tree)).toEqual(["[feat-a]", "  [feat-b]", "    b1"]);
  });

  it.each([
    ["no list from an older server", null],
    ["a base naming no worktree", [main, worktree("/w/a", "feat-a", "gone")]],
  ])("falls back to the top level with %s", (_name, worktrees) => {
    expect(shape(build([thread("a1", "/w/a", undefined, "feat-a")], worktrees))).toEqual([
      "[feat-a]",
      "  a1",
    ]);
  });

  it("breaks a base cycle instead of dropping chats", () => {
    const tree = build(
      [thread("a1", "/w/a"), thread("b1", "/w/b")],
      [main, worktree("/w/a", "a", "b"), worktree("/w/b", "b", "a")],
    );
    expect(
      shape(tree)
        .filter((row) => !row.includes("["))
        .map((row) => row.trim())
        .toSorted(),
    ).toEqual(["a1", "b1"]);
  });

  it("orders worktrees by birth, so a newer chat in an old worktree moves nothing", () => {
    const tree = build(
      [
        thread("old", "/w/old", "2026-01-01T00:00:00.000Z"),
        thread("old-new-chat", "/w/old", "2026-03-01T00:00:00.000Z"),
        thread("new", "/w/new", "2026-02-01T00:00:00.000Z"),
      ],
      [main, worktree("/w/old", "old"), worktree("/w/new", "new")],
    );
    expect(shape(tree)).toEqual(["[new]", "  new", "[old]", "  old", "  old-new-chat"]);
  });

  it("prefers the thread's branch while the worktree still has a temporary name", () => {
    const tree = build(
      [thread("a1", "/w/a", undefined, "feat-real")],
      [main, worktree("/w/a", "t3code/deadbeef")],
    );
    expect(tree.nodes[0]?.branch).toBe("feat-real");
  });

  it("makes another machine's checkout a node of the folder", () => {
    const remote = {
      environmentId: remoteEnvironmentId,
      id: "p2",
      workspaceRoot: "/srv/repo",
      environmentLabel: "VPS",
    };
    const tree = buildSidebarFolderTree({
      group: { environmentId, id: "p1", memberProjects: [project, remote] },
      threads: [
        thread("local", null),
        { ...thread("remote", null), environmentId: remoteEnvironmentId, projectId: "p2" },
      ],
      worktreeLists: new Map(),
    });
    expect(tree.rootThreads.map((row) => row.id)).toEqual(["local"]);
    expect(tree.nodes.map((node) => node.checkoutLabel)).toEqual(["VPS"]);
    expect(tree.nodes[0]?.threads.map((row) => row.id)).toEqual(["remote"]);
  });
});

describe("flattenSidebarWorktreeTree", () => {
  it("keeps the open chat visible under a closed worktree and counts the rest", () => {
    const tree = build(
      [thread("a1", "/w/a"), thread("b1", "/w/b")],
      [main, worktree("/w/a", "feat-a"), worktree("/w/b", "feat-b", "feat-a")],
    );
    const rows = flattenSidebarWorktreeTree(tree, {
      isCollapsed: (key) => key.endsWith("/w/a"),
      isRouteThread: (row) => row.id === "b1",
    });
    expect(rows.map((row) => row.kind)).toEqual(["worktree", "thread"]);
    expect(rows[0]?.kind === "worktree" && rows[0].hiddenThreads.map((row) => row.id)).toEqual([
      "a1",
    ]);
  });
});
