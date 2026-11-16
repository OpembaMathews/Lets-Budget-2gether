import { useQueryClient } from '@tanstack/react-query'

export type Run = (action: () => Promise<unknown>) => Promise<boolean>

/** Runs a change, refreshes every screen, and reports whether it worked. */
export function useRun(onError: (message: string | null) => void): Run {
  const qc = useQueryClient()
  return async (action) => {
    let ok = true
    try {
      await action()
      onError(null)
    } catch (e) {
      ok = false
      onError((e as Error).message)
    } finally {
      await qc.invalidateQueries()
    }
    return ok
  }
}
