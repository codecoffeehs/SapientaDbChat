import { useState, type ReactNode } from "react";

// Fixed-height rows keep rendering bounded even for very large catalogs.
export function VirtualList<T>({ items, rowHeight = 72, renderItem, label }: {
  items: T[];
  rowHeight?: number;
  renderItem: (item: T, index: number) => ReactNode;
  label: string;
}) {
  const [scrollTop, setScrollTop] = useState(0);
  const [focused, setFocused] = useState<number | null>(null);
  const height = Math.min(320, items.length * rowHeight);
  const start = Math.max(0, Math.min(items.length - 1, Math.floor(scrollTop / rowHeight)) - 4);
  const end = Math.min(items.length, start + Math.ceil(height / rowHeight) + 8);
  const indices = Array.from({ length: end - start }, (_, i) => start + i);
  if (focused !== null && focused < items.length && !indices.includes(focused)) indices.push(focused);
  indices.sort((a, b) => a - b);
  return <div
    role="list"
    aria-label={label}
    tabIndex={0}
    className="overflow-y-auto"
    style={{ height }}
    onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null); }}
    onKeyDown={(event) => {
      if (focused === null) return;
      let next: number | undefined;
      if (event.key === "ArrowDown") next = Math.min(items.length - 1, focused + 1);
      if (event.key === "ArrowUp") next = Math.max(0, focused - 1);
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = items.length - 1;
      // Keep checkbox tab order usable across virtual window boundaries.
      if (event.key === "Tab") {
        const candidate = focused + (event.shiftKey ? -1 : 1);
        if (candidate >= 0 && candidate < items.length) next = candidate;
      }
      if (next === undefined) return;
      event.preventDefault();
      const container = event.currentTarget;
      const top = next * rowHeight;
      if (top < container.scrollTop || top + rowHeight > container.scrollTop + height) container.scrollTop = top;
      setScrollTop(container.scrollTop);
      setFocused(next);
      requestAnimationFrame(() => container.querySelector<HTMLInputElement>(`[data-row="${next}"] input`)?.focus({ preventScroll: true }));
    }}
  >
    <div style={{ height: items.length * rowHeight, position: "relative" }}>
      {indices.map((index) => <div
        key={index}
        data-row={index}
        role="listitem"
        aria-setsize={items.length}
        aria-posinset={index + 1}
        onFocus={() => setFocused(index)}
        style={{ position: "absolute", top: index * rowHeight, height: rowHeight, width: "100%" }}
      >{renderItem(items[index], index)}</div>)}
    </div>
  </div>;
}
