/** Generic chat bubble shared by every assistant step — bot messages on the left in a
 * soft champagne bubble, the rare "user" message (e.g. echoing back what was uploaded)
 * on the right in deep red. Matches the Lumière brand palette used throughout
 * components/live/* (site-header.tsx, HeroIntro.tsx) rather than a generic chat-widget
 * look. */
export function BotMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className="mt-0.5 flex h-6 w-6 flex-none items-center justify-center rounded-full bg-[#C9A24A] text-xs text-white"
      >
        ✦
      </span>
      <div className="max-w-[85%] rounded-2xl rounded-tl-sm bg-[#F8EEE5] px-3.5 py-2.5 text-sm text-neutral-800">
        {children}
      </div>
    </div>
  );
}

export function UserMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-[#C90016] px-3.5 py-2.5 text-sm text-white">
        {children}
      </div>
    </div>
  );
}
