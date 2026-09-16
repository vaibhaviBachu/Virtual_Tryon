import Link from "next/link";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const PLANNED_SECTIONS = [
  { name: "Try-on history", milestone: "Milestone 4+" },
  { name: "Basic analytics", milestone: "Milestone 7" },
  { name: "System status", milestone: "Milestone 1 (below)" },
];

export default function AdminPlaceholderPage() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-[family-name:var(--font-display)] text-3xl">Admin</h1>
        <Link href="/" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
          Back to site
        </Link>
      </div>

      <Card className="mb-8">
        <CardContent>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Catalogue management (categories, jewellery items, and asset processing) is
            implemented — see <strong>Catalogue</strong> below. Everything else on this
            page is <strong>not implemented yet</strong> and is scoped to later
            milestones per <code>docs/roadmap.md</code>.
          </p>
        </CardContent>
      </Card>

      <div className="mb-3 flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <span className="text-sm">
          <Link href="/admin/catalogue" className="font-medium hover:underline">
            Catalogue management
          </Link>
        </span>
        <Badge>Milestone 2</Badge>
      </div>

      <div className="grid gap-3">
        {PLANNED_SECTIONS.map((section) => (
          <div
            key={section.name}
            className="flex items-center justify-between rounded-xl border border-neutral-200 px-4 py-3 dark:border-neutral-800"
          >
            <span className="text-sm">{section.name}</span>
            <Badge>{section.milestone}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
