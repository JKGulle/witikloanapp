import { Card } from '../components/Card.tsx'
import { Logo } from '../components/Logo.tsx'

export function SetupNotice() {
  return (
    <div className="center-screen">
      <Card className="auth-card stack">
        <Logo size="lg" />
        <h1 className="h2">Connect Supabase</h1>
        <p className="muted">
          The app needs your Supabase project credentials. Create <code>.env.local</code> in the project root:
        </p>
        <pre className="code-block">
          {`VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<publishable or anon key>`}
        </pre>
        <p className="muted small">
          Then run the SQL in <code>supabase/migrations</code> and restart <code>npm run dev</code>.
        </p>
      </Card>
    </div>
  )
}
