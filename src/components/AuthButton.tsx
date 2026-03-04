import { useState, useEffect } from 'react';

export interface SessionUser {
  id: string;
  robloxId: number;
  username: string;
  avatar: string | null;
  displayName: string | null;
}

interface Props {
  onUserChange?: (user: SessionUser | null) => void;
}

export default function AuthButton({ onUserChange }: Props) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me')
      .then(res => res.json())
      .then(data => {
        setUser(data.user || null);
        onUserChange?.(data.user || null);
      })
      .catch(() => {
        setUser(null);
        onUserChange?.(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="auth-btn auth-btn--loading"><span className="auth-btn__spinner" /></div>;
  }

  if (user) {
    return (
      <div className="auth-btn auth-btn--logged">
        {user.avatar ? (
          <img className="auth-btn__avatar" src={user.avatar} alt="" />
        ) : (
          <div className="auth-btn__avatar auth-btn__avatar--ph">
            {(user.displayName || user.username).charAt(0).toUpperCase()}
          </div>
        )}
        <span className="auth-btn__name">{user.displayName || user.username}</span>
        <a href="/api/auth/logout" className="auth-btn__logout" title="Logout">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16,17 21,12 16,7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </a>
      </div>
    );
  }

  return (
    <a href="/api/auth/login" className="auth-btn auth-btn--login">
      <svg className="auth-btn__roblox-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5.164 0L0 18.836 18.836 24 24 5.164 5.164 0zm8.746 14.09l-3.999-1.001 1-3.999 4 1-1.001 4z" />
      </svg>
      Login with Roblox
    </a>
  );
}
