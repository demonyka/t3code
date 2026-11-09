import type { EnvironmentId } from "@t3tools/contracts";
import { sanitizeNewRefName } from "@t3tools/shared/git";
import { useEffect, useId, useState } from "react";
import { create } from "zustand";

import { useAtomCommand } from "../state/use-atom-command";
import { vcsEnvironment } from "../state/vcs";
import { isValidNewBranchName } from "./BranchToolbar.logic";
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
  readonly baseBranch: string | null;
}

type Pending = NewWorktreeRequest & {
  readonly resolve: (choice: { readonly branch: string | null } | null) => void;
};

const usePendingRequest = create<{ pending: Pending | null }>(() => ({ pending: null }));

/** Resolves with the chosen name, a null name to generate one, or null when cancelled. */
export function requestNewWorktreeName(request: NewWorktreeRequest) {
  usePendingRequest.getState().pending?.resolve(null);
  return new Promise<{ readonly branch: string | null } | null>((resolve) =>
    usePendingRequest.setState({ pending: { ...request, resolve } }),
  );
}

function finish(choice: { readonly branch: string | null } | null) {
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
  const [isChecking, setIsChecking] = useState(false);
  const branch = sanitizeNewRefName(value);

  const submit = async () => {
    if (branch === "") {
      finish({ branch: null });
      return;
    }
    if (!isValidNewBranchName(branch)) {
      setError("Git does not allow this name.");
      return;
    }
    setIsChecking(true);
    const refs = await readRefs({
      environmentId: pending.environmentId,
      input: { cwd: pending.cwd, query: branch, refKind: "local", limit: 100 },
    });
    setIsChecking(false);
    // A failed check falls through: the server still rejects a duplicate on send.
    if (refs._tag === "Success" && refs.value.refs.some((ref) => ref.name === branch)) {
      setError(`Branch ${branch} already exists.`);
      return;
    }
    finish({ branch });
  };

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
                }}
              />
              {error === null ? null : (
                <p className="text-xs text-destructive-foreground">{error}</p>
              )}
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isChecking}>
              {isChecking ? <Spinner size="sm" /> : null}
              Continue
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
