import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AdminLoginForm } from "@/components/admin/AdminLoginForm";
import { useAdminAuthStore } from "@/store/admin-auth-store";
import * as catalogueApi from "@/lib/catalogue-api";

vi.mock("@/lib/catalogue-api", async () => {
  const actual = await vi.importActual<typeof catalogueApi>("@/lib/catalogue-api");
  return { ...actual, login: vi.fn(), getCurrentUser: vi.fn() };
});

describe("AdminLoginForm", () => {
  afterEach(() => {
    useAdminAuthStore.getState().clearSession();
    vi.clearAllMocks();
  });

  it("logs an admin in and populates the session store", async () => {
    vi.mocked(catalogueApi.login).mockResolvedValue({ access_token: "fake-token", token_type: "bearer" });
    vi.mocked(catalogueApi.getCurrentUser).mockResolvedValue({
      id: "1",
      email: "admin@example.com",
      role: "admin",
    });

    const user = userEvent.setup();
    render(<AdminLoginForm />);

    await user.type(screen.getByLabelText(/email/i), "admin@example.com");
    await user.type(screen.getByLabelText(/password/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => {
      expect(useAdminAuthStore.getState().token).toBe("fake-token");
      expect(useAdminAuthStore.getState().email).toBe("admin@example.com");
    });
  });

  it("shows a real error and does not set a session when the account is not an admin", async () => {
    vi.mocked(catalogueApi.login).mockResolvedValue({ access_token: "fake-token", token_type: "bearer" });
    vi.mocked(catalogueApi.getCurrentUser).mockResolvedValue({
      id: "2",
      email: "customer@example.com",
      role: "customer",
    });

    const user = userEvent.setup();
    render(<AdminLoginForm />);
    await user.type(screen.getByLabelText(/email/i), "customer@example.com");
    await user.type(screen.getByLabelText(/password/i), "correct-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/administrator access/i);
    expect(useAdminAuthStore.getState().token).toBeNull();
  });

  it("shows the backend's real error message on failed login", async () => {
    vi.mocked(catalogueApi.login).mockRejectedValue(new catalogueApi.ApiError("Incorrect email or password.", 401));

    const user = userEvent.setup();
    render(<AdminLoginForm />);
    await user.type(screen.getByLabelText(/email/i), "wrong@example.com");
    await user.type(screen.getByLabelText(/password/i), "wrong-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Incorrect email or password.");
  });
});
