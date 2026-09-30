import { Hammer } from "lucide-react";
import { Card } from "@/components/ds/Card";
import { EmptyState } from "@/components/ds/EmptyState";
import { PageHeader } from "@/components/ds/PageHeader";

/** Stand-in for routes whose owning lane has not built them yet. The owning lane replaces the page. */
export function Placeholder({ title, eyebrow }: { title: string; eyebrow?: string }) {
  return (
    <>
      <PageHeader eyebrow={eyebrow} title={title} />
      <Card>
        <EmptyState icon={Hammer} title="This view is being built" body="It will appear here in a later release of this build." />
      </Card>
    </>
  );
}
