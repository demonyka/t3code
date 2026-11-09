import type { EnvironmentId } from "@t3tools/contracts";
import { sanitizeNewRefName } from "@t3tools/shared/git";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import {
  type ExistingBranchTarget,
  isValidNewBranchName,
  resolveExistingBranchTarget,
} from "./BranchToolbar.logic";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Spinner } from "./ui/spinner";

interface NewWorktreeRequest {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly projectCwd: string;
  readonly baseBranch: string | null;
}

export type NewWorktreeChoice =
  | { readonly kind: "new"; readonly branch: string | null }
  | { readonly kind: "existing"; readonly branch: string; readonly target: ExistingBranchTarget };

type Pending = NewWorktreeRequest & {
  readonly resolve: (choice: NewWorktreeChoice | null) => void;
};

function describeExistingBranch(branch: string, target: ExistingBranchTarget) {
  switch (target.kind) {
    case "branch":
      return `Branch ${branch} already exists.`;
    case "remote":
      return `Branch ${branch} already exists as ${target.remoteRef}.`;
    case "worktree":
      return `Branch ${branch} is already open in a worktree.`;
    case "project-folder":
      return `Branch ${branch} is checked out in the project folder.`;
  }
}

const usePendingRequest = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** Resolves with what the user chose, or null when cancelled. A null name generates one. */
export function requestNewWorktreeName(request: NewWorktreeRequest) {
  usePendingRequest.getState().pending?.resolve(null);
  return new Promise<NewWorktreeChoice | null>((resolve) =>
    usePendingRequest.setState({ pending: { ...request, resolve } }),
  );
}

function finish(choice: NewWorktreeChoice | null) {
  const pending = usePendingRequest.getState().pending;
  usePendingRequest.setState({ pending: null });
  pending?.resolve(choice);
}

export function NewWorktreeDialogHost() {
  const pending = usePendingRequest((state) => state.pending);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- resolves a pending request promise when the host unmounts
  useEffect(() => () => finish(null), []);
  return pending ? <NewWorktreeDialog key={pending.cwd} pending={pending} /> : null;
}

function NewWorktreeDialog({ pending }: { pending: Pending }) {
  const id = useId();
  const readRefs = useAtomCommand(vcsEnvironment.readRefs, { reportFailure: false });
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [existing, setExisting] = useState<ExistingBranchTarget | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const branch = sanitizeNewRefName(value);

  const submit = async () => {
    if (existing !== null) {
      finish({ kind: "existing", branch, target: existing });
      return;
    }
    if (branch === "") {
      finish({ kind: "new", branch: null });
      return;
    }
    if (!isValidNewBranchName(branch)) {
      setError("Git does not allow this name.");
      return;
    }
    setIsChecking(true);
    const refs = await readRefs({
      environmentId: pending.environmentId,
      input: { cwd: pending.cwd, query: branch, limit: 100 },
    });
    setIsChecking(false);
    // A failed check falls through: the server still rejects a duplicate on send.
    const target =
      refs._tag === "Success"
        ? resolveExistingBranchTarget({
            refs: refs.value.refs,
            branch,
            projectCwd: pending.projectCwd,
          })
        : null;
    if (target !== null) {
      setExisting(target);
      return;
    }
    finish({ kind: "new", branch });
  };

  const opensExistingCheckout =
    existing?.kind === "worktree" || existing?.kind === "project-folder";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) finish(null);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <form
          className="flex min-h-0 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogHeader>
            <DialogTitle>New worktree</DialogTitle>
            <DialogDescription>
              {pending.baseBranch === null
                ? "Starts from the project's default branch."
                : `Starts from ${pending.baseBranch}.`}{" "}
              It is created when you send the first message.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-2">
              <Label htmlFor={id}>Branch and worktree name</Label>
              <Input
                id={id}
                autoFocus
                value={value}
                placeholder="Leave empty to name it from the first message"
                aria-invalid={error !== null || undefined}
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                  setExisting(null);
                }}
              />
              {error === null ? null : (
                <p className="text-xs text-destructive-foreground">{error}</p>
              )}
              {existing === null ? null : (
                <p className="text-xs text-muted-foreground">
                  {describeExistingBranch(branch, existing)}
                </p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isChecking}>
              {isChecking ? <Spinner size="sm" /> : null}
              {existing === null
                ? "Continue"
                : opensExistingCheckout
                  ? "New chat there"
                  : "Open in a worktree"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
