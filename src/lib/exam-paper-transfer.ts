import { z } from "zod";

import {
  examOptionsSchema,
  examQuestionTypeSchema,
  maskRectsSchema,
  normalizeExamOptions,
  parseExamOptions,
  parseMaskRects,
} from "@/lib/exam";

export const examPaperTransferFormat = "brooks-pa-atlas.exam-paper";
export const examPaperTransferVersion = 1;

export const examPaperTransferQuestionSchema = z.object({
  imageHash: z.string().regex(/^[a-f0-9]{64}$/),
  imageOriginalName: z.string().min(1),
  imageTitle: z.string().nullable().optional(),
  indexPath: z.string().nullable().optional(),
  questionType: examQuestionTypeSchema.default("SINGLE"),
  prompt: z.string(),
  options: examOptionsSchema,
  correctOption: z.string().nullable(),
  explanation: z.string(),
  maskRects: maskRectsSchema,
  status: z.enum(["DRAFT", "READY"]).default("DRAFT"),
  sortOrder: z.number().int().nonnegative(),
});

export const examPaperTransferSchema = z.object({
  format: z.literal(examPaperTransferFormat),
  version: z.literal(examPaperTransferVersion),
  exportedAt: z.string(),
  paper: z.object({
    title: z.string().min(1),
    description: z.string().nullable(),
    defaultOptions: examOptionsSchema,
    sourceStatus: z.enum(["DRAFT", "PUBLISHED"]).optional(),
    questions: z.array(examPaperTransferQuestionSchema),
  }),
});

export type ExamPaperTransfer = z.infer<typeof examPaperTransferSchema>;

export function buildExamPaperTransfer(paper: {
  title: string;
  description: string | null;
  status: string;
  defaultOptionsJson: string;
  questions: Array<{
    questionType: string;
    prompt: string;
    optionsJson: string;
    correctOption: string | null;
    explanation: string;
    maskRectsJson: string;
    status: string;
    sortOrder: number;
    image: {
      hash: string;
      originalName: string;
      title: string | null;
      indexNode?: { path: string } | null;
    };
  }>;
}): ExamPaperTransfer {
  return {
    format: examPaperTransferFormat,
    version: examPaperTransferVersion,
    exportedAt: new Date().toISOString(),
    paper: {
      title: paper.title,
      description: paper.description,
      defaultOptions: normalizeExamOptions(parseExamOptions(paper.defaultOptionsJson)),
      sourceStatus: paper.status === "PUBLISHED" ? "PUBLISHED" : "DRAFT",
      questions: paper.questions.map((question) => ({
        imageHash: question.image.hash,
        imageOriginalName: question.image.originalName,
        imageTitle: question.image.title,
        indexPath: question.image.indexNode?.path ?? null,
        questionType: question.questionType === "MULTIPLE" ? "MULTIPLE" : "SINGLE",
        prompt: question.prompt,
        options: normalizeExamOptions(parseExamOptions(question.optionsJson)),
        correctOption: question.correctOption,
        explanation: question.explanation,
        maskRects: parseMaskRects(question.maskRectsJson),
        status: question.status === "READY" ? "READY" : "DRAFT",
        sortOrder: question.sortOrder,
      })),
    },
  };
}

export function parseExamPaperTransfer(value: unknown) {
  return examPaperTransferSchema.parse(value);
}
