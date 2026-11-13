"use client";

import { Lock } from "lucide-react";
import { EmptyState, LinkButton } from "@/components/ds";
import { humanize } from "@/lib/format";

/** Shown instead of a page the signed-in role can't open (the API would refuse it anyway). */
export function NoAccess({ role }: { role: string }) {
  return (
    <div className="py-6">
      <h1 className="sr-only">No access</h1>
      <EmptyState
        title="You don’t have access to this page"
        icon={Lock}
        action={
          <LinkButton href={role === "DRIVER" ? "/trips" : "/dashboard"} variant="secondary">
            {role === "DRIVER" ? "Go to my trips" : "Go to the Control Tower"}
          </LinkButton>
        }
      >
        Your role ({humanize(role)}) can’t open this page. Ask a company admin if you need access.
      </EmptyState>
    </div>
  );
}
