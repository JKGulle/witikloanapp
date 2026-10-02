import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase.ts'
import { fetchPenaltyStatuses, type PenaltyStatus } from '../lib/penalty.ts'
import type { LoanApplication, Payment } from '../lib/types.ts'

export function useLoanData() {
  const [applications, setApplications] = useState<LoanApplication[]>([])
  const [payments, setPayments] = useState<Payment[]>([])
  const [penalties, setPenalties] = useState<Map<string, PenaltyStatus>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [apps, pays, pens] = await Promise.all([
      supabase.from('loan_applications').select('*').order('created_at', { ascending: false }),
      supabase.from('payments').select('*').order('paid_at', { ascending: false }),
      fetchPenaltyStatuses(),
    ])
    const message = apps.error?.message ?? pays.error?.message ?? null
    setError(message?.includes('Failed to fetch') ? "Can't reach the server. Check your connection." : message)
    setApplications((apps.data ?? []) as LoanApplication[])
    setPayments((pays.data ?? []) as Payment[])
    setPenalties(pens)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return { applications, payments, penalties, loading, error, reload: load }
}
