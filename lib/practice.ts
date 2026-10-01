import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { structured } from "./ai";
import { assert } from "./errors";
import {
  type Pack,
  type SecretQuestion,
  type Question,
  type PracticeSession,
  type Feedback,
  type Attempt,
} from "./types";
import { get, put, withLease, type Context } from "./server";
const dollars = (n: number) => "$" + n.toFixed(2),
  pct = (n: number) => (n * 100).toFixed(0) + "%";
export function numericQuestion(
  template: string,
  difficulty: string,
  sourceIds: string[],
): SecretQuestion {
  const N = randomInt(1, difficulty === "hard" ? 21 : 7) * 50,
    P0 = randomInt(20, 81),
    m0 = [0.4, 0.5, 0.6][randomInt(3)],
    mm = [0.25, 0.3, 0.35][randomInt(3)],
    C = N * P0 * (1 + m0);
  const base = {
    id: randomUUID(),
    topic: "",
    pattern: template,
    type: "numeric" as const,
    difficulty,
    prompt: "",
    choices: [],
    hint: "",
    sourceIds,
    rubric: [],
    answer: "",
    numericAnswer: 0,
    tolerance: 0.011,
    solution: [],
    mistakes: [],
    validation: "calculated" as const,
  };
  if (template === "short-margin") {
    const answer = C / (N * (1 + mm));
    return {
      ...base,
      topic: "Short-sale maintenance price",
      prompt: `You short ${N} shares at ${dollars(P0)} per share. Initial margin is ${pct(m0)} and maintenance margin is ${pct(mm)}. At what stock price is maintenance margin reached? Ignore interest, fees, and dividends. Answer in dollars per share, rounded to cents.`,
      hint: "Calculate total collateral, then set (collateral − N × price) / (N × price) equal to maintenance margin.",
      answer: dollars(answer),
      numericAnswer: answer,
      solution: [
        `Short proceeds = ${N} × ${dollars(P0)} = ${dollars(N * P0)}.`,
        `Initial deposit = ${pct(m0)} × ${dollars(N * P0)} = ${dollars(N * P0 * m0)}.`,
        `Collateral C = ${dollars(C)}.`,
        `Solve C − N × P = mₘ × N × P.`,
        `P = C / [N × (1 + mₘ)] = ${dollars(answer)} per share.`,
      ],
      mistakes: [
        "Use the CURRENT short liability as the denominator.",
        "Include both proceeds and initial deposit in collateral.",
      ],
    };
  }
  if (template === "short-collateral") {
    const P = Math.ceil(C / (N * (1 + mm))) + randomInt(2, 15),
      answer = Math.max(0, N * P * (1 + mm) - C);
    return {
      ...base,
      topic: "Short-sale additional collateral",
      prompt: `Short ${N} shares at ${dollars(P0)} with ${pct(m0)} initial margin. The stock is now ${dollars(P)}. How much additional cash restores ${pct(mm)} margin? Ignore interest, fees, and dividends. Answer in dollars.`,
      hint: "Required collateral = current liability × (1 + target margin). Subtract existing collateral.",
      answer: dollars(answer),
      numericAnswer: answer,
      solution: [
        `Existing collateral = ${N} × ${dollars(P0)} × (1 + ${m0}) = ${dollars(C)}.`,
        `Current liability = ${N} × ${dollars(P)} = ${dollars(N * P)}.`,
        `Required collateral = ${dollars(N * P)} × (1 + ${mm}) = ${dollars(N * P * (1 + mm))}.`,
        `Additional cash = max(0, required − existing) = ${dollars(answer)}.`,
      ],
      mistakes: ["Report additional cash, not total required collateral."],
    };
  }
  if (template === "depreciation") {
    const cost = randomInt(20, 100) * 1000,
      salvage = randomInt(1, 10) * 1000,
      life = randomInt(3, 11),
      answer = (cost - salvage) / life;
    return {
      ...base,
      topic: "Straight-line depreciation",
      prompt: `An asset costs ${dollars(cost)}, has estimated salvage value ${dollars(salvage)}, and a useful life of ${life} years. Using straight-line depreciation for a full year, calculate annual depreciation expense in dollars.`,
      hint: "Spread the depreciable base evenly over useful life.",
      answer: dollars(answer),
      numericAnswer: answer,
      solution: [
        `Depreciable base = cost − salvage = ${dollars(cost - salvage)}.`,
        `Annual expense = ${dollars(cost - salvage)} / ${life} = ${dollars(answer)}.`,
      ],
      mistakes: [
        "Subtract salvage value before dividing.",
        "This question assumes a full year and straight-line depreciation.",
      ],
    };
  }
  assert(template === "portfolio", "Unsupported numerical template.");
  const w = [0.3, 0.4, 0.5, 0.6][randomInt(4)],
    s1 = randomInt(10, 31) / 100,
    s2 = randomInt(10, 31) / 100,
    rho = [-0.5, 0, 0.3, 0.5, 0.8][randomInt(5)],
    variance =
      w * w * s1 * s1 +
      (1 - w) ** 2 * s2 * s2 +
      2 * w * (1 - w) * s1 * s2 * rho,
    answer = Math.sqrt(variance) * 100;
  return {
    ...base,
    topic: "Two-asset portfolio risk",
    prompt: `A two-asset portfolio has ${pct(w)} in asset A and ${pct(1 - w)} in B. Standard deviations are ${pct(s1)} and ${pct(s2)}; correlation is ${rho}. What is portfolio standard deviation? Answer in percentage points (e.g., enter 12.5 for 12.5%).`,
    hint: "Compute weighted variances plus the covariance term, then take the square root.",
    answer: answer.toFixed(2) + "%",
    numericAnswer: answer,
    solution: [
      `Variance = wA²σA² + wB²σB² + 2wAwBσAσBρ.`,
      `Using decimal standard deviations gives variance ${variance.toFixed(6)}.`,
      `Standard deviation = √variance = ${Math.sqrt(variance).toFixed(6)}.`,
      `Convert to percentage points: ${answer.toFixed(2)}%.`,
    ],
    mistakes: [
      "Do not average the two standard deviations.",
      "Take the square root, then convert to percent.",
    ],
  };
}
export function grade(question: SecretQuestion, response: string): Feedback {
  let correct: boolean | null = null;
  let grading =
    "Self-check reflection: this answer is not automatically graded.";
  if (question.type === "numeric") {
    const cleaned = response.trim().replace(/[$,%\s]/g, "");
    if (/^-?\d+(?:\.\d+)?$/.test(cleaned)) {
      correct =
        Math.abs(Number(cleaned) - question.numericAnswer!) <=
        question.tolerance;
      grading =
        "Calculated answer; tolerance allows rounding to cents or 0.01 percentage points.";
    } else
      grading =
        "Enter one number in the requested units; this response could not be graded.";
  }
  if (question.type === "multiple-choice") {
    correct = response === question.answer;
    grading =
      "Conceptual answer generated from source material; report it if the grading seems questionable.";
  }
  return {
    questionId: question.id,
    correct,
    score: correct === null ? null : correct ? 1 : 0,
    answer: question.answer,
    solution: question.solution,
    explanation:
      correct === true
        ? "Correct. Review the reasoning below to reinforce the method."
        : correct === false
          ? "Compare your approach with the worked solution. " +
            question.mistakes.join(" ")
          : "Compare your response with the model answer and rubric. " +
            question.rubric.join(" "),
    grading,
  };
}
const conceptualSchema = z.object({
  questions: z.array(
    z.object({
      topic: z.string(),
      type: z.enum(["multiple-choice", "written", "journal", "graph"]),
      prompt: z.string(),
      choices: z.array(z.string()),
      answer: z.string(),
      hint: z.string(),
      rubric: z.array(z.string()),
      solution: z.array(z.string()),
      mistakes: z.array(z.string()),
      sourceIds: z.array(z.string()),
    }),
  ),
});
export async function createSession(
  ctx: Context,
  pack: Pack,
  options: {
    mode: "guided" | "mock";
    count: number;
    difficulty: string;
    topic: string;
    minutes: number;
  },
) {
  const patterns = pack.patterns.filter(
    (p) => !options.topic || p.title === options.topic,
  );
  assert(patterns.length, "This study pack has no matching patterns.");
  const questions: SecretQuestion[] = [];
  const validSources = new Set(pack.sourceIds);
  for (let i = 0; i < options.count; i++) {
    const p = patterns[i % patterns.length];
    const refs = p.evidence.map((e) => e.sourceId);
    const sourceIds = refs.length
      ? refs
      : pack.concepts.flatMap((c) => c.sourceIds).slice(0, 3);
    if (p.template !== "conceptual")
      questions.push({
        ...numericQuestion(p.template, options.difficulty, sourceIds),
        pattern: p.title,
      });
  }
  const need = options.count - questions.length;
  if (need && pack.demo) {
    const c = pack.concepts[0];
    for (let i = 0; i < need; i++)
      questions.push({
        id: randomUUID(),
        topic: c.title,
        pattern: patterns[i % patterns.length].title,
        type: i % 2 ? "graph" : "written",
        difficulty: options.difficulty,
        prompt:
          i % 2
            ? "Explain how you would identify imports before and after a tariff on a supply-and-demand graph. State the axes and how each domestic quantity changes."
            : "Why can a tariff help domestic producers while reducing total national welfare in the small-country model? Distinguish transfers from deadweight loss.",
        choices: [],
        hint: "Separate price and quantity changes from transfers and efficiency losses.",
        sourceIds: c.sourceIds,
        rubric: [
          "State the small-country assumptions.",
          "Explain the domestic price increase.",
          "Identify surplus transfers.",
          "Explain production and consumption distortions.",
        ],
        answer: c.explanation,
        numericAnswer: null,
        tolerance: 0,
        solution: pack.examples[0].steps,
        mistakes: c.mistakes,
        validation: "reflection",
      });
  } else if (need) {
    const generated = await structured(
      conceptualSchema,
      "conceptual_practice",
      `Generate exactly ${need} fresh college practice questions at ${options.difficulty} difficulty. Use only supplied concepts and selected patterns; do not introduce quantitative calculations. Multiple-choice answers must exactly equal one of 4 unique choices. Written, journal and graph questions are self-check reflections with a detailed model answer and rubric, not automatic grading. All source IDs must come from the supplied concepts.`,
      JSON.stringify({ concepts: pack.concepts, patterns }),
    );
    assert(
      generated.questions.length === need,
      "The model returned the wrong question count. Retry practice generation.",
      502,
    );
    for (const q of generated.questions) {
      assert(
        q.sourceIds.length && q.sourceIds.every((id) => validSources.has(id)),
        "Invalid practice source references.",
        502,
      );
      assert(
        q.type !== "multiple-choice" ||
          (q.choices.length === 4 &&
            new Set(q.choices).size === 4 &&
            q.choices.includes(q.answer)),
        "Invalid multiple-choice answer.",
        502,
      );
      questions.push({
        ...q,
        id: randomUUID(),
        difficulty: options.difficulty,
        pattern: patterns[0].title,
        numericAnswer: null,
        tolerance: 0,
        validation: q.type === "multiple-choice" ? "conceptual" : "reflection",
      });
    }
  }
  const session: PracticeSession = {
    id: randomUUID(),
    courseId: pack.courseId,
    packId: pack.id,
    mode: options.mode,
    questions,
    responses: {},
    feedback: [],
    completed: false,
    deadline:
      options.mode === "mock" ? Date.now() + options.minutes * 60000 : null,
    createdAt: new Date().toISOString(),
  };
  await put(ctx, "session", session);
  return session;
}
export function publicSession(s: PracticeSession) {
  return {
    ...s,
    questions: s.questions.map((q) => {
      const {
        answer,
        numericAnswer,
        tolerance,
        solution,
        mistakes,
        validation,
        ...publicQ
      } = q;
      void answer;
      void numericAnswer;
      void tolerance;
      void solution;
      void mistakes;
      return { ...publicQ, validation };
    }),
    feedback: s.mode === "mock" && !s.completed ? [] : s.feedback,
  };
}
export async function submitSession(
  ctx: Context,
  id: string,
  responses: Record<string, string>,
  final: boolean,
) {
  return withLease(ctx, "session:" + id, async () => {
    const session = await get<PracticeSession>(ctx, "session", id);
    if (session.completed) return publicSession(session);
    assert(
      Object.keys(responses).every((id) =>
        session.questions.some((q) => q.id === id),
      ),
      "Unknown question.",
    );
    assert(
      Object.values(responses).every(
        (x) => typeof x === "string" && x.length <= 4000,
      ),
      "Answer is too long.",
    );
    const expired = session.deadline !== null && Date.now() > session.deadline;
    assert(
      !expired || final,
      "Time is up. Submit the exam to see your results.",
    );
    if (!expired) session.responses = { ...session.responses, ...responses };
    if (session.mode === "mock" && !final) {
      await put(ctx, "session", session);
      return publicSession(session);
    }
    const selected =
      session.mode === "mock"
        ? session.questions
        : session.questions.filter(
            (q) =>
              q.id in responses &&
              !session.feedback.some((f) => f.questionId === q.id),
          );
    for (const q of selected) {
      const feedback = grade(q, session.responses[q.id] || "");
      session.feedback.push(feedback);
      const attempt: Attempt = {
        id: q.id,
        courseId: session.courseId,
        sessionId: session.id,
        questionId: q.id,
        topic: q.topic,
        response: session.responses[q.id] || "",
        feedback,
        createdAt: new Date().toISOString(),
        reported: false,
      };
      await put(ctx, "attempt", attempt);
    }
    session.completed =
      session.mode === "mock"
        ? final
        : session.feedback.length === session.questions.length;
    await put(ctx, "session", session);
    return publicSession(session);
  });
}
