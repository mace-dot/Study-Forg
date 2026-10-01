"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  Course,
  Material,
  Pack,
  PackContent,
  Source,
  Question,
  Feedback,
  Attempt,
  Job,
  MaterialKind,
} from "@/lib/types";
import { materialKinds } from "@/lib/types";
type PublicSession = {
  id: string;
  courseId: string;
  packId: string;
  mode: "guided" | "mock";
  questions: (Question & { validation: string })[];
  responses: Record<string, string>;
  feedback: Feedback[];
  completed: boolean;
  deadline: number | null;
  createdAt: string;
};
type PublicJob = Omit<Job, "chunks" | "parts"> & {
  preview: PackContent | null;
};
type State = {
  courses: Course[];
  materials: Material[];
  packs: Pack[];
  jobs: PublicJob[];
  attempts: Attempt[];
  sessions: PublicSession[];
};
type Config = {
  cloud: boolean;
  ai: boolean;
  supabaseUrl: string | null;
  supabaseKey: string | null;
  hostedDemo: boolean;
};
const empty: State = {
  courses: [],
  materials: [],
  packs: [],
  jobs: [],
  attempts: [],
  sessions: [],
};
const date = (v: string) => new Date(v).toLocaleDateString();
export default function Home() {
  const [config, setConfig] = useState<Config | null>(null),
    [state, setState] = useState<State>(empty),
    [courseId, setCourseId] = useState(""),
    [tab, setTab] = useState("Upload Materials"),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [signedIn, setSignedIn] = useState(false),
    [loading, setLoading] = useState(true);
  const [courseModal, setCourseModal] = useState(false),
    [newCourse, setNewCourse] = useState({
      name: "",
      subject: "Finance",
      examDate: "",
      topics: "",
    }),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [pending, setPending] = useState<
      { key: string; file: File; kind: MaterialKind; status: string }[]
    >([]),
    [notes, setNotes] = useState(""),
    [dragging, setDragging] = useState(false),
    [selection, setSelection] = useState<string[]>([]),
    [job, setJob] = useState<PublicJob | null>(null),
    [search, setSearch] = useState("");
  const [practice, setPractice] = useState({
      mode: "guided" as "guided" | "mock",
      count: 5,
      difficulty: "medium",
      topic: "",
      minutes: 20,
    }),
    [session, setSession] = useState<PublicSession | null>(null),
    [responses, setResponses] = useState<Record<string, string>>({}),
    [remaining, setRemaining] = useState(0),
    [source, setSource] = useState<Source | null>(null),
    [sourceURL, setSourceURL] = useState("");
  const auth = useRef<SupabaseClient | null>(null),
    token = useRef(""),
    responsesRef = useRef(responses),
    timerSubmitted = useRef(false);
  responsesRef.current = responses;
  const api = useCallback(async (url: string, options: RequestInit = {}) => {
    const headers = new Headers(options.headers);
    if (token.current) headers.set("Authorization", "Bearer " + token.current);
    if (options.body && !(options.body instanceof FormData))
      headers.set("Content-Type", "application/json");
    const r = await fetch("/api/" + url, {
      ...options,
      headers,
      cache: "no-store",
    });
    if (!r.ok) {
      const data = await r.json().catch(() => ({ error: "Request failed." }));
      throw Object.assign(new Error(data.error), { status: r.status });
    }
    return r.json();
  }, []);
  const refresh = useCallback(async () => {
    const data: State = await api("bootstrap");
    setState(data);
    setCourseId((previous) =>
      data.courses.some((c) => c.id === previous)
        ? previous
        : data.courses[0]?.id || "",
    );
    return data;
  }, [api]);
  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    (async () => {
      try {
        const c: Config = await api("config");
        if (disposed) return;
        setConfig(c);
        if (c.cloud) {
          auth.current = createClient(c.supabaseUrl!, c.supabaseKey!);
          const { data } = await auth.current.auth.getSession();
          token.current = data.session?.access_token || "";
          setSignedIn(Boolean(data.session));
          if (data.session) await refresh();
          const { data: listener } = auth.current.auth.onAuthStateChange(
            (_event, s) => {
              token.current = s?.access_token || "";
              setSignedIn(Boolean(s));
              if (s)
                setTimeout(
                  () => void refresh().catch((e) => setError(e.message)),
                  0,
                );
              else {
                setState(empty);
                setCourseId("");
                setSession(null);
                setResponses({});
                setJob(null);
                setSource(null);
              }
            },
          );
          unsubscribe = () => listener.subscription.unsubscribe();
        } else await refresh();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        if (!disposed) setLoading(false);
      }
    })();
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [api, refresh]);
  useEffect(() => {
    if (!courseModal && !source) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const selector =
      "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], iframe";
    (
      dialog?.querySelector<HTMLElement>("input") ||
      dialog?.querySelector<HTMLElement>(selector)
    )?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCourseModal(false);
        setSource(null);
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const elements = Array.from(
        dialog.querySelectorAll<HTMLElement>(selector),
      );
      const first = elements[0],
        last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [courseModal, source?.id]);
  useEffect(
    () => () => {
      if (sourceURL) URL.revokeObjectURL(sourceURL);
    },
    [sourceURL],
  );
  const course = state.courses.find((c) => c.id === courseId),
    materials = state.materials.filter((m) => m.courseId === courseId),
    packs = state.packs
      .filter((p) => p.courseId === courseId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    pack = packs[0],
    attempts = state.attempts.filter((a) => a.courseId === courseId),
    sources = materials.flatMap((m) => m.sources);
  useEffect(() => {
    setSelection(
      state.materials.filter((m) => m.courseId === courseId).map((m) => m.id),
    );
    setPending([]);
    setNotes("");
    setSearch("");
    setSession(null);
    setResponses({});
    setPractice((p) => ({ ...p, topic: "" }));
    setJob(
      state.jobs
        .filter((j) => j.courseId === courseId && j.status !== "complete")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] || null,
    );
  }, [courseId]); // Only reset when switching course; uploads retain their selection.
  async function task(label: string, fn: () => Promise<void>) {
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function createCourse() {
    await task("Creating course", async () => {
      const c = await api("courses", {
        method: "POST",
        body: JSON.stringify(newCourse),
      });
      await refresh();
      setCourseId(c.id);
      setCourseModal(false);
      setNewCourse({ name: "", subject: "Finance", examDate: "", topics: "" });
      setTab("Upload Materials");
    });
  }
  async function sample(type: "finance" | "reading") {
    await task("Loading sample", async () => {
      const c = await api("courses", {
        method: "POST",
        body: JSON.stringify({
          name:
            type === "finance"
              ? "Finance · Short selling"
              : "Economics · Trade policy",
          subject: type === "finance" ? "Finance" : "Economics",
          examDate: "",
          topics: "",
        }),
      });
      const m = await api("samples", {
        method: "POST",
        body: JSON.stringify({ courseId: c.id, type }),
      });
      await refresh();
      setCourseId(c.id);
      setSelection([m.id]);
      setTab("Upload Materials");
      setNotice(
        "Sample ready. Click Generate Study Pack to try the full workflow.",
      );
    });
  }
  function addFiles(files: File[]) {
    setPending((old) => [
      ...old,
      ...files.map((file) => ({
        key: crypto.randomUUID(),
        file,
        kind: "lecture slides" as MaterialKind,
        status: "Ready",
      })),
    ]);
  }
  async function upload() {
    await task("Extracting materials", async () => {
      const batch = [...pending];
      if (notes.trim())
        batch.push({
          key: "notes",
          file: new File(
            [notes],
            `Notes-${new Date().toISOString().slice(0, 10)}.txt`,
            { type: "text/plain" },
          ),
          kind: "notes",
          status: "Ready",
        });
      let failures = 0;
      for (const item of batch) {
        setPending((p) =>
          p.map((x) =>
            x.key === item.key ? { ...x, status: "Extracting…" } : x,
          ),
        );
        const form = new FormData();
        form.set("courseId", courseId);
        form.set("kind", item.kind);
        form.set("file", item.file);
        try {
          const m: Material = await api("materials", {
            method: "POST",
            body: form,
          });
          setSelection((p) => Array.from(new Set([...p, m.id])));
          if (item.key === "notes") setNotes("");
          else setPending((p) => p.filter((x) => x.key !== item.key));
        } catch (e) {
          failures++;
          const message = (e as Error).message;
          if (item.key === "notes") setError(message);
          else
            setPending((p) =>
              p.map((x) =>
                x.key === item.key ? { ...x, status: message } : x,
              ),
            );
        }
      }
      await refresh();
      setNotice(
        failures
          ? `${failures} item(s) need attention. Successful files are saved; retry the remaining items.`
          : "Materials extracted and saved. Ready to generate.",
      );
    });
  }
  async function runJob(existing?: PublicJob) {
    await task("Building study pack", async () => {
      let current: PublicJob =
        existing ||
        (await api("jobs", {
          method: "POST",
          body: JSON.stringify({ courseId, materialIds: selection }),
        }));
      setJob(current);
      while (current.status !== "complete") {
        try {
          current = await api(`jobs/${current.id}`, { method: "POST" });
        } catch (e) {
          if ((e as Error & { status?: number }).status !== 409) throw e;
          await new Promise((resolve) => setTimeout(resolve, 750));
          current = await api(`jobs/${current.id}`);
        }
        setJob(current);
        if (current.status === "failed") throw new Error(current.error);
      }
      await refresh();
      setJob(null);
      setTab("Study Pack");
      setNotice("Your review and pattern map are ready.");
    });
  }
  async function startPractice() {
    if (!pack) return;
    await task("Preparing practice", async () => {
      const s = await api("practice", {
        method: "POST",
        body: JSON.stringify({ ...practice, packId: pack.id }),
      });
      setSession(s);
      setResponses(s.responses);
      timerSubmitted.current = false;
      await refresh();
    });
  }
  async function submit(final: boolean, one?: string) {
    if (!session) return;
    await task("Checking answers", async () => {
      const s = await api(`practice/${session.id}`, {
        method: "POST",
        body: JSON.stringify({
          responses: one
            ? { [one]: responsesRef.current[one] || "" }
            : responsesRef.current,
          final,
        }),
      });
      setSession(s);
      await refresh();
    });
  }
  useEffect(() => {
    if (!session?.deadline || session.completed) return;
    const tick = () => {
      const seconds = Math.max(
        0,
        Math.ceil((session.deadline! - Date.now()) / 1000),
      );
      setRemaining(seconds);
      if (seconds === 0 && !timerSubmitted.current) {
        timerSubmitted.current = true;
        void submit(true);
      }
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session?.id, session?.deadline, session?.completed]);
  useEffect(() => {
    if (
      !session ||
      session.mode !== "mock" ||
      session.completed ||
      !Object.keys(responses).length
    )
      return;
    const timeout = setTimeout(() => {
      void api(`practice/${session.id}`, {
        method: "POST",
        body: JSON.stringify({ responses, final: false }),
      }).catch((e) => setError("Could not save answers: " + e.message));
    }, 500);
    return () => clearTimeout(timeout);
  }, [responses, session?.id, session?.completed, api]);
  function sourceButtons(ids: string[]) {
    return (
      <div className="citations">
        {Array.from(new Set(ids)).map((id) => {
          const s = sources.find((x) => x.id === id);
          return (
            <button
              key={id}
              className="source-link"
              disabled={!s}
              onClick={() => {
                setSource(s!);
                setSourceURL("");
              }}
            >
              {s ? `${s.filename} · ${s.location}` : "Source removed"}
            </button>
          );
        })}
      </div>
    );
  }
  function contentView(content: PackContent) {
    return (
      <>
        <section className="card overview">
          <div className="eyebrow">THE BIG PICTURE</div>
          <h2>How it fits together</h2>
          <p className="preserve">{content.overview}</p>
        </section>
        <div className="section-heading">
          <h2>Understand the concepts</h2>
          <label className="search-label">
            <span className="sr-only">Search concepts</span>
            <input
              placeholder="Search topics…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
        {content.concepts
          .filter((c) =>
            `${c.title} ${c.explanation}`
              .toLowerCase()
              .includes(search.toLowerCase()),
          )
          .map((c, i) => (
            <details
              className="card concept"
              key={i}
              open={!search ? i === 0 : true}
            >
              <summary>
                {c.title}
                <span>Explore concept</span>
              </summary>
              <p className="preserve">{c.explanation}</p>
              <div className="intuition">
                <strong>The intuition</strong>
                <p className="preserve">{c.intuition}</p>
              </div>
              {c.prerequisites.length > 0 && (
                <p>
                  <strong>Before you start:</strong>{" "}
                  {c.prerequisites.join(" · ")}
                </p>
              )}
              {c.assumptions.length > 0 && (
                <p>
                  <strong>Assumptions:</strong> {c.assumptions.join(" · ")}
                </p>
              )}
              {c.formulas.map((f, j) => (
                <div className="formula" key={j}>
                  <code>{f.expression}</code>
                  <p>{f.variables}</p>
                  <small>Use it when: {f.when}</small>
                </div>
              ))}
              <h3>Watch out for</h3>
              <ul>
                {c.mistakes.map((m, j) => (
                  <li key={j}>{m}</li>
                ))}
              </ul>
              {sourceButtons(c.sourceIds)}
            </details>
          ))}
        <h2>Worked examples</h2>
        {content.examples.map((example, i) => (
          <details className="card" key={i}>
            <summary>{example.title}</summary>
            <p>{example.problem}</p>
            <ol>
              {example.steps.map((step, j) => (
                <li key={j}>{step}</li>
              ))}
            </ol>
            <p className="intuition">{example.interpretation}</p>
            {sourceButtons(example.sourceIds)}
          </details>
        ))}
        <section className="card quick-sheet" id="quick-sheet">
          <div className="section-heading">
            <h2>Your quick review</h2>
            <button
              className="secondary no-print"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
          </div>
          <ul>
            {content.quickReview.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
          {content.concepts
            .flatMap((c) => c.formulas)
            .map((f, i) => (
              <p key={i}>
                <code>{f.expression}</code> — {f.when}
              </p>
            ))}
        </section>
        <div className="section-heading">
          <h2>Exam pattern map</h2>
          <small>Observed structures, never exam predictions.</small>
        </div>
        <div className="pattern-grid">
          {content.patterns.map((p, i) => (
            <article className="card" key={i}>
              <span className={"badge " + (p.suggested ? "" : "green")}>
                {p.suggested
                  ? "Suggested practice"
                  : `${p.evidence.length} source example${p.evidence.length === 1 ? "" : "s"}`}
              </span>
              <h3>{p.title}</h3>
              <p>{p.skills.join(" · ")}</p>
              <ol>
                {p.steps.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
              <p>
                <strong>Common traps:</strong> {p.traps.join(" · ")}
              </p>
              {sourceButtons(p.evidence.map((e) => e.sourceId))}
              {p.evidence.map((e, j) => (
                <details key={j}>
                  <summary>Source example {j + 1}</summary>
                  <p>{e.question}</p>
                </details>
              ))}
              {pack && (
                <button
                  className="secondary"
                  onClick={() => {
                    setPractice((old) => ({ ...old, topic: p.title }));
                    setSession(null);
                    setTab("Practice");
                  }}
                >
                  Practice this pattern →
                </button>
              )}
            </article>
          ))}
        </div>
        {content.warnings.length > 0 && (
          <details className="card warnings">
            <summary>
              Source quality & limitations ({content.warnings.length})
            </summary>
            <ul>
              {content.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </details>
        )}
      </>
    );
  }
  const graded = attempts.filter(
      (a) => a.feedback.correct !== null && !a.reported,
    ),
    accuracy = graded.length
      ? Math.round(
          (graded.filter((a) => a.feedback.correct).length / graded.length) *
            100,
        )
      : null;
  const topics = Array.from(new Set(attempts.map((a) => a.topic))).map(
    (topic) => {
      const all = attempts.filter((a) => a.topic === topic),
        scored = all.filter((a) => a.feedback.correct !== null && !a.reported),
        last = all
          .map((a) => a.createdAt)
          .sort()
          .at(-1)!;
      return {
        topic,
        total: all.length,
        scored: scored.length,
        correct: scored.filter((a) => a.feedback.correct).length,
        last,
        weak: scored.some((a) => !a.feedback.correct),
        due: Date.now() - new Date(last).getTime() > 7 * 86400000,
      };
    },
  );
  return (
    <div className="app-shell">
      <aside className="sidebar no-print">
        <a className="brand" href="/" aria-label="StudyForge home">
          <span className="brand-mark">S</span>StudyForge
          <span className="beta">BETA</span>
        </a>
        <p className="sidebar-caption">YOUR STUDY SPACE</p>
        <label className="course-picker">
          Course
          <select
            aria-label="Select course"
            value={courseId}
            disabled={Boolean(busy)}
            onChange={(e) => setCourseId(e.target.value)}
          >
            <option value="">Select a course</option>
            {state.courses.map((c) => (
              <option value={c.id} key={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="add-course"
          disabled={Boolean(busy)}
          onClick={() => setCourseModal(true)}
        >
          ＋ New course
        </button>
        <nav aria-label="Main navigation">
          {[
            "Courses",
            "Upload Materials",
            "Study Pack",
            "Practice",
            "Progress",
          ].map((name, i) => (
            <button
              key={name}
              className={tab === name ? "active" : ""}
              onClick={() => setTab(name)}
            >
              <span aria-hidden="true">{["▦", "↑", "▤", "✦", "◷"][i]}</span>
              {name}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Understand.
            <br />
            Practice.
            <br />
            <strong>Remember.</strong>
          </p>
          <small>
            {config?.cloud
              ? "Private cloud workspace"
              : "Local sample workspace"}
          </small>
          {signedIn && (
            <button
              className="text-button"
              onClick={() => void auth.current?.auth.signOut()}
            >
              Sign out
            </button>
          )}
        </div>
      </aside>
      <main>
        <header className="topbar no-print">
          <span>{course?.name || "Your next great study session"}</span>
          <span className="badge">
            {config?.cloud ? "Cloud saved" : "Local mode"}
          </span>
        </header>
        <div className="main-content">
          {config && !config.cloud && (
            <div className="mode-banner no-print">
              <strong>{config.ai ? "Local development" : "Demo mode"}</strong> ·{" "}
              {config.ai
                ? "Your uploads can be analyzed locally."
                : "Built-in samples work without an AI key. Your own uploads need AI configuration."}{" "}
              {config.hostedDemo &&
                "Demo data on this host can reset; use cloud mode for durable storage."}
            </div>
          )}
          {error && (
            <div role="alert" className="alert error no-print">
              {error}
              <button aria-label="Dismiss error" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert success no-print">
              {notice}
            </div>
          )}
          {busy && (
            <div role="status" className="working no-print">
              <span className="spinner" />
              {busy}…
            </div>
          )}
          {loading ? (
            <div className="card">Loading your study space…</div>
          ) : config?.cloud && !signedIn ? (
            <section className="card auth">
              <div className="eyebrow">WELCOME TO STUDYFORGE</div>
              <h1>Your materials. Your study plan.</h1>
              <p>
                Sign in to keep your courses, sources, and practice private.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void task("Signing in", async () => {
                    const { error } =
                      await auth.current!.auth.signInWithPassword({
                        email,
                        password,
                      });
                    if (error) throw error;
                  });
                }}
              >
                <label>
                  Email
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </label>
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={8}
                    required
                  />
                </label>
                <button className="primary" disabled={Boolean(busy)}>
                  Sign in
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={Boolean(busy) || !email || password.length < 8}
                  onClick={() =>
                    void task("Creating account", async () => {
                      const { data, error } = await auth.current!.auth.signUp({
                        email,
                        password,
                      });
                      if (error) throw error;
                      setNotice(
                        data.session
                          ? "Account created."
                          : "Check your email to confirm your account, then sign in.",
                      );
                    })
                  }
                >
                  Create account
                </button>
              </form>
            </section>
          ) : (
            <>
              {(!course || tab === "Courses") && (
                <>
                  <div className="hero">
                    <div className="eyebrow">
                      LESS PROMPTING. MORE UNDERSTANDING.
                    </div>
                    <h1>
                      Your lecture,
                      <br />
                      <span>finally making sense.</span>
                    </h1>
                    <p>
                      Drop in your slides and notes. Get clear explanations,
                      worked examples, and practice that targets the way your
                      course asks questions.
                    </p>
                    <button
                      className="primary"
                      onClick={() => setCourseModal(true)}
                    >
                      Create a course <span>＋</span>
                    </button>
                  </div>
                  <div className="section-heading">
                    <h2>
                      {state.courses.length
                        ? "Your courses"
                        : "Try it with a sample"}
                    </h2>
                    <small>No prompts needed.</small>
                  </div>
                  <div className="pattern-grid">
                    {state.courses.map((c) => (
                      <article className="card course-card" key={c.id}>
                        <span className="badge">{c.subject}</span>
                        <h3>{c.name}</h3>
                        <p>
                          {
                            state.materials.filter((m) => m.courseId === c.id)
                              .length
                          }{" "}
                          materials ·{" "}
                          {
                            state.packs.filter((p) => p.courseId === c.id)
                              .length
                          }{" "}
                          study packs
                        </p>
                        {c.examDate && <p>Exam: {c.examDate}</p>}
                        <button
                          className="secondary"
                          onClick={() => {
                            setCourseId(c.id);
                            setTab("Upload Materials");
                          }}
                        >
                          Open course →
                        </button>
                        <button
                          className="text-button danger"
                          disabled={Boolean(busy)}
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete ${c.name}, including all its files, reviews, and attempts?`,
                              )
                            )
                              void task("Deleting course", async () => {
                                await api("courses/" + c.id, {
                                  method: "DELETE",
                                });
                                await refresh();
                              });
                          }}
                        >
                          Delete course
                        </button>
                      </article>
                    ))}
                  </div>
                  <div className="sample-row">
                    <button
                      className="sample-card"
                      disabled={Boolean(busy)}
                      onClick={() => void sample("finance")}
                    >
                      <span>01 · FINANCE</span>
                      <strong>Short selling & margin</strong>
                      <small>
                        Calculated problems, step-by-step solutions →
                      </small>
                    </button>
                    <button
                      className="sample-card"
                      disabled={Boolean(busy)}
                      onClick={() => void sample("reading")}
                    >
                      <span>02 · ECONOMICS</span>
                      <strong>Tariffs & trade policy</strong>
                      <small>
                        Conceptual review, graphs, self-check questions →
                      </small>
                    </button>
                  </div>
                </>
              )}
              {course && tab === "Upload Materials" && (
                <>
                  <div className="page-heading">
                    <div className="eyebrow">STEP 01 / YOUR MATERIALS</div>
                    <h1>Drop it in. Connect the dots.</h1>
                    <p>
                      Slides, notes, homework, and practice exams—all in one
                      study pack.
                    </p>
                  </div>
                  <section
                    className={"drop-zone " + (dragging ? "dragging" : "")}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setDragging(true);
                    }}
                    onDragLeave={() => setDragging(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragging(false);
                      if (!busy) addFiles(Array.from(e.dataTransfer.files));
                    }}
                  >
                    <div className="upload-symbol">↑</div>
                    <h2>Drag your materials here</h2>
                    <p>PDF, PPTX, DOCX, TXT, PNG, JPG, WebP</p>
                    <label className="primary file-button">
                      Browse files
                      <input
                        type="file"
                        multiple
                        accept=".pdf,.pptx,.docx,.txt,.png,.jpg,.jpeg,.webp"
                        disabled={Boolean(busy)}
                        onChange={(e) => {
                          addFiles(Array.from(e.target.files || []));
                          e.target.value = "";
                        }}
                      />
                    </label>
                    <small>
                      Up to 3.5 MB and 80 pages/slides per file. Upload diagrams
                      as screenshots for visual interpretation.
                    </small>
                  </section>
                  {pending.map((item) => (
                    <div className="file-row card" key={item.key}>
                      <div>
                        <strong>{item.file.name}</strong>
                        <small>
                          {item.status} · {(item.file.size / 1024).toFixed(0)}{" "}
                          KB
                        </small>
                      </div>
                      <label>
                        <span className="sr-only">
                          Material type for {item.file.name}
                        </span>
                        <select
                          value={item.kind}
                          disabled={Boolean(busy)}
                          onChange={(e) =>
                            setPending((p) =>
                              p.map((x) =>
                                x.key === item.key
                                  ? {
                                      ...x,
                                      kind: e.target.value as MaterialKind,
                                    }
                                  : x,
                              ),
                            )
                          }
                        >
                          {materialKinds.map((k) => (
                            <option key={k}>{k}</option>
                          ))}
                        </select>
                      </label>
                      <button
                        className="text-button"
                        disabled={Boolean(busy)}
                        aria-label={"Remove " + item.file.name}
                        onClick={() =>
                          setPending((p) => p.filter((x) => x.key !== item.key))
                        }
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <details className="card paste-card">
                    <summary>Prefer to paste your notes?</summary>
                    <label className="sr-only" htmlFor="notes">
                      Course notes
                    </label>
                    <textarea
                      id="notes"
                      placeholder="Paste lecture notes here. Separate topics with blank lines…"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </details>
                  {(pending.length > 0 || notes.trim()) && (
                    <button
                      className="secondary"
                      disabled={Boolean(busy)}
                      onClick={() => void upload()}
                    >
                      Upload & extract {pending.length + (notes.trim() ? 1 : 0)}{" "}
                      item(s)
                    </button>
                  )}
                  <div className="section-heading">
                    <h2>
                      Course materials{" "}
                      <span className="count">{materials.length}</span>
                    </h2>
                    <small>Select the sources for this review.</small>
                  </div>
                  {materials.length === 0 ? (
                    <div className="empty-state">
                      Add your first file above, or try a sample from Courses.
                    </div>
                  ) : (
                    materials.map((m) => (
                      <article className="card material-card" key={m.id}>
                        <div className="material-title">
                          <input
                            type="checkbox"
                            aria-label={"Include " + m.filename}
                            checked={selection.includes(m.id)}
                            disabled={Boolean(busy)}
                            onChange={(e) =>
                              setSelection((p) =>
                                e.target.checked
                                  ? [...p, m.id]
                                  : p.filter((id) => id !== m.id),
                              )
                            }
                          />
                          <div>
                            <strong>{m.filename}</strong>
                            <small>
                              {m.kind} · {m.sources.length} source sections{" "}
                              {m.sample ? "· sample" : ""}
                            </small>
                          </div>
                          <button
                            className="text-button danger"
                            disabled={Boolean(busy)}
                            onClick={() => {
                              if (
                                window.confirm(
                                  "Delete this material and its original file? Existing source links will become unavailable.",
                                )
                              )
                                void task("Removing material", async () => {
                                  await api("materials/" + m.id, {
                                    method: "DELETE",
                                  });
                                  setSelection((p) =>
                                    p.filter((id) => id !== m.id),
                                  );
                                  await refresh();
                                });
                            }}
                          >
                            Remove
                          </button>
                        </div>
                        {m.warnings.length > 0 && (
                          <details>
                            <summary>
                              {m.warnings.length} extraction notice(s)
                            </summary>
                            <ul>
                              {m.warnings.map((w, i) => (
                                <li key={i}>{w}</li>
                              ))}
                            </ul>
                          </details>
                        )}
                        <button
                          className="source-link"
                          onClick={() => setSource(m.sources[0])}
                        >
                          Preview extracted source →
                        </button>
                      </article>
                    ))
                  )}
                  <div className="generate-bar">
                    <div>
                      <strong>{selection.length} material(s) selected</strong>
                      <small>Review + worked examples + pattern map</small>
                    </div>
                    <button
                      className="primary"
                      disabled={Boolean(busy) || !selection.length}
                      onClick={() => void runJob()}
                    >
                      Generate Study Pack ✦
                    </button>
                  </div>
                  {job && (
                    <section className="card">
                      <h3>
                        {job.status === "failed"
                          ? "Generation paused"
                          : "Your study pack is taking shape"}
                      </h3>
                      <progress max={job.total} value={job.step} />
                      <p>
                        {job.step} of {job.total} sections saved.
                      </p>
                      {job.error && <p>{job.error}</p>}
                      <button
                        className="secondary"
                        disabled={Boolean(busy)}
                        onClick={() => void runJob(job)}
                      >
                        Resume / retry remaining sections
                      </button>
                      {job.preview && contentView(job.preview)}
                    </section>
                  )}
                </>
              )}
              {course && tab === "Study Pack" && (
                <>
                  <div className="page-heading">
                    <div className="eyebrow">STEP 02 / MAKE IT CLICK</div>
                    <h1>Understand the why.</h1>
                    <p>
                      Read the explanation. Follow an example. Then put it to
                      work.
                    </p>
                  </div>
                  {pack ? (
                    <>
                      <div className="pack-toolbar no-print">
                        <span className="badge">
                          {pack.demo
                            ? "Sample study pack"
                            : "Generated from your sources"}
                        </span>
                        <small>
                          {date(pack.createdAt)} · {pack.concepts.length}{" "}
                          concepts
                        </small>
                        <button
                          className="primary"
                          onClick={() => {
                            setSession(null);
                            setTab("Practice");
                          }}
                        >
                          Start practicing →
                        </button>
                      </div>
                      {contentView(pack)}
                    </>
                  ) : (
                    <div className="empty-state">
                      Generate a study pack from Upload Materials to begin.
                    </div>
                  )}
                </>
              )}
              {course && tab === "Practice" && (
                <>
                  <div className="page-heading">
                    <div className="eyebrow">STEP 03 / LEARN BY DOING</div>
                    <h1>Make the next question easier.</h1>
                    <p>
                      Fresh problems. Clear reasoning. No answers revealed
                      before you try.
                    </p>
                  </div>
                  {!pack ? (
                    <div className="empty-state">
                      Generate your first study pack to unlock practice.
                    </div>
                  ) : !session ? (
                    <>
                      <section className="card practice-settings">
                        <label>
                          Pattern
                          <select
                            value={practice.topic}
                            onChange={(e) =>
                              setPractice((p) => ({
                                ...p,
                                topic: e.target.value,
                              }))
                            }
                          >
                            <option value="">All patterns</option>
                            {pack.patterns.map((p, i) => (
                              <option key={i}>{p.title}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Mode
                          <select
                            value={practice.mode}
                            onChange={(e) =>
                              setPractice((p) => ({
                                ...p,
                                mode: e.target.value as "guided" | "mock",
                              }))
                            }
                          >
                            <option value="guided">Guided practice</option>
                            <option value="mock">Timed mock exam</option>
                          </select>
                        </label>
                        <label>
                          Difficulty
                          <select
                            value={practice.difficulty}
                            onChange={(e) =>
                              setPractice((p) => ({
                                ...p,
                                difficulty: e.target.value,
                              }))
                            }
                          >
                            {["easy", "medium", "hard"].map((v) => (
                              <option key={v}>{v}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Questions
                          <input
                            type="number"
                            min={1}
                            max={20}
                            value={practice.count}
                            onChange={(e) =>
                              setPractice((p) => ({
                                ...p,
                                count: Number(e.target.value),
                              }))
                            }
                          />
                        </label>
                        {practice.mode === "mock" && (
                          <label>
                            Minutes
                            <input
                              type="number"
                              min={1}
                              max={180}
                              value={practice.minutes}
                              onChange={(e) =>
                                setPractice((p) => ({
                                  ...p,
                                  minutes: Number(e.target.value),
                                }))
                              }
                            />
                          </label>
                        )}
                        <button
                          className="primary"
                          disabled={Boolean(busy) || !pack.patterns.length}
                          onClick={() => void startPractice()}
                        >
                          Build my practice session →
                        </button>
                        <p className="muted">
                          Calculated questions are checked by code. Written,
                          journal-entry, and graph responses use self-check
                          rubrics.
                        </p>
                      </section>
                      {state.sessions
                        .filter((s) => s.courseId === courseId && !s.completed)
                        .map((s) => (
                          <div className="card resume-row" key={s.id}>
                            <span>
                              {s.mode === "mock"
                                ? "Mock exam"
                                : "Guided practice"}{" "}
                              · {s.questions.length} questions ·{" "}
                              {date(s.createdAt)}
                            </span>
                            <button
                              className="secondary"
                              onClick={() => {
                                setSession(s);
                                setResponses(s.responses);
                                timerSubmitted.current = false;
                              }}
                            >
                              Resume
                            </button>
                          </div>
                        ))}
                    </>
                  ) : (
                    <>
                      <div className="session-bar">
                        <span className="badge">
                          {session.mode === "mock"
                            ? "Mock exam"
                            : "Guided practice"}
                        </span>
                        {session.deadline && !session.completed && (
                          <strong role="timer">
                            {Math.floor(remaining / 60)}:
                            {String(remaining % 60).padStart(2, "0")} remaining
                          </strong>
                        )}
                        <button
                          className="secondary"
                          disabled={Boolean(busy)}
                          onClick={() => setSession(null)}
                        >
                          New session
                        </button>
                      </div>
                      {session.questions.map((q, i) => {
                        const feedback = session.feedback.find(
                            (f) => f.questionId === q.id,
                          ),
                          locked = Boolean(feedback) || session.completed;
                        return (
                          <article className="card question-card" key={q.id}>
                            <div className="eyebrow">
                              QUESTION {i + 1} · {q.difficulty.toUpperCase()} ·{" "}
                              {q.validation === "calculated"
                                ? "CALCULATED"
                                : q.validation === "reflection"
                                  ? "SELF-CHECK"
                                  : "CONCEPTUAL"}
                            </div>
                            <h3>{q.prompt}</h3>
                            {q.type === "multiple-choice" ? (
                              <fieldset disabled={locked || Boolean(busy)}>
                                <legend className="sr-only">
                                  Answer choices
                                </legend>
                                {q.choices.map((choice, j) => (
                                  <label className="choice" key={j}>
                                    <input
                                      type="radio"
                                      name={q.id}
                                      value={choice}
                                      checked={responses[q.id] === choice}
                                      onChange={() =>
                                        setResponses((p) => ({
                                          ...p,
                                          [q.id]: choice,
                                        }))
                                      }
                                    />
                                    {choice}
                                  </label>
                                ))}
                              </fieldset>
                            ) : (
                              <label>
                                <span className="sr-only">
                                  Answer to question {i + 1}
                                </span>
                                {q.type === "numeric" ? (
                                  <input
                                    placeholder="Your numerical answer"
                                    inputMode="decimal"
                                    disabled={locked || Boolean(busy)}
                                    value={responses[q.id] || ""}
                                    onChange={(e) =>
                                      setResponses((p) => ({
                                        ...p,
                                        [q.id]: e.target.value,
                                      }))
                                    }
                                  />
                                ) : (
                                  <textarea
                                    placeholder="Explain your reasoning…"
                                    disabled={locked || Boolean(busy)}
                                    maxLength={4000}
                                    value={responses[q.id] || ""}
                                    onChange={(e) =>
                                      setResponses((p) => ({
                                        ...p,
                                        [q.id]: e.target.value,
                                      }))
                                    }
                                  />
                                )}
                              </label>
                            )}
                            {q.rubric.length > 0 && (
                              <p className="muted">
                                Rubric: {q.rubric.join(" · ")}
                              </p>
                            )}
                            {session.mode === "guided" && !feedback && (
                              <>
                                <details>
                                  <summary>Show a hint</summary>
                                  <p>{q.hint}</p>
                                </details>
                                <button
                                  className="primary"
                                  disabled={
                                    Boolean(busy) || !responses[q.id]?.trim()
                                  }
                                  onClick={() => void submit(false, q.id)}
                                >
                                  Check my answer
                                </button>
                              </>
                            )}
                            {feedback && (
                              <div
                                className={
                                  "feedback " +
                                  (feedback.correct === true
                                    ? "correct"
                                    : feedback.correct === false
                                      ? "incorrect"
                                      : "reflection")
                                }
                              >
                                <strong>
                                  {feedback.correct === true
                                    ? "Correct ✓"
                                    : feedback.correct === false
                                      ? "Review this one"
                                      : "Self-check reflection"}
                                </strong>
                                <p>{feedback.explanation}</p>
                                <p>
                                  <strong>Model answer:</strong>{" "}
                                  {feedback.answer}
                                </p>
                                <ol>
                                  {feedback.solution.map((s, j) => (
                                    <li key={j}>{s}</li>
                                  ))}
                                </ol>
                                <small>{feedback.grading}</small>
                                <button
                                  className="text-button"
                                  onClick={() =>
                                    void task("Reporting grading", async () => {
                                      await api("attempts/" + q.id, {
                                        method: "POST",
                                        body: "{}",
                                      });
                                      await refresh();
                                      setNotice(
                                        "Flagged. This attempt is excluded from accuracy metrics.",
                                      );
                                    })
                                  }
                                >
                                  Flag questionable grading
                                </button>
                              </div>
                            )}
                            {sourceButtons(q.sourceIds)}
                          </article>
                        );
                      })}
                      {session.mode === "mock" && !session.completed && (
                        <button
                          className="primary"
                          disabled={Boolean(busy)}
                          onClick={() => void submit(true)}
                        >
                          Submit exam & reveal solutions
                        </button>
                      )}
                      {session.completed && (
                        <section className="card">
                          <h2>Session complete.</h2>
                          <p>
                            {session.feedback.filter((f) => f.correct).length}{" "}
                            correct out of{" "}
                            {
                              session.feedback.filter((f) => f.correct !== null)
                                .length
                            }{" "}
                            graded questions.{" "}
                            {
                              session.feedback.filter((f) => f.correct === null)
                                .length
                            }{" "}
                            self-check/ungraded responses.
                          </p>
                          <button
                            className="secondary"
                            onClick={() => setTab("Progress")}
                          >
                            See progress →
                          </button>
                          <button
                            className="primary"
                            onClick={() => {
                              setSession(null);
                              void startPractice();
                            }}
                          >
                            Practice another set
                          </button>
                        </section>
                      )}
                    </>
                  )}
                </>
              )}
              {course && tab === "Progress" && (
                <>
                  <div className="page-heading">
                    <div className="eyebrow">STEP 04 / KEEP IT WITH YOU</div>
                    <h1>Progress you can explain.</h1>
                    <p>
                      Measured from your attempts, with reflections tracked
                      separately.
                    </p>
                  </div>
                  <div className="stats-grid">
                    <div className="card">
                      <small>Total attempts</small>
                      <strong>{attempts.length}</strong>
                    </div>
                    <div className="card">
                      <small>Graded accuracy</small>
                      <strong>
                        {accuracy === null ? "—" : accuracy + "%"}
                      </strong>
                    </div>
                    <div className="card">
                      <small>Topics to revisit</small>
                      <strong>
                        {topics.filter((t) => t.weak || t.due).length}
                      </strong>
                    </div>
                  </div>
                  {topics.length === 0 ? (
                    <div className="empty-state">
                      Answer a few practice questions to find your next study
                      focus.
                    </div>
                  ) : (
                    topics.map((t) => (
                      <section className="card topic-progress" key={t.topic}>
                        <div>
                          <h3>{t.topic}</h3>
                          <p>
                            {t.total} attempts ·{" "}
                            {t.scored
                              ? t.correct + "/" + t.scored + " graded correct"
                              : "Self-check only"}{" "}
                            · Last practiced {date(t.last)}
                          </p>
                          <span className="badge">
                            {t.weak
                              ? "Needs practice"
                              : t.due
                                ? "Due for review"
                                : t.scored
                                  ? "Keep practicing"
                                  : "Reflect & retry"}
                          </span>
                        </div>
                        <button
                          className="secondary"
                          onClick={() => {
                            const pattern = pack?.patterns.find(
                              (p) =>
                                p.title
                                  .toLowerCase()
                                  .includes(t.topic.toLowerCase()) ||
                                t.topic
                                  .toLowerCase()
                                  .includes(p.title.toLowerCase()),
                            );
                            setPractice((p) => ({
                              ...p,
                              topic: pattern?.title || "",
                            }));
                            setSession(null);
                            setTab("Practice");
                          }}
                        >
                          Review this topic →
                        </button>
                      </section>
                    ))
                  )}
                </>
              )}
            </>
          )}
        </div>
        <footer className="no-print">
          Built for understanding, not just memorizing. Verify uncertain content
          against your course materials.
        </footer>
      </main>
      {courseModal && (
        <div className="modal-backdrop no-print">
          <section
            className="modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="course-title"
          >
            <button
              className="modal-close"
              aria-label="Close new course"
              onClick={() => setCourseModal(false)}
            >
              ×
            </button>
            <h2 id="course-title">A fresh study space.</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void createCourse();
              }}
            >
              <label>
                Course name
                <input
                  autoFocus
                  required
                  maxLength={100}
                  placeholder="e.g., FIN 311 — Financial Principles"
                  value={newCourse.name}
                  onChange={(e) =>
                    setNewCourse((p) => ({ ...p, name: e.target.value }))
                  }
                />
              </label>
              <label>
                Subject
                <select
                  value={newCourse.subject}
                  onChange={(e) =>
                    setNewCourse((p) => ({ ...p, subject: e.target.value }))
                  }
                >
                  {[
                    "Finance",
                    "Accounting",
                    "Economics",
                    "Operations",
                    "Reading-heavy / humanities",
                    "Other",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Exam date <small>(optional)</small>
                <input
                  type="date"
                  value={newCourse.examDate}
                  onChange={(e) =>
                    setNewCourse((p) => ({ ...p, examDate: e.target.value }))
                  }
                />
              </label>
              <label>
                Exam topics <small>(optional; helps you organize)</small>
                <textarea
                  maxLength={2000}
                  value={newCourse.topics}
                  onChange={(e) =>
                    setNewCourse((p) => ({ ...p, topics: e.target.value }))
                  }
                />
              </label>
              <button className="primary" disabled={Boolean(busy)}>
                Create course
              </button>
            </form>
          </section>
        </div>
      )}
      {source && (
        <div className="modal-backdrop no-print">
          <section
            className="modal source-modal card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="source-title"
          >
            <button
              className="modal-close"
              aria-label="Close source"
              onClick={() => {
                setSource(null);
                if (sourceURL) URL.revokeObjectURL(sourceURL);
                setSourceURL("");
              }}
            >
              ×
            </button>
            <div className="eyebrow">SOURCE VIEWER</div>
            <h2 id="source-title">{source.filename}</h2>
            <span className="badge">{source.location}</span>
            <p className="source-text">
              {source.text ||
                "This section has no extracted text. Check the original."}
            </p>
            <button
              className="secondary"
              onClick={() =>
                void task("Opening original", async () => {
                  const r = await fetch(
                    `/api/materials/${source.materialId}/file`,
                    {
                      headers: token.current
                        ? { Authorization: "Bearer " + token.current }
                        : {},
                    },
                  );
                  if (!r.ok) throw new Error("Original file is unavailable.");
                  const blob = await r.blob();
                  if (sourceURL) URL.revokeObjectURL(sourceURL);
                  setSourceURL(URL.createObjectURL(blob));
                })
              }
            >
              Load original file
            </button>
            {sourceURL && (
              <>
                <a
                  className="source-link"
                  href={sourceURL}
                  download={source.filename}
                >
                  Download original
                </a>
                {source.filename.toLowerCase().endsWith(".pdf") ? (
                  <iframe
                    title="Original PDF source"
                    src={`${sourceURL}#page=${source.page}`}
                  />
                ) : /\.(png|jpg|jpeg|webp)$/i.test(source.filename) ? (
                  <Image
                    src={sourceURL}
                    alt="Original uploaded course source"
                    width={1200}
                    height={800}
                    unoptimized
                  />
                ) : (
                  <p>
                    Download the original to view it in its document
                    application.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
