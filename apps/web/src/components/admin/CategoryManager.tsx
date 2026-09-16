"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createCategory, listCategories } from "@/lib/catalogue-api";
import { useAdminAuthStore } from "@/store/admin-auth-store";

/**
 * Category management (Milestone 2 spec §7): categories are entirely database-driven
 * (no hard-coded category list anywhere in this component) — the nine initial
 * categories come from the Milestone 2 migration's seed data, and an admin can add more
 * here without a code change or a new migration.
 */
export function CategoryManager() {
  const token = useAdminAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [anchorType, setAnchorType] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ["categories", "all"],
    queryFn: () => listCategories(),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      createCategory({ name, slug, anchor_type: anchorType || undefined }, token!),
    onSuccess: () => {
      setName("");
      setSlug("");
      setAnchorType("");
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : "Failed to create category."),
  });

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-medium">Categories</h2>

        {categoriesQuery.isLoading && <p className="text-sm text-neutral-500">Loading categories…</p>}
        {categoriesQuery.isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Could not load categories.
          </p>
        )}
        {categoriesQuery.data && (
          <ul className="mb-6 grid gap-2 sm:grid-cols-2">
            {categoriesQuery.data.map((category) => (
              <li
                key={category.id}
                className="flex items-center justify-between rounded-lg border border-neutral-200 px-3 py-2 text-sm dark:border-neutral-800"
              >
                <span>
                  {category.name}{" "}
                  <span className="text-neutral-400">({category.item_count})</span>
                </span>
                {!category.is_active && <Badge>inactive</Badge>}
              </li>
            ))}
          </ul>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
          className="grid gap-2 sm:grid-cols-3"
        >
          <input
            placeholder="Name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="slug_in_snake_case"
            required
            pattern="^[a-z0-9_]+$"
            title="Lowercase letters, numbers, and underscores only"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Anchor type (optional)"
            value={anchorType}
            onChange={(e) => setAnchorType(e.target.value)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <div className="sm:col-span-3">
            {formError && (
              <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
                {formError}
              </p>
            )}
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Add category"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
