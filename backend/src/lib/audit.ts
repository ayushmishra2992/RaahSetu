import { prisma } from "../config/prisma";
import type { AuthContext } from "../middleware/auth";

type Tx = Pick<typeof prisma, "auditEvent">;

/** Record a significant action. Never pass secrets or full request bodies here. */
export async function audit(
  auth: AuthContext,
  action: string,
  entityType: string,
  entityId: number | null,
  metadata?: Record<string, unknown>,
  tx: Tx = prisma,
) {
  await tx.auditEvent.create({
    data: {
      companyId: auth.companyId,
      userId: auth.userId,
      action,
      entityType,
      entityId,
      metadata: (metadata ?? undefined) as never,
    },
  });
}
