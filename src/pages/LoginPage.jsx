import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

const LAST_LOGIN_ID_KEY = 'clinic-last-login-id';

const readLastLoginId = () => {
  if (typeof window === 'undefined') return '';
  try {
    const saved = window.localStorage.getItem(LAST_LOGIN_ID_KEY);
    return saved ? saved : '';
  } catch {
    return '';
  }
};

const writeLastLoginId = (email) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LAST_LOGIN_ID_KEY, email);
  } catch {
    // localStorage may be unavailable
  }
};

const getAuthMessage = (error, isSignUp) => {
  const message = error?.message || '';

  if (message.includes('Email not confirmed')) {
    return '이메일 인증이 아직 완료되지 않았습니다. 메일함에서 인증 링크를 누른 뒤 다시 로그인하세요.';
  }

  if (message.includes('Invalid login credentials')) {
    return '이메일 또는 비밀번호가 올바르지 않습니다.';
  }

  if (message.includes('User already registered')) {
    return '이미 가입된 이메일입니다. 로그인으로 전환해서 사용하세요.';
  }

  if (message.includes('Password should be at least')) {
    return '비밀번호는 6자 이상이어야 합니다.';
  }

  return isSignUp ? '회원가입에 실패했습니다.' : '로그인에 실패했습니다.';
};

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState(() => readLastLoginId());
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedPassword = password.trim();

      if (isSignUp) {
        const result = await signUp(normalizedEmail, normalizedPassword, { name: name.trim() });

        if (result?.emailConfirmationRequired) {
          setInfo('회원가입이 완료되었습니다. 이메일 인증 링크를 누른 뒤 로그인하세요.');
          setIsSignUp(false);
          setPassword('');
        }
      } else {
        writeLastLoginId(normalizedEmail);
        await signIn(normalizedEmail, normalizedPassword);
      }
    } catch (err) {
      setError(getAuthMessage(err, isSignUp));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">📅</div>
        <h1 className="login-title">클리닉 스케줄</h1>
        <p className="login-subtitle">
          {isSignUp ? '새 계정을 만들어 시작하세요' : '로그인하여 스케줄을 관리하세요'}
        </p>

        <form onSubmit={handleSubmit}>
          {isSignUp && (
            <div className="form-group">
              <label className="form-label" htmlFor="name">이름</label>
              <input
                id="name"
                className="form-input"
                type="text"
                value={name}
              onChange={e => setName(e.target.value)}
              placeholder="홍길동"
              required={isSignUp}
              autoComplete="name"
            />
          </div>
          )}

          <div className="form-group">
            <label className="form-label" htmlFor="email">{isSignUp ? '이메일' : '아이디'}</label>
            <input
              id="email"
              className="form-input"
              type={isSignUp ? 'email' : 'text'}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder={isSignUp ? 'your@email.com' : '아이디 입력'}
              required
              autoComplete={isSignUp ? 'email' : 'username'}
            />
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">비밀번호</label>
            <input
              id="password"
              className="form-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder={isSignUp ? '6자 이상' : '비밀번호 입력'}
              required
              minLength={isSignUp ? 6 : 1}
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
            />
          </div>

          {info && <p className="form-success">{info}</p>}
          {error && <p className="form-error">{error}</p>}

          <button
            type="submit"
            className="btn btn-primary login-btn"
            disabled={loading}
          >
            {loading ? '처리 중...' : isSignUp ? '회원가입' : '로그인'}
          </button>
        </form>

        <div className="login-switch">
          {isSignUp ? '이미 계정이 있으신가요?' : '계정이 없으신가요?'}{' '}
          <button
            type="button"
            onClick={() => {
              const nextIsSignUp = !isSignUp;
              setIsSignUp(nextIsSignUp);
              setError('');
              setInfo('');
              if (nextIsSignUp) {
                setEmail('');
                setPassword('');
              } else {
                setEmail(readLastLoginId());
                setPassword('');
              }
              setName('');
            }}
          >
            {isSignUp ? '로그인' : '회원가입'}
          </button>
        </div>
      </div>
    </div>
  );
}
