import { z } from "zod";
export const materialKinds = [
  "lecture slides",
  "notes",
  "homework",
  "practice exam",
  "review sheet",
  "other",
] as const;
export type MaterialKind = (typeof materialKinds)[number];
export type Source = {
  id: string;
  materialId: string;
  filename: string;
  location: string;
  page: number;
  text: string;
};
export type Material = {
  id: string;
  courseId: string;
  filename: string;
  kind: MaterialKind;
  hash: string;
  sources: Source[];
  warnings: string[];
  mime: string;
  sample?: "finance" | "reading";
  createdAt: string;
};
export type Course = {
  id: string;
  name: string;
  subject: string;
  examDate: string;
  topics: string;
  createdAt: string;
};
const strings = z.array(z.string());
export const conceptSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  intuition: z.string(),
  prerequisites: strings,
  assumptions: strings,
  formulas: z.array(
    z.object({
      expression: z.string(),
      variables: z.string(),
      when: z.string(),
    }),
  ),
  mistakes: strings,
  sourceIds: strings,
});
export const exampleSchema = z.object({
  title: z.string(),
  problem: z.string(),
  steps: strings,
  interpretation: z.string(),
  sourceIds: strings,
});
export const patternSchema = z.object({
  title: z.string(),
  skills: strings,
  steps: strings,
  traps: strings,
  evidence: z.array(z.object({ sourceId: z.string(), question: z.string() })),
  suggested: z.boolean(),
  template: z.enum([
    "short-margin",
    "short-collateral",
    "depreciation",
    "portfolio",
    "conceptual",
  ]),
});
export const packContentSchema = z.object({
  overview: z.string(),
  concepts: z.array(conceptSchema),
  examples: z.array(exampleSchema),
  quickReview: strings,
  patterns: z.array(patternSchema),
  warnings: strings,
});
export type PackContent = z.infer<typeof packContentSchema>;
export type Pattern = z.infer<typeof patternSchema>;
export type Pack = PackContent & {
  id: string;
  courseId: string;
  materialIds: string[];
  sourceIds: string[];
  demo: boolean;
  createdAt: string;
};
export type Job = {
  id: string;
  courseId: string;
  materialIds: string[];
  status: "queued" | "running" | "failed" | "complete";
  step: number;
  total: number;
  chunks: Source[][];
  parts: PackContent[];
  error: string;
  leaseUntil: number;
  packId?: string;
  createdAt: string;
};
export type Question = {
  id: string;
  topic: string;
  pattern: string;
  type: "numeric" | "multiple-choice" | "written" | "journal" | "graph";
  difficulty: string;
  prompt: string;
  choices: string[];
  hint: string;
  sourceIds: string[];
  rubric: string[];
};
export type SecretQuestion = Question & {
  answer: string;
  numericAnswer: number | null;
  tolerance: number;
  solution: string[];
  mistakes: string[];
  validation: "calculated" | "conceptual" | "reflection";
};
export type Feedback = {
  questionId: string;
  correct: boolean | null;
  score: number | null;
  answer: string;
  solution: string[];
  explanation: string;
  grading: string;
};
export type PracticeSession = {
  id: string;
  courseId: string;
  packId: string;
  mode: "guided" | "mock";
  questions: SecretQuestion[];
  responses: Record<string, string>;
  feedback: Feedback[];
  completed: boolean;
  deadline: number | null;
  createdAt: string;
};
export type Attempt = {
  id: string;
  courseId: string;
  sessionId: string;
  questionId: string;
  topic: string;
  response: string;
  feedback: Feedback;
  createdAt: string;
  reported: boolean;
};
export type RecordKind =
  "course" | "material" | "pack" | "job" | "session" | "attempt";
