import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import { ChevronDownIcon, GitBranchIcon, SquarePenIcon } from "lucide-react";
import { memo } from "react";

import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SidebarFolderStatusDot } from "./SidebarProjectFolderHeader";
import { sidebarWorktreeRowId, type SidebarWorktreeNode } from "./worktreeTree";

type WorktreeNode = SidebarWorktreeNode<EnvironmentThreadShell>;

const DEPTH_INDENT_PX = 12;

function worktreeLabel(node: WorktreeNode) {
  const name = node.branch ?? node.path.split("/").at(-1) ?? node.path;
  return node.checkoutLabel === null ? name : `${name} · ${node.checkoutLabel}`;
}

function describeBaseDrift(node: WorktreeNode) {
  const base = node.baseBranch ?? "its base";
  const parts = [
    node.behindBase ? `${node.behindBase} behind ${base}, which has newer commits` : null,
    node.aheadOfBase ? `${node.aheadOfBase} ahead of ${base}` : null,
  ].flatMap((part) => (part === null ? [] : [part]));
  return parts.join(", ");
}

/** A worktree in the sidebar tree: its branch, how far it drifted, and its chats below. */
export const SidebarWorktreeRow = memo(function SidebarWorktreeRow(props: {
  node: WorktreeNode;
  depth: number;
  parentRow: string;
  collapsed: boolean;
  isDeleting: boolean;
  hiddenThreads: readonly EnvironmentThreadShell[];
  onToggle: (node: WorktreeNode) => void;
  onNewThread: (node: WorktreeNode) => void;
  onContextMenu: (node: WorktreeNode, position: { x: number; y: number }) => void;
}) {
  const { node, collapsed, hiddenThreads } = props;
  const rowId = sidebarWorktreeRowId(node.key);
  const label = worktreeLabel(node);
  const drift = describeBaseDrift(node);
  return (
    <li
      data-testid="sidebar-worktree-row"
      className="group/worktree-row relative flex h-7 list-none items-center rounded-(--control-radius) pe-1 hover:bg-sidebar-row-hover"
      onContextMenu={(event) => {
        event.preventDefault();
        props.onContextMenu(node, { x: event.clientX, y: event.clientY });
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              data-sidebar-row={rowId}
              data-sidebar-parent={props.parentRow}
              aria-expanded={!collapsed}
              onClick={() => props.onToggle(node)}
              style={{
                paddingInlineStart: `calc(var(--sidebar-row-content-inset) + ${props.depth * DEPTH_INDENT_PX}px)`,
              }}
              className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-(--control-radius) text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            />
          }
        >
          {props.isDeleting ? (
            <Spinner size="sm" tone="muted" className="shrink-0" />
          ) : (
            <GitBranchIcon
              aria-hidden
              className="size-3.5 shrink-0 text-sidebar-muted-foreground"
            />
          )}
          <span className="min-w-0 flex-1 truncate text-sm text-sidebar-foreground/80">
            {props.isDeleting ? `Deleting ${label}…` : label}
          </span>
        </TooltipTrigger>
        <TooltipPopup>{node.path}</TooltipPopup>
      </Tooltip>
      <span className="flex shrink-0 items-center gap-1.5 ps-1.5">
        {drift === "" ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="flex items-center gap-1 text-xs tabular-nums text-sidebar-muted-foreground" />
              }
            >
              {node.aheadOfBase ? <span>↑{node.aheadOfBase}</span> : null}
              {node.behindBase ? <span className="text-warning">↓{node.behindBase}</span> : null}
            </TooltipTrigger>
            <TooltipPopup>{drift}</TooltipPopup>
          </Tooltip>
        )}
        {collapsed ? <SidebarFolderStatusDot threads={hiddenThreads} /> : null}
        {collapsed && hiddenThreads.length > 0 ? (
          <span className="text-xs tabular-nums text-sidebar-muted-foreground group-hover/worktree-row:hidden pointer-coarse:hidden">
            {hiddenThreads.length}
          </span>
        ) : null}
        <span className="hidden group-focus-within/worktree-row:inline-flex group-hover/worktree-row:inline-flex pointer-coarse:inline-flex">
          <Button
            data-sidebar-action-for={rowId}
            size="icon-xs"
            variant="ghost-muted"
            aria-label={`New thread in ${label}`}
            onClick={() => props.onNewThread(node)}
          >
            <SquarePenIcon aria-hidden />
          </Button>
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
