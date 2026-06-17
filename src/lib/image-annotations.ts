import { z } from "zod";

export const maxImageAnnotations = 100;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const imageAnnotationPayloadSchema = z.object({
  id: z.string().optional(),
  text: z.string().trim().min(1).max(500),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0.08).max(1),
  height: z.number().finite().min(0.04).max(1).optional().default(0.12),
  fontSize: z.number().int().min(10).max(48),
  color: hexColorSchema,
  backgroundColor: hexColorSchema.nullable(),
  sortOrder: z.number().int().min(0),
});

export const imageAnnotationsPayloadSchema = z
  .array(imageAnnotationPayloadSchema)
  .max(maxImageAnnotations);

export type ImageAnnotationPayload = z.infer<typeof imageAnnotationPayloadSchema>;

export type SerializableImageAnnotation = ImageAnnotationPayload & {
  id: string;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export function serializeImageAnnotation(annotation: SerializableImageAnnotation) {
  return {
    id: annotation.id,
    text: annotation.text,
    x: annotation.x,
    y: annotation.y,
    width: annotation.width,
    height: annotation.height,
    fontSize: annotation.fontSize,
    color: annotation.color,
    backgroundColor: annotation.backgroundColor,
    sortOrder: annotation.sortOrder,
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  };
}
