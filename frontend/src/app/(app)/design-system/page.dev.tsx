import { Catalogue } from "./Catalogue";

/**
 * Development-only component catalogue (not linked from the app).
 * The `.dev.tsx` extension is only routed by `next dev` — see next.config.ts.
 */
export default function DesignSystemPage() {
  return <Catalogue />;
}
