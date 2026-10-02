import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/auth-context.ts'
import { FAQ, type FaqBlock, type FaqItem } from '../content/faq.ts'
import { Card } from '../components/Card.tsx'
import { Logo } from '../components/Logo.tsx'
import { ArrowLeftIcon } from '../components/icons.tsx'

const blockText = (b: FaqBlock) => (Array.isArray(b) ? b.join(' ') : b)
const matches = (item: FaqItem, term: string) =>
  `${item.q} ${item.a.map(blockText).join(' ')}`.toLowerCase().includes(term)

function Answer({ blocks }: { blocks: FaqBlock[] }) {
  return (
    <div className="faq-answer">
      {blocks.map((b, i) =>
        Array.isArray(b) ? (
          <ul key={i}>
            {b.map((li) => (
              <li key={li}>{li}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b}</p>
        ),
      )}
    </div>
  )
}

/** Public help page — readable before signing up, and from inside the app. */
export function FaqPage() {
  const { session, role } = useAuth()
  const [params] = useSearchParams()
  const { hash } = useLocation()
  // ?q=penalty pre-fills the search, so a specific topic can be linked to.
  const [search, setSearch] = useState(() => params.get('q') ?? '')
  const term = search.trim().toLowerCase()

  const sections = useMemo(
    () =>
      FAQ.filter((s) => role || s.id !== 'staff') // borrowers don't need the staff section
        .map((s) => ({ ...s, items: term ? s.items.filter((i) => matches(i, term)) : s.items }))
        .filter((s) => s.items.length > 0),
    [term, role],
  )
  // In-app links like /faq#penalties: jump to that section once it's rendered.
  useEffect(() => {
    if (hash) document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView()
  }, [hash])

  const resultCount = sections.reduce((n, s) => n + s.items.length, 0)
  const backTo = !session ? '/auth' : role ? '/admin' : '/'

  return (
    <div className="faq-page">
      <header className="shell__header">
        <Link to={backTo} aria-label="Witik home">
          <Logo />
        </Link>
        <Link to={backTo} className="back-link">
          <ArrowLeftIcon /> {session ? 'Back to app' : 'Sign in'}
        </Link>
      </header>

      <div className="stack-lg">
        <section className="stack">
          <h1 className="h1">Help & FAQ</h1>
          <p className="muted">Everything about applying, interest, repayments, penalties and keeping your account safe.</p>
          <input
            className="input"
            type="search"
            placeholder="Search questions — e.g. penalty, interest, ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search the FAQ"
          />
          {term && (
            <p className="muted small" aria-live="polite">
              {resultCount} result{resultCount === 1 ? '' : 's'}
            </p>
          )}
        </section>

        {!term && (
          <nav className="chips faq-topics" aria-label="FAQ topics">
            {sections.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="chip">
                {s.title}
              </a>
            ))}
          </nav>
        )}

        {sections.length === 0 ? (
          <Card className="empty">
            <p className="muted">No questions match “{search}”. Try another word.</p>
          </Card>
        ) : (
          sections.map((s) => (
            <section key={s.id} id={s.id} className="stack faq-section">
              <h2 className="h3">{s.title}</h2>
              {s.items.map((item) => (
                <details key={item.q} className="faq-item card" open={!!term}>
                  <summary>
                    <span>{item.q}</span>
                    <svg className="faq-item__chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </summary>
                  <Answer blocks={item.a} />
                </details>
              ))}
            </section>
          ))
        )}

        <Card tone="accent" className="stack faq-cta">
          <h2 className="h3">Ready to apply?</h2>
          <p className="muted small">See your monthly payment instantly before you submit anything.</p>
          <Link to={session && !role ? '/apply' : backTo} className="btn btn--primary">
            <span className="btn__label">{session && !role ? 'Go to Apply' : session ? 'Back to app' : 'Create an account'}</span>
          </Link>
        </Card>
      </div>
    </div>
  )
}
