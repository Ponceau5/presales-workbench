import { useEffect, useState } from "react";
export function useProjectSource<T>(file: string) {
  const [result, setResult] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    fetch("/project-data/rcjm1/" + file, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error("无法读取项目资料");
        return r.json();
      })
      .then((data: T) => setResult({ data }))
      .catch((e) => {
        if (e.name !== "AbortError")
          setResult({ error: "资料加载失败，请刷新重试。" });
      });
    return () => controller.abort();
  }, [file]);
  return result;
}
