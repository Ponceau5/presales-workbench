/** A compact LCS diff for prototype text; unchanged characters remain unmarked. */
export function textDiff(
  before: string,
  after: string,
): {
  before: { text: string; changed: boolean }[]
  after: { text: string; changed: boolean }[]
} {
  const a = Array.from(before),
    b = Array.from(after)
  if (a.length * b.length > 250000)
    return {
      before: [{ text: before, changed: before !== after }],
      after: [{ text: after, changed: before !== after }],
    }
  const dp = Array.from(
    { length: a.length + 1 },
    () => new Uint16Array(b.length + 1),
  )
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
  const left: { text: string; changed: boolean }[] = [],
    right: { text: string; changed: boolean }[] = []
  const add = (items: typeof left, text: string, changed: boolean) => {
    if (items.at(-1)?.changed === changed) items[items.length - 1].text += text
    else items.push({ text, changed })
  }
  let i = 0,
    j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      add(left, a[i++], false)
      add(right, b[j++], false)
    } else if (j < b.length && (i === a.length || dp[i][j + 1] >= dp[i + 1][j]))
      add(right, b[j++], true)
    else add(left, a[i++], true)
  }
  return { before: left, after: right }
}
