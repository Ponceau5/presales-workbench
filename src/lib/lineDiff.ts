export function alignLines(before: string, after: string) {
  const a = before.split("\n"),
    b = after.split("\n");
  const key = (line: string) => {
    if (!line.includes(" | ")) return line;
    const cells = line.split(" | ");
    const name = (cells[1] || "").replace(/[^\u4e00-\u9fff]/g, "");
    return name ? "item:" + name : line.replace(/\s+/g, " ").toLowerCase();
  };
  const matches = (left: string, right: string) => key(left) === key(right);
  const dp = Array.from(
    { length: a.length + 1 },
    () => new Uint32Array(b.length + 1),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] = matches(a[i], b[j])
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const rows: {
    left?: string;
    right?: string;
    ln?: number;
    rn?: number;
    changed: boolean;
  }[] = [];
  let i = 0,
    j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && matches(a[i], b[j])) {
      rows.push({
        left: a[i],
        right: b[j],
        ln: ++i,
        rn: ++j,
        changed: a[i - 1] !== b[j - 1],
      });
      continue;
    }
    const left: { text: string; n: number }[] = [],
      right: { text: string; n: number }[] = [];
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && matches(a[i], b[j])) break;
      if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j]))
        right.push({ text: b[j], n: ++j });
      else left.push({ text: a[i], n: ++i });
    }
    for (let k = 0; k < Math.max(left.length, right.length); k++)
      rows.push({
        left: left[k]?.text,
        right: right[k]?.text,
        ln: left[k]?.n,
        rn: right[k]?.n,
        changed: true,
      });
  }
  return rows;
}
