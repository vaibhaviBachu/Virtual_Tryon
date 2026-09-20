"use client";

import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { deleteJewelleryPermanently, listCategories, listJewellery } from "@/lib/catalogue-api";
import { useAdminAuthStore } from "@/store/admin-auth-store";

const PAGE_SIZE = 10;

export function JewelleryList() {
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");
  const [page, setPage] = useState(1);
  const [deleteErrorId, setDeleteErrorId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const token = useAdminAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ["categories", "all"], queryFn: () => listCategories() });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteJewelleryPermanently(id, token!),
    onSuccess: () => {
      setDeleteErrorId(null);
      // Broad (partial-key) invalidation -- matches every filter/page variation of
      // this list's own query key, not just whatever's currently on screen.
      queryClient.invalidateQueries({ queryKey: ["jewellery"] });
    },
    onError: (err, id) => {
      setDeleteErrorId(id);
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete this item.");
    },
  });

  const jewelleryQuery = useQuery({
    queryKey: ["jewellery", { search, categoryId, statusFilter, page }],
    queryFn: () =>
      listJewellery({
        search: search || undefined,
        categoryId: categoryId || undefined,
        isActive: statusFilter === "all" ? undefined : statusFilter === "active",
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const totalPages = jewelleryQuery.data ? Math.max(1, Math.ceil(jewelleryQuery.data.total / PAGE_SIZE)) : 1;

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-medium">Jewellery</h2>

        <div className="mb-4 grid gap-2 sm:grid-cols-4">
          <input
            placeholder="Search name or SKU"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">All categories</option>
            {categoriesQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value as typeof statusFilter);
              setPage(1);
            }}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="all">All statuses</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
        </div>

        {jewelleryQuery.isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
        {jewelleryQuery.isError && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            Could not load jewellery items.
          </p>
        )}

        {jewelleryQuery.data && jewelleryQuery.data.items.length === 0 && (
          <p className="text-sm text-neutral-500">No jewellery items match these filters.</p>
        )}

        {jewelleryQuery.data && jewelleryQuery.data.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Category</th>
                  <th className="py-2 pr-4">SKU</th>
                  <th className="py-2 pr-4">Dimensions (mm)</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jewelleryQuery.data.items.map((item) => (
                  <tr key={item.id} className="border-t border-neutral-100 dark:border-neutral-900">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/catalogue/${item.id}`} className="hover:underline">
                        {item.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{item.category.name}</td>
                    <td className="py-2 pr-4">{item.sku}</td>
                    <td className="py-2 pr-4">
                      {item.physical_width_mm ?? "—"} × {item.physical_height_mm ?? "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge>{item.is_active ? "active" : "inactive"}</Badge>
                    </td>
                    <td className="py-2 pr-4">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={deleteMutation.isPending && deleteMutation.variables === item.id}
                        onClick={() => {
                          // Permanent -- also deletes this item's assets (storage files
                          // included) and any saved try-on captures/renders that
                          // reference it, via the database's own cascade. Not the same
                          // as Archive (reversible, on the item's own detail page).
                          if (
                            !window.confirm(
                              `Permanently delete "${item.name}"? This removes its photos and any saved try-ons using it, and can't be undone.`
                            )
                          ) {
                            return;
                          }
                          setDeleteErrorId(null);
                          deleteMutation.mutate(item.id);
                        }}
                        className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {deleteMutation.isPending && deleteMutation.variables === item.id ? "Deleting…" : "Delete"}
                      </Button>
                      {deleteErrorId === item.id && deleteError && (
                        <p role="alert" className="mt-1 max-w-[10rem] text-[10px] text-red-600 dark:text-red-400">
                          {deleteError}
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {jewelleryQuery.data && jewelleryQuery.data.total > PAGE_SIZE && (
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:hover:text-white"
            >
              Previous
            </button>
            <span>
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="text-neutral-500 hover:text-neutral-900 disabled:opacity-40 dark:hover:text-white"
            >
              Next
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
