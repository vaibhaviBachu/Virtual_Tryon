"use client";

import Link from "next/link";

import { SiteHeader } from "@/components/site-header";
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { CategoryManager } from "@/components/admin/CategoryManager";
import { JewelleryCreateForm } from "@/components/admin/JewelleryCreateForm";
import { JewelleryList } from "@/components/admin/JewelleryList";
import { Button } from "@/components/ui/button";
import { useAdminAuthStore } from "@/store/admin-auth-store";

export default function AdminCataloguePage() {
  const { token, email, clearSession } = useAdminAuthStore();

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-12">
        <div className="mb-8 flex items-center justify-between">
          <h1 className="font-[family-name:var(--font-display)] text-3xl">Catalogue</h1>
          <div className="flex items-center gap-4">
            <Link href="/admin" className="text-sm text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
              Back to admin
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
        </div>

        {!token ? (
          <AdminLoginForm />
        ) : (
          <div className="flex flex-col gap-8">
            <CategoryManager />
            <JewelleryCreateForm />
            <JewelleryList />
          </div>
        )}
      </div>
    </div>
  );
}
