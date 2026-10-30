import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { VirtualList } from "../src/components/ingestion/virtual-list";

test("ten thousand items render only the visible window with overscan", () => {
  const items = Array.from({ length: 10000 }, (_, index) => index);
  const html = renderToStaticMarkup(
    <VirtualList items={items} label="Tables" renderItem={(item) => <input aria-label={String(item)} />} />,
  );
  expect((html.match(/<input/g) ?? []).length).toBeLessThan(20);
  expect(html).toContain('aria-setsize="10000"');
  expect(html).toContain("height:720000px");
  expect(html).not.toContain('aria-label="9999"');
});

test("empty list renders no rows", () => {
  const html = renderToStaticMarkup(
    <VirtualList items={[]} label="Tables" renderItem={() => <input />} />,
  );
  expect(html).not.toContain("<input");
  expect(html).toContain("height:0");
});
