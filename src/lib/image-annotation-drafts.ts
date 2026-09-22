type AnnotationTextDraft = {
  id: string;
  text: string;
};

export function shouldDeferEmptyFocusedAnnotationSave(
  annotations: AnnotationTextDraft[],
  focusedAnnotationId: string | null,
) {
  if (!focusedAnnotationId) {
    return false;
  }

  const focusedAnnotation = annotations.find(
    (annotation) => annotation.id === focusedAnnotationId,
  );
  return Boolean(focusedAnnotation && !focusedAnnotation.text.trim());
}
