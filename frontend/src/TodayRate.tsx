// Today's market exchange rate between the two currencies, offered as a suggestion.
import { useQuery } from '@tanstack/react-query'
import { api, ccy } from './api'

export function TodayRate(props: { current: string | number; onUse: (rate: string) => void; compact?: boolean }) {
  const base = ccy('NTD')
  const quote = ccy('KES')
  const fx = useQuery({
    queryKey: ['fx-rate', base, quote],
    queryFn: api.fxRate,
    retry: false,
    staleTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  })
  if (base === quote) return null
  if (fx.isLoading) return <p className="text-xs text-slate-500">Checking today's rate…</p>
  if (!fx.data)
    return props.compact ? null : <p className="text-xs text-slate-500">Today's rate could not be fetched. Type the rate yourself.</p>

  const rate = fx.data.rate
  const same = Number(rate) === Number(props.current)
  const use = (
    <button type="button" className="font-semibold text-brand-700 underline" onClick={() => props.onUse(rate)}>
      Use it
    </button>
  )
  if (props.compact)
    return (
      <p className="text-xs text-slate-500" title={`Market rate from ${fx.data.source}. What you get when you send money is usually a little lower.`}>
        Today: <span className="num">{Number(rate)}</span> {!same && use}
      </p>
    )
  return (
    <div className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
      <p className="text-brand-900">
        Today's market rate: <strong className="num">1 {base} = {Number(rate)} {quote}</strong> {same ? <span className="text-brand-700">✓ in use</span> : use}
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Money transfer services usually give a little less than this. If you know the rate you really get, type that
        instead. Source: {fx.data.source}
        {fx.data.as_of ? `, ${fx.data.as_of.slice(5, 16)}` : ''}.
      </p>
    </div>
  )
}
