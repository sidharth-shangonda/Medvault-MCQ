import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  BookMarked,
  BookOpen,
  Brain,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Database,
  Flag,
  Gauge,
  HeartPulse,
  Image,
  LayoutDashboard,
  LogOut,
  Pause,
  Play,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Target,
  Timer,
  UserRound,
  XCircle
} from "lucide-react";

const API = "";
const AUTH_KEY = "medvault_auth";
const AUTH_FALLBACK_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const EMPTY_FILTERS = {
  subject: "",
  chapter: "",
  exam: "",
  year: "",
  difficulty: "",
  repeated: "",
  highYield: false,
  imageOnly: false,
  search: ""
};
const MODE_SECONDS_PER_QUESTION = {
  exam: 60,
  practice: 120,
  rapid: 30,
  images: 120
};

function secondsPerQuestion(mode) {
  return MODE_SECONDS_PER_QUESTION[mode] || MODE_SECONDS_PER_QUESTION.practice;
}

function api(path, options = {}) {
  const token = options.token || readStoredAuth()?.token;
  const headers = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {})
  };
  return fetch(`${API}${path}`, { ...options, headers }).then(async response => {
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      if (response.status === 401 && token) {
        localStorage.removeItem(AUTH_KEY);
        window.dispatchEvent(new CustomEvent("medvault-auth-expired"));
      }
      throw new Error(body.message || `Request failed: ${response.status}`);
    }
    return response.json();
  });
}

function readStoredAuth() {
  try {
    const auth = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    if (!auth?.token) return null;
    const expiresAt = auth.expiresAt ? Date.parse(auth.expiresAt) : null;
    const savedAt = auth.savedAt ? Date.parse(auth.savedAt) : null;
    const fallbackExpired = savedAt && Date.now() - savedAt > AUTH_FALLBACK_MAX_AGE_MS;
    if ((expiresAt && expiresAt <= Date.now()) || fallbackExpired) {
      localStorage.removeItem(AUTH_KEY);
      return null;
    }
    return auth;
  } catch {
    localStorage.removeItem(AUTH_KEY);
    return null;
  }
}

function tokenExpiresAt(token) {
  try {
    const [, payload] = String(token || "").split(".");
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(payload.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(normalized));
    return decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null;
  } catch {
    return null;
  }
}

function titleCase(value) {
  return String(value || "")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatTime(ms) {
  const seconds = Math.round((ms || 0) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function splitChapterName(name = "") {
  const [subject = "", ...chapterParts] = String(name).split(" / ");
  return { subject, chapter: chapterParts.join(" / ") };
}

function initials(name = "Student") {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase())
    .join("") || "ST";
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [auth, setAuth] = useState(() => readStoredAuth());
  const [health, setHealth] = useState(null);
  const [meta, setMeta] = useState(null);
  const [analytics, setAnalytics] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [mode, setMode] = useState("practice");
  const [count, setCount] = useState(20);
  const [bank, setBank] = useState({ items: [], total: 0, limit: 50, skip: 0 });
  const [session, setSession] = useState(null);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [result, setResult] = useState(null);
  const [audit, setAudit] = useState({ items: [], total: 0 });
  const [reviewType, setReviewType] = useState("mistakes");
  const [review, setReview] = useState({ type: "mistakes", total: 0, items: [] });
  const [error, setError] = useState("");
  const sessionRef = useRef(null);
  const finishingRef = useRef(false);

  useEffect(() => {
    refreshBase(auth);
  }, [auth?.token]);

  useEffect(() => {
    function handleAuthExpired() {
      setAuth(null);
      setAnalytics(null);
      setSession(null);
      setResult(null);
      finishingRef.current = false;
      navigate("/login", { replace: true });
    }
    window.addEventListener("medvault-auth-expired", handleAuthExpired);
    return () => window.removeEventListener("medvault-auth-expired", handleAuthExpired);
  }, [navigate]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    if (!session?.deadlineAt) return undefined;
    if (session.pausedAt) {
      setTimerNow(session.pausedAt);
      return undefined;
    }
    setTimerNow(Date.now());
    const interval = window.setInterval(() => {
      const now = Date.now();
      setTimerNow(now);
      if (now >= session.deadlineAt) finishQuiz({ timeExpired: true });
    }, 500);
    return () => window.clearInterval(interval);
  }, [session?.deadlineAt, session?.pausedAt]);

  useEffect(() => {
    if (!auth?.token) return;
    if (location.pathname === "/" || location.pathname === "/login") navigate("/dashboard", { replace: true });
  }, [auth?.token, location.pathname, navigate]);

  useEffect(() => {
    if (!auth?.token) return;
    if (location.pathname === "/bank") loadBank();
    if (location.pathname === "/image-audit") loadAudit();
    if (location.pathname === "/revision") loadReview(reviewType);
  }, [auth?.token, location.pathname, filters, reviewType]);

  async function refreshBase(currentAuth = auth) {
    try {
      const nextHealth = await api("/api/health");
      const nextMeta = await api("/api/questions/meta");
      const nextAnalytics = currentAuth?.token ? await api("/api/progress/analytics", { token: currentAuth.token }) : null;
      setHealth(nextHealth);
      setMeta(nextMeta);
      setAnalytics(nextAnalytics);
    } catch (err) {
      setError(err.message);
    }
  }

  function queryParams(extra = {}) {
    const params = new URLSearchParams();
    const merged = { ...filters, ...extra };
    for (const [key, value] of Object.entries(merged)) {
      if (value !== "" && value !== false && value !== null && value !== undefined) params.set(key, value);
    }
    return params.toString();
  }

  async function loadBank() {
    try {
      setBank(await api(`/api/questions?${queryParams({ limit: 50 })}`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadAudit() {
    try {
      setAudit(await api("/api/image-audit?status=all&limit=50"));
    } catch (err) {
      setError(err.message);
    }
  }

  async function loadReview(type = reviewType) {
    try {
      setReview(await api(`/api/progress/review?type=${type}&limit=48`));
    } catch (err) {
      setError(err.message);
    }
  }

  async function startQuiz(nextMode = mode, explicitQuestions = null, filterOverride = null) {
    try {
      setError("");
      let items = explicitQuestions;
      if (!items) {
        const modeFilters = { ...filters, ...(filterOverride || {}) };
        if (nextMode === "rapid") modeFilters.highYield = true;
        if (nextMode === "images") modeFilters.imageOnly = true;
        const questions = await api(`/api/questions/sample?${queryParams({ ...modeFilters, count })}`);
        items = questions.items;
      }
      if (!items?.length) {
        setError("No questions match this selection.");
        return;
      }
      const selectedItems = items.slice(0, 30);
      const now = Date.now();
      const perQuestion = secondsPerQuestion(nextMode);
      setMode(nextMode);
      finishingRef.current = false;
      setSession({
        mode: nextMode,
        startedAt: now,
        currentQuestionStartedAt: now,
        deadlineAt: now + selectedItems.length * perQuestion * 1000,
        durationMs: selectedItems.length * perQuestion * 1000,
        secondsPerQuestion: perQuestion,
        pausedAt: null,
        flags: {},
        currentIndex: 0,
        answers: {},
        questions: selectedItems
      });
      setResult(null);
      navigate("/quiz/live");
    } catch (err) {
      setError(err.message);
    }
  }

  async function finishQuiz(options = {}) {
    const activeSession = sessionRef.current;
    if (!activeSession || finishingRef.current) return;
    finishingRef.current = true;
    const answers = activeSession.questions.map(question => {
      const answer = activeSession.answers[question.id] || {};
      return {
        questionId: question.id,
        selected: answer.selected ?? null,
        confidence: answer.confidence || "unsure",
        timeMs: answer.timeMs || 0
      };
    });
    try {
      const saved = await api("/api/progress/sessions", {
        method: "POST",
        body: JSON.stringify({ mode: activeSession.mode, filters, answers })
      });
      const answerMap = new Map(saved.answers.map(answer => [answer.questionId, answer]));
      setResult({
        ...saved,
        timeExpired: Boolean(options.timeExpired),
        rows: activeSession.questions.map(question => ({ question, answer: answerMap.get(question.id) }))
      });
      setSession(null);
      await refreshBase();
      navigate("/quiz/result");
    } catch (err) {
      finishingRef.current = false;
      setError(err.message);
    }
  }

  async function bookmark(questionId) {
    try {
      await api(`/api/progress/bookmarks/${questionId}`, { method: "POST", body: "{}" });
      await refreshBase();
      if (location.pathname === "/revision") loadReview(reviewType);
    } catch (err) {
      setError(err.message);
    }
  }

  async function markAudit(questionId, status) {
    try {
      await api(`/api/image-audit/${questionId}`, {
        method: "PATCH",
        body: JSON.stringify({ status })
      });
      loadAudit();
    } catch (err) {
      setError(err.message);
    }
  }

  const chapters = useMemo(() => {
    if (!meta) return [];
    if (!filters.subject) return Object.values(meta.chapters || {}).flat().filter((value, index, arr) => arr.indexOf(value) === index).sort();
    return meta.chapters?.[filters.subject] || [];
  }, [meta, filters.subject]);

  function saveAuth(nextAuth) {
    const authToStore = {
      ...nextAuth,
      savedAt: new Date().toISOString(),
      expiresAt: nextAuth.expiresAt || tokenExpiresAt(nextAuth.token)
    };
    localStorage.setItem(AUTH_KEY, JSON.stringify(authToStore));
    setAuth(authToStore);
    setError("");
    navigate("/dashboard", { replace: true });
  }

  function logout() {
    localStorage.removeItem(AUTH_KEY);
    setAuth(null);
    setAnalytics(null);
    setSession(null);
    setResult(null);
    finishingRef.current = false;
    navigate("/login", { replace: true });
  }

  if (!auth?.token) {
    return <AuthScreen onAuth={saveAuth} meta={meta} error={error} setError={setError} />;
  }

  const routeProps = {
    meta,
    analytics,
    filters,
    setFilters,
    chapters,
    count,
    setCount,
    mode,
    setMode,
    bank,
    audit,
    review,
    reviewType,
    setReviewType,
    session,
    setSession,
    remainingMs: session?.deadlineAt ? Math.max(0, session.deadlineAt - (session.pausedAt || timerNow)) : 0,
    result,
    health,
    startQuiz,
    finishQuiz,
    bookmark,
    markAudit
  };

  return (
    <div className="app-shell">
      <Sidebar meta={meta} analytics={analytics} user={auth.user} logout={logout} />
      <div className="workspace">
        <AppHeader user={auth.user} analytics={analytics} startQuiz={() => startQuiz("practice")} />
        <main className="page">
          {error ? <div className="notice">{error}</div> : null}
          <Routes>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/login" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard {...routeProps} />} />
            <Route path="/plan" element={<StudyPlan {...routeProps} />} />
            <Route path="/quiz" element={<Setup {...routeProps} />} />
            <Route path="/quiz/live" element={session ? <Quiz {...routeProps} /> : <Navigate to="/quiz" replace />} />
            <Route path="/quiz/result" element={result ? <Result {...routeProps} /> : <Navigate to="/analytics" replace />} />
            <Route path="/bank" element={<Bank {...routeProps} />} />
            <Route path="/analytics" element={<Analytics {...routeProps} />} />
            <Route path="/revision" element={<Revision {...routeProps} />} />
            <Route path="/image-audit" element={<ImageAudit {...routeProps} />} />
            <Route path="/settings" element={<SettingsPage meta={meta} analytics={analytics} health={health} user={auth.user} />} />
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}

const navItems = [
  ["/dashboard", "Dashboard", LayoutDashboard],
  ["/plan", "Plan", CalendarDays],
  ["/quiz", "Quiz", ClipboardList],
  ["/bank", "Bank", BookOpen],
  ["/analytics", "Analytics", BarChart3],
  ["/revision", "Revision", Brain],
  ["/image-audit", "Images", Image],
  ["/settings", "Settings", Settings]
];

function Sidebar({ meta, analytics, user, logout }) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark"><Stethoscope size={20} /></div>
        <div>
          <h1>MedVault PYQ</h1>
          <p>{meta ? `${meta.totalQuestions} PYQs` : "Loading bank"}</p>
        </div>
      </div>
      <nav className="side-nav">
        {navItems.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
            <Icon size={18} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="sidebar-card">
        <div className="mini-avatar">{initials(user?.name)}</div>
        <strong>{user?.name || "Student"}</strong>
        <span>{analytics?.totals?.completion || 0}% syllabus complete</span>
      </div>
      <button className="icon-text ghost" onClick={logout}>
        <LogOut size={17} />
        Logout
      </button>
    </aside>
  );
}

function MobileNav() {
  return (
    <nav className="mobile-nav">
      {navItems.slice(0, 5).map(([to, label, Icon]) => (
        <NavLink key={to} to={to} className={({ isActive }) => (isActive ? "active" : "")}>
          <Icon size={18} />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

function AppHeader({ user, analytics, startQuiz }) {
  const location = useLocation();
  const active = navItems.find(([to]) => location.pathname.startsWith(to))?.[1] || "Dashboard";
  return (
    <header className="app-header">
      <div>
        <span className="eyebrow">Clinical learning command center</span>
        <h2>{active}</h2>
      </div>
      <div className="header-actions">
        <div className="pill success"><Activity size={15} /> {analytics?.totals?.accuracy || 0}% accuracy</div>
        <button className="btn primary" onClick={startQuiz}><Play size={17} /> Start practice</button>
        <div className="avatar" title={user?.name || "Student"}>{initials(user?.name)}</div>
      </div>
    </header>
  );
}

function AuthScreen({ onAuth, meta, error, setError }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);

  function update(key, value) {
    setForm(current => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = mode === "register" ? form : { email: form.email, password: form.password };
      const auth = await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      onAuth(auth);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <section className="auth-copy">
        <div className="brand-mark large"><Stethoscope size={28} /></div>
        <span className="eyebrow">NEET PG / INI-CET PYQ intelligence</span>
        <h1>MedVault PYQ</h1>
        <p>Chapter-wise MCQ practice, image review, mistake tracking, bookmarks, and spaced revision for each student account.</p>
        <div className="metric-row">
          <Metric icon={Database} label="PYQs" value={meta?.totalQuestions || 5065} />
          <Metric icon={ShieldCheck} label="Subjects" value={meta?.subjects?.length || 19} />
          <Metric icon={Image} label="Image links" value={meta?.imageQuestions || 3478} />
        </div>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <div>
          <span className="eyebrow">{mode === "login" ? "Welcome back" : "Create student profile"}</span>
          <h2>{mode === "login" ? "Login" : "Register"}</h2>
        </div>
        {error ? <div className="notice">{error}</div> : null}
        {mode === "register" ? (
          <Field label="Name">
            <input value={form.name} onChange={event => update("name", event.target.value)} placeholder="Your name" autoComplete="name" />
          </Field>
        ) : null}
        <Field label="Email">
          <input value={form.email} onChange={event => update("email", event.target.value)} placeholder="student@example.com" autoComplete="email" inputMode="email" />
        </Field>
        <Field label="Password">
          <input type="password" value={form.password} onChange={event => update("password", event.target.value)} placeholder="At least 6 characters" autoComplete={mode === "login" ? "current-password" : "new-password"} />
        </Field>
        <button className="btn primary wide" disabled={busy}>{busy ? "Please wait..." : mode === "login" ? "Login" : "Create account"}</button>
        <button type="button" className="btn subtle wide" onClick={() => setMode(mode === "login" ? "register" : "login")}>
          {mode === "login" ? "New user? Register" : "Already registered? Login"}
        </button>
      </form>
    </div>
  );
}

function Dashboard({ analytics, meta, startQuiz }) {
  const totals = analytics?.totals || {};
  const weakChapters = (analytics?.chapters || []).filter(chapter => chapter.attempts > 0).sort((a, b) => a.accuracy - b.accuracy).slice(0, 6);
  const freshSubjects = (analytics?.subjects || []).slice(0, 8);
  return (
    <div className="stack">
      <section className="command-panel">
        <div>
          <span className="eyebrow">Today’s clinical prescription</span>
          <h2>Keep the question bank active, measurable, and chapter-wise.</h2>
          <p>Start with weak chapters, then finish with image-based recall or high-yield repeated PYQs.</p>
        </div>
        <div className="command-actions">
          <button className="btn primary" onClick={() => startQuiz("practice")}><Play size={17} /> Practice block</button>
          <button className="btn clinical" onClick={() => startQuiz("rapid")}><Sparkles size={17} /> Rapid PYQ</button>
          <button className="btn dark" onClick={() => startQuiz("images")}><Image size={17} /> Image drill</button>
        </div>
      </section>

      <div className="metric-row">
        <Metric icon={Database} label="Total PYQs" value={meta?.totalQuestions || 0} />
        <Metric icon={Gauge} label="Attempted" value={totals.attempted || 0} />
        <Metric icon={CheckCircle2} label="Accuracy" value={`${totals.accuracy || 0}%`} />
        <Metric icon={Timer} label="Due review" value={totals.due || 0} />
      </div>

      <div className="content-grid">
        <section className="panel">
          <PanelHeader icon={HeartPulse} title="Subject Coverage" subtitle={`${totals.completion || 0}% syllabus completion`} />
          <div className="progress-list">
            {freshSubjects.length ? freshSubjects.map(subject => (
              <Progress key={subject.name} label={subject.name} detail={`${subject.attempted}/${subject.total} attempted · ${subject.accuracy}% accuracy`} value={subject.completion} />
            )) : <EmptyState icon={BookOpen} title="No attempts yet" text="Start a practice block to begin tracking subject coverage." />}
          </div>
        </section>
        <section className="panel">
          <PanelHeader icon={Brain} title="Weak Chapter Watchlist" subtitle="Sorted by lowest accuracy after attempts" />
          <div className="chapter-list">
            {weakChapters.length ? weakChapters.map(chapter => <ChapterRow key={chapter.name} chapter={chapter} />) : <EmptyState icon={Sparkles} title="No weak areas yet" text="Your mistake notebook will build automatically after quizzes." />}
          </div>
        </section>
      </div>
    </div>
  );
}

function Setup({ meta, chapters, filters, setFilters, count, setCount, mode, setMode, startQuiz }) {
  return (
    <div className="stack">
      <section className="panel">
        <PanelHeader icon={ClipboardList} title="Build A Test" subtitle="Filter subject, chapter, exam year, difficulty, and visual questions." />
        <Filters meta={meta} chapters={chapters} filters={filters} setFilters={setFilters} />
      </section>
      <section className="panel">
        <div className="setup-grid">
          <div>
            <span className="eyebrow">Mode</span>
            <div className="mode-grid">
              {[
                ["practice", "Practice", "2 min/question · explanations after answer", BookOpen],
                ["exam", "Exam", "1 min/question · review at end", Timer],
                ["rapid", "Rapid", "30 sec/question · repeated and high-yield", Sparkles],
                ["images", "Image Drill", "2 min/question · visual PYQs only", Image]
              ].map(([id, title, text, Icon]) => (
                <button key={id} className={`mode-card ${mode === id ? "active" : ""}`} onClick={() => setMode(id)}>
                  <Icon size={19} />
                  <strong>{title}</strong>
                  <span>{text}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="test-panel">
            <Field label="Question count">
              <select value={count} onChange={event => setCount(Number(event.target.value))}>
                {[5, 10, 20, 30].map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </Field>
            <button className="btn primary wide" onClick={() => startQuiz(mode)}><Play size={17} /> Start test</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function Bank({ meta, chapters, filters, setFilters, bank, startQuiz, bookmark }) {
  return (
    <div className="stack">
      <section className="panel">
        <PanelHeader icon={Search} title="Question Bank" subtitle="Search all extracted PYQs by subject, chapter, exam, year, and keyword." right={<span className="pill">{bank.total} results</span>} />
        <Filters meta={meta} chapters={chapters} filters={filters} setFilters={setFilters} />
      </section>
      <section className="question-list">
        {bank.items.map(question => (
          <QuestionCard
            key={question.id}
            question={question}
            onPractice={() => startQuiz("practice", [question])}
            bookmark={() => bookmark(question.id)}
          />
        ))}
        {!bank.items.length ? <EmptyState icon={Search} title="No results" text="Try clearing filters or searching a broader concept." /> : null}
      </section>
    </div>
  );
}

function Analytics({ analytics, meta }) {
  const sessions = analytics?.sessions || [];
  const subjects = analytics?.subjects || [];
  const chapters = analytics?.chapters || [];
  return (
    <div className="stack">
      <div className="metric-row">
        <Metric icon={Database} label="Syllabus" value={analytics?.totals?.syllabusTotal || meta?.totalQuestions || 0} />
        <Metric icon={Gauge} label="Completion" value={`${analytics?.totals?.completion || 0}%`} />
        <Metric icon={BookMarked} label="Saved" value={analytics?.totals?.bookmarked || 0} />
        <Metric icon={Timer} label="Due" value={analytics?.totals?.due || 0} />
      </div>
      <div className="content-grid">
        <section className="panel">
          <PanelHeader icon={BarChart3} title="Subject Analytics" subtitle="Completion and accuracy by subject" />
          <div className="progress-list">
            {subjects.map(subject => <Progress key={subject.name} label={subject.name} detail={`${subject.attempted}/${subject.total} attempted · ${subject.accuracy}% accuracy`} value={subject.completion} />)}
          </div>
        </section>
        <section className="panel">
          <PanelHeader icon={Activity} title="Recent Sessions" subtitle="Last 20 saved test attempts" />
          <div className="session-list">
            {sessions.length ? sessions.map(session => (
              <div key={session._id} className="session-row">
                <div>
                  <strong>{titleCase(session.mode)}</strong>
                  <span>{session.questionIds?.length || 0} Q · {formatTime(session.totalTimeMs)}</span>
                </div>
                <b>{session.accuracy}%</b>
              </div>
            )) : <EmptyState icon={ClipboardList} title="No sessions yet" text="Complete a quiz to populate your session history." />}
          </div>
        </section>
      </div>
      <section className="panel">
        <PanelHeader icon={Brain} title="Chapter Heatmap" subtitle="First 36 chapter rows sorted by completion" />
        <div className="heat-grid">
          {chapters.slice(0, 36).map(chapter => <ChapterTile key={chapter.name} chapter={chapter} />)}
        </div>
      </section>
    </div>
  );
}

function Revision({ review, reviewType, setReviewType, startQuiz, bookmark }) {
  const tabs = [
    ["mistakes", "Mistakes", XCircle],
    ["due", "Due", Timer],
    ["bookmarked", "Saved", BookMarked],
    ["guessed", "Guessed", Brain]
  ];
  const questions = review.items.map(item => item.question);
  return (
    <div className="stack">
      <section className="panel revision-head">
        <PanelHeader icon={Brain} title="Smart Revision" subtitle="User-specific queues from mistakes, confidence, bookmarks, and spaced repetition." />
        <div className="revision-actions">
          <div className="segmented">
            {tabs.map(([id, label, Icon]) => (
              <button key={id} className={reviewType === id ? "active" : ""} onClick={() => setReviewType(id)}>
                <Icon size={16} /> {label}
              </button>
            ))}
          </div>
          <button className="btn primary" onClick={() => startQuiz(reviewType, questions)} disabled={!questions.length}><Play size={17} /> Drill queue</button>
        </div>
      </section>
      <section className="question-list">
        {review.items.length ? review.items.map(({ question, state }) => (
          <ReviewCard key={question.id} question={question} state={state} bookmark={() => bookmark(question.id)} />
        )) : <EmptyState icon={ShieldCheck} title="Nothing in this queue" text="Your revision queues fill automatically as you answer, guess, save, and miss questions." />}
      </section>
    </div>
  );
}

function StudyPlan({ analytics, meta, startQuiz, setFilters, setReviewType }) {
  const navigate = useNavigate();
  const totals = analytics?.totals || {};
  const chapters = analytics?.chapters || [];
  const subjects = analytics?.subjects || [];
  const attemptedWeak = chapters
    .filter(chapter => chapter.attempts > 0)
    .sort((a, b) => a.accuracy - b.accuracy || b.attempts - a.attempts)[0];
  const nextIncomplete = chapters.find(chapter => chapter.completion < 100);
  const focusChapter = attemptedWeak || nextIncomplete || chapters[0];
  const focusFilter = splitChapterName(focusChapter?.name);
  const focusLabel = focusChapter?.name || "Any subject";
  const dailyTarget = Math.min(30, Math.max(10, Math.ceil((totals.syllabusTotal || meta?.totalQuestions || 0) / 180)));

  function openRevision(type) {
    setReviewType(type);
    navigate("/revision");
  }

  function startFocused(modeName, filterOverride = null) {
    if (filterOverride?.subject) {
      setFilters(current => ({ ...current, ...filterOverride }));
    }
    startQuiz(modeName, null, filterOverride);
  }

  const cards = [
    {
      icon: Timer,
      title: "Due Review",
      value: totals.due || 0,
      text: "Spaced repetition queue from wrong or reviewed questions.",
      action: "Open queue",
      onClick: () => openRevision("due"),
      tone: "clinical"
    },
    {
      icon: Target,
      title: "Weak Sprint",
      value: `${focusChapter?.accuracy ?? 0}%`,
      text: focusLabel,
      action: "Start sprint",
      onClick: () => startFocused("practice", focusFilter),
      tone: "blue"
    },
    {
      icon: Sparkles,
      title: "Rapid PYQ",
      value: "30s",
      text: "Fast repeated/high-yield recall block.",
      action: "Start rapid",
      onClick: () => startFocused("rapid"),
      tone: "amber"
    },
    {
      icon: Image,
      title: "Image Recall",
      value: meta?.imageQuestions || 0,
      text: "Visual questions from extracted source media.",
      action: "Image drill",
      onClick: () => startFocused("images"),
      tone: "navy"
    }
  ];

  return (
    <div className="stack">
      <section className="command-panel plan-hero">
        <div>
          <span className="eyebrow">Adaptive daily plan</span>
          <h2>Do {dailyTarget} focused PYQs, then clear your review queue.</h2>
          <p>Built around chapter weakness, spaced repetition, high-yield PYQs, and visual recall.</p>
        </div>
        <div className="command-actions">
          <button className="btn primary" onClick={() => startFocused("practice", focusFilter)}><Target size={17} /> Focus block</button>
          <button className="btn clinical" onClick={() => openRevision("mistakes")}><Brain size={17} /> Mistakes</button>
        </div>
      </section>

      <div className="plan-grid">
        {cards.map(({ icon: Icon, title, value, text, action, onClick, tone }) => (
          <article key={title} className={`study-card ${tone}`}>
            <div className="study-icon"><Icon size={20} /></div>
            <strong>{title}</strong>
            <b>{value}</b>
            <span>{text}</span>
            <button className="btn subtle wide" onClick={onClick}>{action}</button>
          </article>
        ))}
      </div>

      <div className="content-grid">
        <section className="panel">
          <PanelHeader icon={CalendarDays} title="Revision Rhythm" subtitle="Wrong questions are scheduled Day 1, 3, 7, 15, and 30." />
          <div className="timeline">
            {[1, 3, 7, 15, 30].map((day, index) => (
              <div key={day} className="timeline-step">
                <span>Day {day}</span>
                <strong>{index === 0 ? "Repair" : index === 1 ? "Recheck" : index === 2 ? "Reinforce" : index === 3 ? "Stabilize" : "Master"}</strong>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <PanelHeader icon={HeartPulse} title="Next Subject Moves" subtitle="Lowest completion subjects first." />
          <div className="progress-list">
            {subjects.slice(0, 5).map(subject => (
              <Progress key={subject.name} label={subject.name} detail={`${subject.attempted}/${subject.total} attempted · ${subject.accuracy}% accuracy`} value={subject.completion} />
            ))}
            {!subjects.length ? <EmptyState icon={BookOpen} title="No analytics yet" text="Finish one quiz and your plan will become personalized." /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function Quiz({ session, setSession, finishQuiz, remainingMs }) {
  const question = session.questions[session.currentIndex];
  const answer = session.answers[question.id] || { selected: null, confidence: "unsure", timeMs: 0 };
  const reveal = session.mode !== "exam" && answer.selected !== null;
  const timerIsLow = remainingMs <= Math.min(60000, session.durationMs * 0.2);
  const isPaused = Boolean(session.pausedAt);
  const isFlagged = Boolean(session.flags?.[question.id]);

  function togglePause() {
    setSession(current => {
      if (!current) return current;
      if (current.pausedAt) {
        const pausedMs = Date.now() - current.pausedAt;
        return {
          ...current,
          pausedAt: null,
          deadlineAt: current.deadlineAt + pausedMs,
          currentQuestionStartedAt: (current.currentQuestionStartedAt || Date.now()) + pausedMs
        };
      }
      return { ...current, pausedAt: Date.now() };
    });
  }

  function toggleFlag() {
    setSession(current => {
      if (!current) return current;
      const activeQuestion = current.questions[current.currentIndex];
      return {
        ...current,
        flags: {
          ...(current.flags || {}),
          [activeQuestion.id]: !current.flags?.[activeQuestion.id]
        }
      };
    });
  }

  function select(index) {
    setSession(current => {
      if (current.pausedAt) return current;
      return {
        ...current,
        answers: {
          ...current.answers,
          [question.id]: {
            ...(current.answers[question.id] || answer),
            selected: index,
            timeMs: (current.answers[question.id]?.timeMs || Math.max(1000, Date.now() - (current.currentQuestionStartedAt || current.startedAt)))
          }
        }
      };
    });
  }

  function setConfidence(confidence) {
    setSession(current => {
      if (current.pausedAt) return current;
      return {
        ...current,
        answers: { ...current.answers, [question.id]: { ...answer, confidence } }
      };
    });
  }

  function jump(delta) {
    setSession(current => {
      if (current.pausedAt) return current;
      return {
        ...current,
        currentIndex: Math.max(0, Math.min(current.questions.length - 1, current.currentIndex + delta)),
        currentQuestionStartedAt: Date.now()
      };
    });
  }

  return (
    <div className="quiz-shell">
      <section className="panel quiz-card">
        <div className="quiz-topline">
          <div className="quiz-status">
            <span className="pill">Question {session.currentIndex + 1} / {session.questions.length}</span>
            <span className="pill clinical">{titleCase(session.mode)}</span>
            <span className={`pill timer-pill ${timerIsLow ? "danger" : ""}`}><Timer size={15} /> {formatTime(remainingMs)}</span>
            <span className="pill">{session.secondsPerQuestion}s / question</span>
          </div>
          <div className="quiz-tools">
            <button className={`btn subtle ${isPaused ? "active-control" : ""}`} onClick={togglePause}>
              {isPaused ? <Play size={16} /> : <Pause size={16} />}
              {isPaused ? "Resume" : "Pause"}
            </button>
            <button className={`btn subtle ${isFlagged ? "flag-control" : ""}`} onClick={toggleFlag}>
              <Flag size={16} />
              {isFlagged ? "Flagged" : "Flag"}
            </button>
          </div>
        </div>
        <QuestionHeader question={question} />
        <p className="stem">{question.question}</p>
        {isPaused ? (
          <div className="pause-panel">
            <Pause size={22} />
            <div>
              <strong>Test paused</strong>
              <span>Your answers are kept here. Resume when you are ready.</span>
            </div>
          </div>
        ) : null}
        <ImageGrid question={question} />
        <div className="option-list">
          {question.options.map((option, index) => {
            const state = reveal && index === question.correct ? "correct" : reveal && answer.selected === index ? "wrong" : answer.selected === index ? "selected" : "";
            return <button key={option + index} className={`option ${state}`} disabled={isPaused} onClick={() => select(index)}><b>{String.fromCharCode(65 + index)}</b><span>{option}</span></button>;
          })}
        </div>
        <div className="confidence-row">
          {["guessed", "unsure", "confident"].map(value => (
            <button key={value} className={answer.confidence === value ? "active" : ""} disabled={isPaused} onClick={() => setConfidence(value)}>{titleCase(value)}</button>
          ))}
        </div>
        {reveal ? <Explanation question={question} answer={answer} /> : null}
        <div className="bottom-actions">
          <button className="btn subtle" disabled={session.currentIndex === 0 || isPaused} onClick={() => jump(-1)}><ChevronLeft size={17} /> Prev</button>
          {session.currentIndex === session.questions.length - 1 ? <button className="btn primary" disabled={isPaused} onClick={() => finishQuiz()}>Finish</button> : <button className="btn primary" disabled={isPaused} onClick={() => jump(1)}>Next <ChevronRight size={17} /></button>}
        </div>
      </section>
      <aside className="panel navigator">
        <PanelHeader icon={ClipboardList} title="Navigator" subtitle={`${Object.keys(session.answers).length}/${session.questions.length} answered`} />
        <div className="nav-grid">
          {session.questions.map((item, index) => {
            const selected = session.answers[item.id]?.selected;
            const className = [
              index === session.currentIndex ? "active" : selected !== undefined && selected !== null ? "done" : "",
              session.flags?.[item.id] ? "flagged" : ""
            ].filter(Boolean).join(" ");
            return (
              <button key={item.id} className={className} disabled={isPaused} onClick={() => setSession(current => ({ ...current, currentIndex: index, currentQuestionStartedAt: Date.now() }))}>
                {index + 1}
              </button>
            );
          })}
        </div>
        <button className="btn danger wide" onClick={() => finishQuiz()}>End test</button>
      </aside>
    </div>
  );
}

function Result({ result, startQuiz, bookmark }) {
  return (
    <div className="stack">
      <section className="result-hero">
        <div className="score-ring">{result.accuracy}%</div>
        <div>
          <span className="eyebrow">Session complete</span>
          <h2>{result.correct} correct, {result.wrong} wrong, {result.skipped} skipped</h2>
          <p>{result.timeExpired ? "Time was over, so the test was submitted automatically." : "Review explanations now, then repeat this mode or move to mistakes in Smart Revision."}</p>
          <button className="btn primary" onClick={() => startQuiz(result.mode)}><Play size={17} /> Repeat mode</button>
        </div>
      </section>
      <section className="question-list">
        {result.rows.map(({ question, answer }) => (
          <article key={question.id} className="question-card">
            <QuestionHeader question={question} />
            <p>{question.question}</p>
            <div className="badges">
              <span className={answer.isCorrect ? "pill success" : answer.skipped ? "pill warning" : "pill danger"}>{answer.isCorrect ? "Correct" : answer.skipped ? "Skipped" : "Wrong"}</span>
              <span className="pill">Answer {String.fromCharCode(65 + question.correct)}</span>
            </div>
            <Explanation question={question} answer={answer} />
            <button className="btn subtle" onClick={() => bookmark(question.id)}><BookMarked size={17} /> Save</button>
          </article>
        ))}
      </section>
    </div>
  );
}

function ImageAudit({ audit, markAudit }) {
  return (
    <section className="panel">
      <PanelHeader icon={Image} title="Image Audit Queue" subtitle="Batch-check extracted image/question matching." right={<span className="pill">{audit.total} image-linked questions</span>} />
      <div className="question-list compact">
        {audit.items.map(question => (
          <article key={question.id} className="question-card">
            <QuestionHeader question={question} />
            <p>{question.question}</p>
            <ImageGrid question={question} includeSource />
            <div className="button-row">
              <button className="btn clinical" onClick={() => markAudit(question.id, "verified")}><CheckCircle2 size={17} /> Verified</button>
              <button className="btn subtle" onClick={() => markAudit(question.id, "needs_fix")}>Needs fix</button>
              <button className="btn subtle" onClick={() => markAudit(question.id, "not_image_based")}>Not image</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function SettingsPage({ meta, analytics, health, user }) {
  const mode = health?.mode || "loading";
  return (
    <div className="stack">
      <section className="panel">
        <PanelHeader icon={Settings} title="Workspace Status" subtitle={`Local MERN build running in ${mode} mode.`} />
        <div className="settings-grid">
          <StatusItem label="Signed in as" value={user?.email || user?.name || "Student"} />
          <StatusItem label="Questions loaded" value={meta?.totalQuestions || 0} />
          <StatusItem label="Subjects" value={meta?.subjects?.length || 0} />
          <StatusItem label="Progress mode" value={mode === "mongo" ? "Per-user Mongo tracking" : "Local file-mode fallback"} />
        </div>
      </section>
      <section className="panel">
        <PanelHeader icon={ShieldCheck} title="Deployment Checklist" subtitle="Keep these set before GitHub and Render." />
        <div className="checklist">
          <span><CheckCircle2 size={17} /> `.env` ignored locally</span>
          <span><CheckCircle2 size={17} /> `render.yaml` included</span>
          <span><CheckCircle2 size={17} /> MongoDB Atlas URI required on Render</span>
          <span><CheckCircle2 size={17} /> PDF ignored; extracted bank used at runtime</span>
        </div>
      </section>
    </div>
  );
}

function Filters({ meta, chapters, filters, setFilters }) {
  function update(key, value) {
    setFilters(current => ({ ...current, [key]: value, ...(key === "subject" ? { chapter: "" } : {}) }));
  }
  return (
    <div className="filters">
      <Field label="Subject">
        <select value={filters.subject} onChange={event => update("subject", event.target.value)}>
          <option value="">All subjects</option>
          {(meta?.subjects || []).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Chapter">
        <select value={filters.chapter} onChange={event => update("chapter", event.target.value)}>
          <option value="">All chapters</option>
          {chapters.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Exam">
        <select value={filters.exam} onChange={event => update("exam", event.target.value)}>
          <option value="">All exams</option>
          {(meta?.exams || []).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Year">
        <select value={filters.year} onChange={event => update("year", event.target.value)}>
          <option value="">All years</option>
          {(meta?.years || []).map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Difficulty">
        <select value={filters.difficulty} onChange={event => update("difficulty", event.target.value)}>
          <option value="">Any difficulty</option>
          {["Easy", "Moderate", "Difficult"].map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </Field>
      <Field label="Repeated">
        <select value={filters.repeated} onChange={event => update("repeated", event.target.value)}>
          <option value="">Any frequency</option>
          {[2, 3, 5, 7].map(value => <option key={value} value={value}>Repeated ≥ {value}</option>)}
        </select>
      </Field>
      <Field label="Search">
        <input value={filters.search} onChange={event => update("search", event.target.value)} placeholder="ARDS, ECG, cricothyroid" />
      </Field>
      <label className="check">
        <input type="checkbox" checked={filters.highYield} onChange={event => update("highYield", event.target.checked)} />
        High yield
      </label>
      <label className="check">
        <input type="checkbox" checked={filters.imageOnly} onChange={event => update("imageOnly", event.target.checked)} />
        Image only
      </label>
    </div>
  );
}

function QuestionCard({ question, onPractice, bookmark }) {
  return (
    <article className="question-card">
      <QuestionHeader question={question} />
      <p>{question.question}</p>
      <div className="card-footer">
        <span className="muted">Q{question.questionNo} · pages {(question.sourcePages || []).join(", ") || "n/a"}</span>
        <div className="button-row">
          <button className="btn clinical" onClick={onPractice}><Play size={17} /> Practice</button>
          <button className="btn subtle" onClick={bookmark}><BookMarked size={17} /> Save</button>
        </div>
      </div>
    </article>
  );
}

function ReviewCard({ question, state, bookmark }) {
  return (
    <article className="question-card">
      <QuestionHeader question={question} />
      <p>{question.question}</p>
      <div className="review-stats">
        <span>Attempts <b>{state.attempts || 0}</b></span>
        <span>Wrong <b>{state.wrong || 0}</b></span>
        <span>Confidence <b>{state.lastConfidence || "n/a"}</b></span>
        <span>Due <b>{state.dueAt ? new Date(state.dueAt).toLocaleDateString() : "n/a"}</b></span>
      </div>
      <button className="btn subtle" onClick={bookmark}><BookMarked size={17} /> Toggle save</button>
    </article>
  );
}

function QuestionHeader({ question }) {
  return (
    <div className="badges">
      <span className="pill blue">{question.subject}</span>
      <span className="pill">{question.chapter}</span>
      <span className="pill">{question.exam} {question.year}</span>
      {question.highYield ? <span className="pill warning">High-yield</span> : null}
      {question.repeatedCount > 1 ? <span className="pill clinical">Repeated {question.repeatedCount}</span> : null}
      {(question.images?.length || question.sourceMedia?.length) ? <span className="pill success">Image</span> : null}
    </div>
  );
}

function ImageGrid({ question, includeSource = false }) {
  const images = includeSource ? [...(question.images || []), ...(question.sourceMedia || [])] : question.images || [];
  const unique = images.filter((image, index, arr) => arr.findIndex(item => item.src === image.src) === index);
  if (!unique.length) return null;
  return <div className="media-grid">{unique.map(image => <img key={image.src} src={`/${image.src}`} alt={`Source page ${image.page}`} loading="lazy" />)}</div>;
}

function Explanation({ question, answer }) {
  return (
    <div className="explanation">
      <strong>Correct answer: {String.fromCharCode(65 + question.correct)} - {question.options[question.correct]}</strong>
      <p>{question.explanation || "Explanation not available."}</p>
      <p className="muted">Your answer: {answer.selected === null || answer.selected === undefined ? "Skipped" : String.fromCharCode(65 + answer.selected)} · Time {formatTime(answer.timeMs)}</p>
    </div>
  );
}

function Metric({ icon: Icon, label, value }) {
  return <div className="metric">{Icon ? <Icon size={20} /> : null}<strong>{value}</strong><span>{label}</span></div>;
}

function PanelHeader({ icon: Icon, title, subtitle, right }) {
  return (
    <div className="panel-header">
      <div>
        <div className="panel-title">{Icon ? <Icon size={18} /> : null}<h2>{title}</h2></div>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {right}
    </div>
  );
}

function Progress({ label, detail, value }) {
  return <div className="progress"><div><span>{label}</span><strong>{value}%</strong></div><small>{detail}</small><i style={{ width: `${value}%` }} /></div>;
}

function ChapterRow({ chapter }) {
  return (
    <div className="chapter-row">
      <div>
        <strong>{chapter.name}</strong>
        <span>{chapter.attempted}/{chapter.total} attempted</span>
      </div>
      <b>{chapter.accuracy}%</b>
    </div>
  );
}

function ChapterTile({ chapter }) {
  return (
    <div className="chapter-tile">
      <strong>{chapter.completion}%</strong>
      <span>{chapter.name}</span>
      <small>{chapter.accuracy}% accuracy</small>
    </div>
  );
}

function StatusItem({ label, value }) {
  return <div className="status-item"><span>{label}</span><strong>{value}</strong></div>;
}

function EmptyState({ icon: Icon, title, text }) {
  return (
    <div className="empty-state">
      <Icon size={26} />
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function Field({ label, children }) {
  return <label className="field"><span>{label}</span>{children}</label>;
}
