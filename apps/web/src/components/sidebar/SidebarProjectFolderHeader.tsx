import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ArrowDownIcon, ChevronDownIcon, RefreshCwIcon, SquarePenIcon } from "lucide-react";
import { memo, useTransition } from "react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";

import { cn } from "~/lib/utils";
import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { useEnvironmentQuery } from "../../state/query";
import { useVcsPullAction } from "../../state/sourceControlActions";
import { useAtomCommand } from "../../state/use-atom-command";
import { vcsEnvironment } from "../../state/vcs";
import { useUiStateStore } from "../../uiStateStore";
import {
  resolveSidebarFolderDot,
  resolveThreadLastVisitedAt,
  useSidebarRowSubscriptionLease,
} from "../Sidebar.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { stackedThreadToast, toastManager } from "../ui/toast";

const FOLDER_DOT_CLASS_NAME = {
  attention: "bg-warning",
  failed: "bg-error",
  unread: "bg-success",
  working: "bg-info",
} as const;

const FOLDER_DOT_LABEL = {
  attention: ", needs you",
  failed: ", failed",
  unread: ", done",
  working: ", working",
} as const;

/** The folder's sidebar tree row; its thread rows name it as their parent. */
export function sidebarFolderRowId(projectKey: string) {
  return `folder:${projectKey}`;
}

/** Summarizes the chats a closed tree row is hiding. */
export function SidebarFolderStatusDot(props: { threads: readonly EnvironmentThreadShell[] }) {
  const localLastVisitedAtById = useUiStateStore((state) => state.threadLastVisitedAtById);
  const dot = resolveSidebarFolderDot(
    props.threads.map((thread) => ({
      ...thread,
      lastVisitedAt: resolveThreadLastVisitedAt(
        thread.lastVisitedAt,
        localLastVisitedAtById[scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))],
      ),
    })),
  );
  if (dot === null) return null;
  return (
    <span className={cn("size-1.5 shrink-0 rounded-full", FOLDER_DOT_CLASS_NAME[dot])}>
      <span className="sr-only">{FOLDER_DOT_LABEL[dot]}</span>
    </span>
  );
}

/** Pull is only offered when it can fast-forward; a diverged branch needs a person. */
function ProjectUpdateControl(props: {
  environmentId: SidebarProjectSnapshot["environmentId"];
  cwd: string;
  branch: string | null;
  aheadCount: number;
  behindCount: number;
  hasWorkingTreeChanges: boolean;
}) {
  const pull = useVcsPullAction({ environmentId: props.environmentId, cwd: props.cwd });
  const { aheadCount, behindCount } = props;
  const diverged = aheadCount > 0 && behindCount > 0;
  const runPull = async () => {
    const result = await pull.run();
    if (result._tag !== "Failure" || isAtomCommandInterrupted(result)) return;
    const error = squashAtomCommandFailure(result);
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: `Could not update ${props.branch ?? "branch"}`,
        description: error instanceof Error ? error.message : "An error occurred.",
      }),
    );
  };
  const hint = diverged
    ? `${props.branch ?? "This branch"} has diverged: ${aheadCount} local and ${behindCount} remote commits. Rebase or merge it in a chat.`
    : `Pull ${behindCount} new commit${behindCount === 1 ? "" : "s"} into ${props.branch ?? "this branch"}${
        props.hasWorkingTreeChanges ? ". Uncommitted changes are kept unless they conflict" : ""
      }`;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            size="xs"
            variant="ghost-muted"
            aria-label={hint}
            disabled={diverged || pull.isPending}
            onClick={() => void runPull()}
          />
        }
      >
        {pull.isPending ? <Spinner size="xs" /> : <ArrowDownIcon aria-hidden />}
        <span className="tabular-nums text-warning">{behindCount}</span>
      </TooltipTrigger>
      <TooltipPopup>{hint}</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The root of a project's tree, standing for its main checkout: the project name,
 * the checkout's live branch, and whether that branch has updates waiting.
 */
export const SidebarProjectFolderHeader = memo(function SidebarProjectFolderHeader(props: {
  group: SidebarProjectSnapshot;
  collapsed: boolean;
  hiddenThreads: readonly EnvironmentThreadShell[];
  onToggle: (group: SidebarProjectSnapshot) => void;
  onNewThread: (group: SidebarProjectSnapshot) => void;
  onContextMenu: (group: SidebarProjectSnapshot, position: { x: number; y: number }) => void;
}) {
  const { group, collapsed, hiddenThreads } = props;
  const rowId = sidebarFolderRowId(group.projectKey);
  const { leaseLiveStatus, rowRef } = useSidebarRowSubscriptionLease(false);
  const statusQuery = useEnvironmentQuery(
    leaseLiveStatus
      ? vcsEnvironment.status({
          environmentId: group.environmentId,
          input: { cwd: group.workspaceRoot },
        })
      : null,
  );
  const status = statusQuery.data?.isRepo ? statusQuery.data : null;
  const refreshStatus = useAtomCommand(vcsEnvironment.refreshStatus, { reportFailure: false });
  const [isRefreshing, startRefreshing] = useTransition();
  const checkForUpdates = () => {
    startRefreshing(async () => {
      await refreshStatus({
        environmentId: group.environmentId,
        input: { cwd: group.workspaceRoot },
      });
    });
  };
  const branch = status?.refName ?? null;
  const canCheckForUpdates = status?.hasPrimaryRemote === true;
  return (
    <li
      ref={rowRef}
      data-testid="sidebar-project-folder"
      className="group/project-folder relative mt-2 flex h-8 list-none items-center rounded-(--control-radius) pe-1 first:mt-0 hover:bg-sidebar-row-hover"
      onContextMenu={(event) => {
        event.preventDefault();
        props.onContextMenu(group, { x: event.clientX, y: event.clientY });
      }}
    >
      <button
        type="button"
        data-sidebar-row={rowId}
        aria-expanded={!collapsed}
        onClick={() => props.onToggle(group)}
        className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-(--control-radius) ps-(--sidebar-row-content-inset) text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <ProjectFavicon project={group} className="size-4 shrink-0" />
        <span className="flex min-w-0 flex-1 items-baseline gap-1 text-sm">
          <span className="min-w-0 shrink truncate font-medium text-sidebar-foreground/90">
            {group.displayName}
          </span>
          {branch === null ? null : (
            <span className="min-w-0 flex-1 truncate text-sidebar-muted-foreground">
              - {branch}
            </span>
          )}
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-1 ps-1.5">
        {status && status.aheadCount > 0 ? (
          <Tooltip>
            <TooltipTrigger
              render={<span className="text-xs tabular-nums text-sidebar-muted-foreground" />}
            >
              ↑{status.aheadCount}
            </TooltipTrigger>
            <TooltipPopup>
              {status.aheadCount} local commit{status.aheadCount === 1 ? "" : "s"} not pushed yet
            </TooltipPopup>
          </Tooltip>
        ) : null}
        {status?.hasUpstream && status.behindCount > 0 ? (
          <ProjectUpdateControl
            environmentId={group.environmentId}
            cwd={group.workspaceRoot}
            branch={branch}
            aheadCount={status.aheadCount}
            behindCount={status.behindCount}
            hasWorkingTreeChanges={status.hasWorkingTreeChanges}
          />
        ) : null}
        {collapsed ? <SidebarFolderStatusDot threads={hiddenThreads} /> : null}
        {collapsed && hiddenThreads.length > 0 ? (
          <span className="text-xs tabular-nums text-sidebar-muted-foreground group-hover/project-folder:hidden pointer-coarse:hidden">
            {hiddenThreads.length}
          </span>
        ) : null}
        {isRefreshing ? <Spinner size="xs" tone="muted" /> : null}
        <span className="hidden items-center group-focus-within/project-folder:inline-flex group-hover/project-folder:inline-flex pointer-coarse:inline-flex">
          {canCheckForUpdates && !isRefreshing ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost-muted"
                    aria-label={`Check ${group.displayName} for updates`}
                    onClick={checkForUpdates}
                  />
                }
              >
                <RefreshCwIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>Check for updates</TooltipPopup>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  data-sidebar-action-for={rowId}
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`New thread in ${group.displayName}`}
                  onClick={() => props.onNewThread(group)}
                />
              }
            >
              <SquarePenIcon aria-hidden />
            </TooltipTrigger>
            <TooltipPopup>New thread in {group.displayName}</TooltipPopup>
          </Tooltip>
        </span>
        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-3 shrink-0 text-sidebar-muted-foreground transition-transform",
            collapsed && "-rotate-90",
          )}
        />
      </span>
    </li>
  );
});
