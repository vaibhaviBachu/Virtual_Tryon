import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AssistantButton } from "@/components/jewellery-ai/AssistantButton";

describe("AssistantButton", () => {
  it("has an accessible label and calls onClick when pressed", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<AssistantButton onClick={onClick} hasUnfinishedWork={false} />);

    const button = screen.getByRole("button", { name: /open jewellery ai assistant/i });
    await user.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("shows an unfinished-work indicator only when there is unfinished work", () => {
    const { rerender } = render(<AssistantButton onClick={() => {}} hasUnfinishedWork={false} />);
    expect(screen.queryByText("✦", { selector: "span.absolute" })).not.toBeInTheDocument();

    rerender(<AssistantButton onClick={() => {}} hasUnfinishedWork />);
    expect(document.querySelector("span.absolute")).toBeInTheDocument();
  });
});
