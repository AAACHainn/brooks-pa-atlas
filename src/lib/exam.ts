import { z } from "zod";

export const defaultExamOptions = ["上涨延续", "下跌延续", "震荡整理", "反转失败"];

export const maskRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.001).max(1),
  height: z.number().min(0.001).max(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#000000"),
});

export const examOptionsSchema = z
  .array(z.string().trim().min(1).max(200))
  .min(2)
  .max(8);

export const maskRectsSchema = z.array(maskRectSchema).max(20);
export const examQuestionTypeSchema = z.enum(["SINGLE", "MULTIPLE"]);

export type ExamMaskRect = z.infer<typeof maskRectSchema>;
export type ExamQuestionType = z.infer<typeof examQuestionTypeSchema>;

function parseJson<T>(value: string | null | undefined, schema: z.ZodType<T>, fallback: T) {
  if (!value) {
    return fallback;
  }

  try {
    return schema.parse(JSON.parse(value));
  } catch {
    return fallback;
  }
}

export function parseExamOptions(value: string | null | undefined) {
  return parseJson(value, examOptionsSchema, defaultExamOptions);
}

export function parseMaskRects(value: string | null | undefined) {
  return parseJson(value, maskRectsSchema, []);
}

export function normalizeExamOptions(value: unknown) {
  return examOptionsSchema.parse(value);
}

export function normalizeMaskRects(value: unknown) {
  return maskRectsSchema.parse(value);
}

export function normalizeQuestionType(value: unknown): ExamQuestionType {
  return examQuestionTypeSchema.catch("SINGLE").parse(value);
}

function uniqueOptionsInOrder(values: string[], options: string[]) {
  const selected = new Set(values.map((value) => value.trim()).filter(Boolean));
  return options.filter((option) => selected.has(option));
}

export function parseAnswerOptions(value: string | null | undefined, options: string[]) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return uniqueOptionsInOrder(
        parsed.filter((item): item is string => typeof item === "string"),
        options,
      );
    }
  } catch {
    // Legacy single-answer records are stored as plain strings.
  }

  return options.includes(value) ? [value] : [];
}

export function normalizeAnswerOptions(value: unknown, options: string[], questionType: ExamQuestionType) {
  const values = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : typeof value === "string"
      ? [value]
      : [];
  const selected = uniqueOptionsInOrder(values, options);
  return questionType === "SINGLE" ? selected.slice(0, 1) : selected;
}

export function stringifyAnswerOptions(values: string[], questionType: ExamQuestionType) {
  return questionType === "SINGLE" ? (values[0] ?? null) : JSON.stringify(values);
}

export function answersMatch(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function questionStatus(input: {
  questionType?: string | null | undefined;
  prompt: string | null | undefined;
  options: string[];
  correctOption: string | null | undefined;
  explanation: string | null | undefined;
  maskRects: ExamMaskRect[];
}) {
  const prompt = input.prompt?.trim() ?? "";
  const questionType = normalizeQuestionType(input.questionType);
  const correctOptions = parseAnswerOptions(input.correctOption, input.options);
  const correctAnswerReady =
    questionType === "MULTIPLE" ? correctOptions.length >= 2 : correctOptions.length === 1;

  return prompt &&
    input.options.length >= 2 &&
    correctAnswerReady &&
    input.maskRects.length > 0
    ? "READY"
    : "DRAFT";
}

export function shuffle<T>(items: T[]) {
  const next = [...items];

  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }

  return next;
}

export function serializeExamQuestion(question: {
  id: string;
  paperId: string;
  chartImageId: string;
  questionType: string;
  prompt: string;
  optionsJson: string;
  correctOption: string | null;
  explanation: string;
  maskRectsJson: string;
  status: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
  image?: {
    id: string;
    originalName: string;
    title: string | null;
    width: number | null;
    height: number | null;
    hash: string;
    indexNode?: { id: string; name: string; path: string } | null;
  };
}) {
  const options = parseExamOptions(question.optionsJson);
  const maskRects = parseMaskRects(question.maskRectsJson);
  const questionType = normalizeQuestionType(question.questionType);
  const correctOptions = parseAnswerOptions(question.correctOption, options);
  const status = questionStatus({
    questionType,
    prompt: question.prompt,
    options,
    correctOption: question.correctOption,
    explanation: question.explanation,
    maskRects,
  });

  return {
    id: question.id,
    paperId: question.paperId,
    chartImageId: question.chartImageId,
    questionType,
    prompt: question.prompt,
    options,
    correctOption: questionType === "SINGLE" ? (correctOptions[0] ?? null) : null,
    correctOptions,
    explanation: question.explanation,
    maskRects,
    status,
    sortOrder: question.sortOrder,
    createdAt: question.createdAt,
    updatedAt: question.updatedAt,
    image: question.image
      ? {
          id: question.image.id,
          originalName: question.image.originalName,
          title: question.image.title,
          width: question.image.width,
          height: question.image.height,
          hash: question.image.hash,
          indexNode: question.image.indexNode ?? null,
        }
      : null,
  };
}

export function serializeExamPaper(paper: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  defaultOptionsJson: string;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  questions?: Parameters<typeof serializeExamQuestion>[0][];
  _count?: { questions?: number; attempts?: number };
}) {
  return {
    id: paper.id,
    title: paper.title,
    description: paper.description,
    status: paper.status,
    defaultOptions: parseExamOptions(paper.defaultOptionsJson),
    publishedAt: paper.publishedAt,
    createdAt: paper.createdAt,
    updatedAt: paper.updatedAt,
    questionCount: paper._count?.questions ?? paper.questions?.length ?? 0,
    attemptCount: paper._count?.attempts ?? 0,
    questions: paper.questions?.map(serializeExamQuestion),
  };
}

export function serializeExamAttempt(
  attempt: {
    id: string;
    paperId: string;
    status: string;
    startedAt: Date;
    submittedAt: Date | null;
    durationSeconds: number | null;
    totalCount: number;
    correctCount: number;
    accuracy: number;
    createdAt: Date;
    updatedAt: Date;
    paper?: {
      id: string;
      title: string;
      description: string | null;
      status: string;
    };
    answers?: Array<{
      id: string;
      attemptId: string;
      questionId: string;
      order: number;
      userAnswer: string | null;
      isCorrect: boolean;
      question: Parameters<typeof serializeExamQuestion>[0];
    }>;
  },
  options: { revealAnswers?: boolean } = {},
) {
  return {
    id: attempt.id,
    paperId: attempt.paperId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    submittedAt: attempt.submittedAt,
    durationSeconds: attempt.durationSeconds,
    totalCount: attempt.totalCount,
    correctCount: attempt.correctCount,
    accuracy: attempt.accuracy,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
    paper: attempt.paper
      ? {
          id: attempt.paper.id,
          title: attempt.paper.title,
          description: attempt.paper.description,
          status: attempt.paper.status,
        }
      : null,
    answers: attempt.answers?.map((answer) => {
      const question = serializeExamQuestion(answer.question);
      const userAnswers = parseAnswerOptions(answer.userAnswer, question.options);

      return {
        id: answer.id,
        questionId: answer.questionId,
        order: answer.order,
        userAnswer: answer.userAnswer,
        userAnswers,
        isCorrect: options.revealAnswers ? answer.isCorrect : false,
        question: options.revealAnswers
          ? question
          : {
              ...question,
              correctOption: null,
              correctOptions: [],
              explanation: "",
            },
      };
    }),
  };
}
