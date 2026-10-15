import { fetchHealth, fetchTime } from "./lib/api";

export default async function Page() {
  const results = await Promise.allSettled([fetchHealth(), fetchTime()]);
  const rows = [
    ["/health", results[0]],
    ["/time", results[1]],
  ] as const;

  return (
    <dl className="p-4 font-mono">
      {rows.map(([name, result]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{result.status === "fulfilled" ? JSON.stringify(result.value) : String(result.reason)}</dd>
        </div>
      ))}
    </dl>
  );
}
