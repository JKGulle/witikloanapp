import { useCallback, useEffect, useState } from 'react'

/** Runs an async loader on mount (and on reload), tracking loading and error state. */
export function useQuery<T>(load: () => Promise<T>, deps: readonly unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // The caller controls when `load` is considered changed via `deps`.
  // eslint-disable-next-line react-hooks/exhaustive-deps, react/use-memo
  const run = useCallback(load, deps)

  const reload = useCallback(async () => {
    try {
      setData(await run())
      setError(null)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(message.includes('Failed to fetch') ? "Can't reach the server. Check your connection." : message)
    } finally {
      setLoading(false)
    }
  }, [run])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, error, loading, reload }
}

/** Unwraps a Supabase response, throwing its error so useQuery can surface it. */
export function unwrap<T>({ data, error }: { data: T | null; error: { message: string } | null }): T {
  if (error) throw new Error(error.message)
  return data as T
}
