import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Database02Icon } from "@hugeicons/core-free-icons";

export function Brand() {
  return (
    <Link to="/" aria-label="Sapienta home" className="flex w-fit items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-primary text-primary-foreground shadow-xs">
        <HugeiconsIcon icon={Database02Icon} size={19} strokeWidth={1.8} aria-hidden="true" />
      </span>
      <span className="text-lg font-semibold tracking-[-0.045em]">sapienta<span className="text-primary">.</span></span>
    </Link>
  );
}
