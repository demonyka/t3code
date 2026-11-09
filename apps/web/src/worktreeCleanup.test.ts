import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_INTERACTION_MODE, DEFAULT_RUNTIME_MODE, type Thread } from "./types";
import { makeThreadFixture } from "./test-fixtures";
import { findThreadsOnWorktree, getOrphanedWorktreePathForThread } from "./worktreeCleanup";

const localEnvironmentId = EnvironmentId.make("environment-local");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return makeThreadFixture({
    id: ThreadId.make("thread-1"),
    environmentId: localEnvironmentId,
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.3-codex",
    },
    runtimeMode: DEFAULT_RUNTIME_MODE,
    interactionMode: DEFAULT_INTERACTION_MODE,
    runtime: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-02-13T00:00:00.000Z",
    updatedAt: "2026-02-13T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    latestRun: null,
    branch: null,
    worktreePath: null,
    ...overrides,
  });
}

describe("findThreadsOnWorktree", () => {
  const environmentId = EnvironmentId.make("env-1");
  const chat = (
    id: string,
    worktreePath: string | null,
    overrides: { environmentId?: EnvironmentId; archivedAt?: string | null } = {},
  ) => ({ id, environmentId, worktreePath, archivedAt: null, ...overrides });

  it("finds live chats on the path however it was written, on this machine only", () => {
    const found = findThreadsOnWorktree(
      [
        chat("plain", "/wt/a"),
        chat("trailing-slash", "/wt/a/"),
        chat("archived", "/wt/a", { archivedAt: "2026-01-01T00:00:00.000Z" }),
        chat("other-machine", "/wt/a", { environmentId: EnvironmentId.make("env-2") }),
        chat("other-worktree", "/wt/b"),
        chat("main-checkout", null),
      ],
      { environmentId, worktreePath: "/wt/a" },
    );
    expect(found.map((thread) => thread.id)).toEqual(["plain", "trailing-slash"]);
  });
});

describe("getOrphanedWorktreePathForThread", () => {
  it("returns null when another thread links to the same worktree", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("thread-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
    ];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBeNull();
  });

  it.each([
    ["/tmp/repo/worktrees/feature-a", "/tmp/repo/worktrees/feature-a/"],
    ["/tmp/repo/worktrees/feature-a", "/tmp/repo/worktrees/feature-a//"],
    ["C:\\repo\\worktrees\\feature-a", "c:/repo/worktrees/feature-a/"],
  ])("treats %s and %s as the same worktree", (targetPath, otherPath) => {
    const threads = [
      makeThread({ id: ThreadId.make("thread-1"), worktreePath: targetPath }),
      makeThread({ id: ThreadId.make("thread-2"), worktreePath: otherPath }),
    ];
    expect(getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"))).toBeNull();
    expect(getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-2"))).toBeNull();
  });

  it("keeps case-sensitive POSIX worktrees apart", () => {
    const threads = [
      makeThread({ id: ThreadId.make("thread-1"), worktreePath: "/tmp/repo/worktrees/Feature" }),
      makeThread({ id: ThreadId.make("thread-2"), worktreePath: "/tmp/repo/worktrees/feature" }),
    ];
    expect(getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"))).toBe(
      "/tmp/repo/worktrees/Feature",
    );
  });

  it("ignores threads linked to different worktrees", () => {
    const threads = [
      makeThread({
        id: ThreadId.make("thread-1"),
        worktreePath: "/tmp/repo/worktrees/feature-a",
      }),
      makeThread({
        id: ThreadId.make("thread-2"),
        worktreePath: "/tmp/repo/worktrees/feature-b",
      }),
    ];
    const result = getOrphanedWorktreePathForThread(threads, ThreadId.make("thread-1"));
    expect(result).toBe("/tmp/repo/worktrees/feature-a");
  });
});
