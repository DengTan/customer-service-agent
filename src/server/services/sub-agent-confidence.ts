/**
 * Standalone confidence calculator for sub-agent responses.
 *
 * Exported from sub-agent-service.ts for direct unit testing.
 *
 * R-2: productContext / sizeChartContext → +0.07 boost (applied once when either is present).
 * R-3: degraded=true → hard cap at 0.3 regardless of other signals.
 */

function normalizeText(text: string): string {
    if (!text) return '';
    return text
        .normalize('NFC')
        .replace(/[\u200B-\u200F\uFEFF\u00AD]/g, '');
}

export function calculateSubAgentConfidence(
    childBot: { tools?: unknown[]; knowledge_ids?: string[]; delegation_prompt?: string | null },
    userMessage: string,
    responseContent: string,
    hasProductContext: boolean = false,
    hasSizeChartContext: boolean = false,
    degraded: boolean = false,
): number {
    if (degraded) {
        return 0.3;
    }

    let confidence = 0.5;

    if (Array.isArray(childBot.tools) && childBot.tools.length > 0) {
        confidence += 0.05;
    }
    if (Array.isArray(childBot.knowledge_ids) && childBot.knowledge_ids.length > 0) {
        confidence += 0.05;
    }

    // R-2: 外部 grounding（product / size-chart）仅加一次 0.07，不重复放大
    if (hasProductContext || hasSizeChartContext) {
        confidence += 0.07;
    }

    if (childBot.delegation_prompt) {
        const normalizedPrompt = normalizeText(childBot.delegation_prompt);
        const normalizedMessage = normalizeText(userMessage);
        const keywords = normalizedPrompt.split(/[，,、\s]+/).filter(w => w.length > 1);
        const matchCount = keywords.filter(kw => normalizedMessage.includes(kw)).length;
        if (matchCount > 0) {
            confidence += Math.min(matchCount * 0.03, 0.1);
        }
    }

    if (responseContent.length < 20) {
        confidence -= 0.1;
    }

    if (responseContent.includes('降级为模板回复') || responseContent.includes('LLM调用失败')) {
        confidence -= 0.2;
    }

    const hasConcreteResult = /[A-Z]{2}-\d{4,}|RF\d{6,}|运单号|退款申请编号/.test(responseContent);
    if (hasConcreteResult) {
        confidence += 0.15;
    }

    const uncertaintyPatterns = /可能|大概|或许|不太确定|建议您|不确定|估计/g;
    const uncertaintyCount = (responseContent.match(uncertaintyPatterns) || []).length;
    if (uncertaintyCount >= 2) {
        confidence -= 0.05;
    }

    const userKeywords = userMessage
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length >= 2);
    const overlapCount = userKeywords.filter(kw => responseContent.includes(kw)).length;
    if (overlapCount > 0 && userKeywords.length > 0) {
        confidence += Math.min(overlapCount / userKeywords.length * 0.1, 0.1);
    }

    return Math.min(Math.max(confidence, 0.1), 0.95);
}
