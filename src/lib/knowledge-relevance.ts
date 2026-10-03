// RRF is a relative ordering, not a relevance score. Reject distant semantic
// neighbors before fusion; an otherwise empty library search must stay empty.
export const MAX_KNOWLEDGE_VECTOR_DISTANCE = 0.35;

export function isRelevantKnowledgeVector(distance: number) {
  return Number.isFinite(distance) && distance >= 0 && distance <= MAX_KNOWLEDGE_VECTOR_DISTANCE;
}

// Image-only requests carry no subject for a whole-library search. Keep explicit
// subjects/lesson codes, but remove generic task words and references to the page.
export function knowledgeSubjectQuery(question: string) {
  const subject = question.normalize("NFKC")
    .replace(/(?:当前|这(?:张|幅|个|一)?|本|此|该)(?:图片|图表|图像|课程|课件|章节|页面|页|图)|图中|图上|图片中|图片上/gu, " ")
    .replace(/文字内容|主要内容|主要讲|主要说|讲的|讲了|说的|说了|是什么|什么是|为什么|怎么|如何|怎样|什么|哪些|请问|请|帮我|为我|给我|讲一下|讲讲|逐字|详细|完整|全部|翻译|讲解|解释|介绍|说明|总结|概括|归纳|比较|对比|分析|内容|文字|中文|英文|英语|汉语/gu, " ")
    .replace(/\b(?:please|translate|explain|describe|summari[sz]e|compare|analy[sz]e|current|this|these|that|those|image|images|picture|chart|page|slide|lesson|course|chapter|text|content|what|why|how|which|does|do|is|are|the|a|an|of|in|on|to|me|for|about|mainly|say|says|show|shows|tell|can|could|you|english|chinese)\b/giu, " ");
  // Isolated Chinese particles and punctuation should not become embedding queries.
  return (subject.match(/[\p{Script=Han}]{2,}|[A-Za-z0-9]{2,}|\b\d{1,3}\b/gu) ?? [])
    .filter((token) => !/^[的了吗呢啊吧是在上中里有着]+$/u.test(token)).join(" ").trim();
}
