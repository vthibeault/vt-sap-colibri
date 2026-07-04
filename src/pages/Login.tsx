import { useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { PERSONAS } from '@/sap/mock/mockClient';
import { useAuth } from '@/state/AuthContext';
import { useBrand } from '@/state/BrandContext';
import { toast } from '@/lib/toast';
import { Toasts } from '@/components/ui';

export function Login() {
  const { login } = useAuth();
  const { brand } = useBrand();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);

  const enter = async (personaId: string) => {
    setBusy(personaId);
    try {
      await login(personaId);
      navigate('/', { replace: true });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Sign-in failed', 'error');
      setBusy(null);
    }
  };

  return (
    <div className="login">
      <div className="login-box">
        <div className="login-hero rise">
          <span className="logo-mark">{brand.monogram}</span>
          <h1>{brand.name}</h1>
          <p>
            {brand.tagline} — SAP Project System without the beige.
            <br />
            Pick a persona; roles and authorizations come from SAP.
          </p>
        </div>
        <div className="persona-grid">
          {PERSONAS.map((p, i) => (
            <button
              key={p.id}
              className="persona stagger"
              style={{ '--i': i + 2 } as CSSProperties}
              onClick={() => enter(p.id)}
              disabled={busy !== null}
            >
              <span className="avatar">{p.avatar}</span>
              <b>{busy === p.id ? 'Signing in…' : p.fullName}</b>
              <span className="title">{p.jobTitle}</span>
              <span className="blurb">{p.blurb}</span>
              <span className="roles">
                {p.roles.map((r) => (
                  <span key={r}>{r}</span>
                ))}
              </span>
            </button>
          ))}
        </div>
        <p className="login-note rise" style={{ '--i': 8 } as CSSProperties}>
          Demo mode uses a seeded in-browser SAP mock. In live mode, identity and PFCG roles come
          from your SAP gateway — see the Integration page.
        </p>
      </div>
      <Toasts />
    </div>
  );
}
