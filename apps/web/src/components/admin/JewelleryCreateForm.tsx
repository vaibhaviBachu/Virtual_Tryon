"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createJewellery, listCategories } from "@/lib/catalogue-api";
import { useAdminAuthStore } from "@/store/admin-auth-store";

const SLUG_PATTERN = /^[a-z0-9-]+$/;

export function JewelleryCreateForm() {
  const token = useAdminAuthStore((s) => s.token);
  const queryClient = useQueryClient();
  const categoriesQuery = useQuery({ queryKey: ["categories", "all"], queryFn: () => listCategories() });

  const [form, setForm] = useState({
    categoryId: "",
    name: "",
    slug: "",
    sku: "",
    description: "",
    price: "",
    currency: "",
    widthMm: "",
    heightMm: "",
    depthMm: "",
    weightG: "",
  });
  const [clientError, setClientError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: () =>
      createJewellery(
        {
          category_id: form.categoryId,
          name: form.name,
          slug: form.slug,
          sku: form.sku,
          description: form.description || undefined,
          price: form.price ? Number(form.price) : undefined,
          currency: form.currency || undefined,
          physical_width_mm: form.widthMm ? Number(form.widthMm) : undefined,
          physical_height_mm: form.heightMm ? Number(form.heightMm) : undefined,
          physical_depth_mm: form.depthMm ? Number(form.depthMm) : undefined,
          weight_g: form.weightG ? Number(form.weightG) : undefined,
        },
        token!
      ),
    onSuccess: (created) => {
      setSuccessMessage(`Created "${created.name}". Upload a photo from its detail page to start processing.`);
      setForm({
        categoryId: "",
        name: "",
        slug: "",
        sku: "",
        description: "",
        price: "",
        currency: "",
        widthMm: "",
        heightMm: "",
        depthMm: "",
        weightG: "",
      });
      queryClient.invalidateQueries({ queryKey: ["jewellery"] });
    },
    onError: (err) => setClientError(err instanceof Error ? err.message : "Failed to create jewellery item."),
  });

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSuccessMessage(null);

    // Client-side validation mirrors, but never replaces, the mandatory backend
    // validation (apps/api/v1/schemas/jewellery.py) — this only gives faster feedback.
    if (!form.categoryId) return setClientError("Choose a category.");
    if (!SLUG_PATTERN.test(form.slug)) {
      return setClientError("Slug must use only lowercase letters, numbers, and hyphens.");
    }
    setClientError(null);
    createMutation.mutate();
  }

  return (
    <Card>
      <CardContent>
        <h2 className="mb-4 text-lg font-medium">Add jewellery item</h2>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          <select
            required
            value={form.categoryId}
            onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          >
            <option value="">Select category…</option>
            {categoriesQuery.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            placeholder="Name"
            required
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="slug-in-kebab-case"
            required
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="SKU"
            required
            value={form.sku}
            onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Description (optional)"
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm sm:col-span-2 dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Price (optional)"
            type="number"
            min="0"
            step="0.01"
            value={form.price}
            onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Currency, e.g. USD (optional)"
            maxLength={3}
            value={form.currency}
            onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Width (mm)"
            type="number"
            min="0"
            step="0.01"
            value={form.widthMm}
            onChange={(e) => setForm((f) => ({ ...f, widthMm: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Height (mm)"
            type="number"
            min="0"
            step="0.01"
            value={form.heightMm}
            onChange={(e) => setForm((f) => ({ ...f, heightMm: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Depth (mm)"
            type="number"
            min="0"
            step="0.01"
            value={form.depthMm}
            onChange={(e) => setForm((f) => ({ ...f, depthMm: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />
          <input
            placeholder="Weight (g)"
            type="number"
            min="0"
            step="0.01"
            value={form.weightG}
            onChange={(e) => setForm((f) => ({ ...f, weightG: e.target.value }))}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
          />

          <div className="sm:col-span-2">
            {clientError && (
              <p role="alert" className="mb-2 text-sm text-red-600 dark:text-red-400">
                {clientError}
              </p>
            )}
            {successMessage && <p className="mb-2 text-sm text-green-700 dark:text-green-400">{successMessage}</p>}
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Creating…" : "Create jewellery item"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
