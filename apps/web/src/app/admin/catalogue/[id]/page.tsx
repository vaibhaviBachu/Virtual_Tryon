"use client";

import { use, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { SiteHeader } from "@/components/site-header";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { AssetPreview } from "@/components/admin/AssetPreview";
import { AssetUploader } from "@/components/admin/AssetUploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { archiveJewellery, getJewellery, listAssets, updateJewellery } from "@/lib/catalogue-api";
import { useAdminAuthStore } from "@/store/admin-auth-store";

export default function JewelleryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { token, email, clearSession } = useAdminAuthStore();
  const queryClient = useQueryClient();
  const [editValues, setEditValues] = useState<{ name: string; description: string } | null>(null);

  const jewelleryQuery = useQuery({
    queryKey: ["jewellery", id],
    queryFn: () => getJewellery(id),
    enabled: Boolean(token),
  });

  const assetsQuery = useQuery({
    queryKey: ["assets", id],
    queryFn: () => listAssets(id),
    enabled: Boolean(token),
    refetchInterval: (query) => {
      const hasInFlight = query.state.data?.some(
        (a) => a.processing_status === "pending" || a.processing_status === "processing"
      );
      return hasInFlight ? 2000 : false;
    },
  });

  const updateMutation = useMutation({
    mutationFn: (input: { name?: string; description?: string }) => updateJewellery(id, input, token!),
    onSuccess: () => {
      setEditValues(null);
      queryClient.invalidateQueries({ queryKey: ["jewellery", id] });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveJewellery(id, token!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jewellery", id] }),
  });

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <Link href="/admin/catalogue" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
            ← Back to catalogue
          </Link>
          {token && (
            <div className="flex items-center gap-2 text-sm text-neutral-500">
              <span>{email}</span>
              <Button size="sm" variant="ghost" onClick={clearSession}>
                Sign out
              </Button>
            </div>
          )}
        </div>

        {!token ? (
          <AdminLoginForm />
        ) : (
          <>
            {jewelleryQuery.isLoading && <p className="text-sm text-neutral-500">Loading…</p>}
            {jewelleryQuery.isError && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                Jewellery item not found.
              </p>
            )}
            {jewelleryQuery.data && (
              <div className="flex flex-col gap-6">
                <Card>
                  <CardContent>
                    <div className="mb-4 flex items-center justify-between">
                      {editValues ? (
                        <input
                          value={editValues.name}
                          onChange={(e) => setEditValues({ ...editValues, name: e.target.value })}
                          className="rounded-lg border border-neutral-300 px-3 py-2 text-xl dark:border-neutral-700 dark:bg-neutral-900"
                        />
                      ) : (
                        <h1 className="text-2xl font-medium">{jewelleryQuery.data.name}</h1>
                      )}
                      <Badge>{jewelleryQuery.data.is_active ? "active" : "archived"}</Badge>
                    </div>

                    <dl className="grid grid-cols-2 gap-y-1 text-sm text-neutral-600 dark:text-neutral-400 sm:grid-cols-4">
                      <dt className="font-medium text-neutral-900 dark:text-neutral-100">Category</dt>
                      <dd>{jewelleryQuery.data.category.name}</dd>
                      <dt className="font-medium text-neutral-900 dark:text-neutral-100">SKU</dt>
                      <dd>{jewelleryQuery.data.sku}</dd>
                      <dt className="font-medium text-neutral-900 dark:text-neutral-100">Dimensions</dt>
                      <dd>
                        {jewelleryQuery.data.physical_width_mm ?? "—"} × {jewelleryQuery.data.physical_height_mm ?? "—"} ×{" "}
                        {jewelleryQuery.data.physical_depth_mm ?? "—"} mm
                      </dd>
                      <dt className="font-medium text-neutral-900 dark:text-neutral-100">Weight</dt>
                      <dd>{jewelleryQuery.data.weight_g ?? "—"} g</dd>
                      <dt className="font-medium text-neutral-900 dark:text-neutral-100">Created</dt>
                      <dd>{new Date(jewelleryQuery.data.created_at).toLocaleString()}</dd>
                      <dt className="font-medium text-neutral-900 dark:text-neutral-100">Updated</dt>
                      <dd>{new Date(jewelleryQuery.data.updated_at).toLocaleString()}</dd>
                    </dl>

                    <div className="mt-4 flex gap-2">
                      {editValues ? (
                        <>
                          <Button
                            size="sm"
                            onClick={() => updateMutation.mutate(editValues)}
                            disabled={updateMutation.isPending}
                          >
                            Save
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setEditValues(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setEditValues({
                                name: jewelleryQuery.data.name,
                                description: jewelleryQuery.data.description ?? "",
                              })
                            }
                          >
                            Edit
                          </Button>
                          {jewelleryQuery.data.is_active && (
                            <Button size="sm" variant="secondary" onClick={() => archiveMutation.mutate()}>
                              Archive
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent>
                    <h2 className="mb-4 text-lg font-medium">Assets</h2>
                    <AssetUploader jewelleryId={id} />

                    {assetsQuery.isLoading && <p className="mt-4 text-sm text-neutral-500">Loading assets…</p>}
                    {assetsQuery.data && assetsQuery.data.length === 0 && (
                      <p className="mt-4 text-sm text-neutral-500">No photos uploaded yet.</p>
                    )}
                    {assetsQuery.data && assetsQuery.data.length > 0 && (
                      <div className="mt-6 flex flex-wrap gap-6">
                        {["original", "processed", "thumbnail"].map((type) => {
                          const asset = assetsQuery.data
                            ?.filter((a) => a.asset_type === type)
                            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
                          return asset ? <AssetPreview key={asset.id} asset={asset} /> : null;
                        })}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
