import type { BeforeSendEvent } from '@vercel/analytics/react'

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/**
 * Cleans every analytics event before it leaves the browser:
 * - drops the #fragment (password-reset and email-confirmation links carry
 *   access tokens there) and the ?query (searches, report periods);
 * - replaces borrower / loan ids in the path with ":id", so pages group by
 *   route and no identifiers reach analytics.
 */
export function scrubAnalyticsEvent(event: BeforeSendEvent): BeforeSendEvent | null {
  try {
    const url = new URL(event.url)
    url.hash = ''
    url.search = ''
    url.pathname = url.pathname.replace(UUID, ':id')
    return { ...event, url: url.toString() }
  } catch {
    return null // unparseable URL: send nothing rather than risk leaking it
  }
}
