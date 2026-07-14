'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Star, X, Trash2, Loader2, BarChart3 } from 'lucide-react';
import { SimulationEvaluation, SimulationEvaluationStats } from '@/lib/types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface EvaluationPanelProps {
  simulationId: string;
  messageId?: string;
  onSubmit: (data: { rating: number; tags: string[]; comment: string }) => Promise<void>;
  onClose: () => void;
}

interface EvaluationWithStats {
  evaluations: SimulationEvaluation[];
  stats: SimulationEvaluationStats;
}

const PROBLEM_TAGS = [
  { key: 'reply_error', label: '回复错误' },
  { key: 'knowledge_outdated', label: '知识过时' },
  { key: 'attitude_poor', label: '态度不佳' },
  { key: 'logic_unclear', label: '逻辑不清' },
  { key: 'other', label: '其他' },
];

const RATING_LABELS = ['', '非常差', '较差', '一般', '较好', '非常好'];

export function SimulationEvaluationPanel({
  simulationId,
  messageId,
  onSubmit,
  onClose,
}: EvaluationPanelProps) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [data, setData] = useState<EvaluationWithStats | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Load existing evaluations
  useEffect(() => {
    fetchEvaluations();
  }, [simulationId]);

  const fetchEvaluations = async () => {
    try {
      const res = await fetch(`/api/simulations/${simulationId}/evaluation`);
      if (!res.ok) throw new Error('获取评价失败');
      const json = await res.json();
      setData(json);
    } catch {
      toast.error('获取评价列表失败');
    } finally {
      setIsLoading(false);
    }
  };

  const handleTagToggle = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      toast.error('请先选择评分');
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit({ rating, tags: selectedTags, comment });
      // Reset form after successful submission
      setRating(0);
      setSelectedTags([]);
      setComment('');
      setEditingId(null);
      // Refresh list
      await fetchEvaluations();
      toast.success('评价已提交');
    } catch (err) {
      toast.error(String(err) || '提交失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEdit = (evaluation: SimulationEvaluation) => {
    setEditingId(evaluation.id);
    setRating(evaluation.rating);
    setSelectedTags(evaluation.tags || []);
    setComment(evaluation.comment || '');
  };

  const handleDelete = async (evalId: string) => {
    const confirmed = await confirm({
      title: '删除评价',
      description: '确定要删除这条评价吗？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;

    try {
      const res = await fetch(`/api/simulations/${simulationId}/evaluation?evaluation_id=${evalId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('删除失败');
      toast.success('评价已删除');
      await fetchEvaluations();
    } catch {
      toast.error('删除失败');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setRating(0);
    setSelectedTags([]);
    setComment('');
  };

  return (
    <div className="w-80 border-l border-border bg-card shrink-0 flex flex-col overflow-hidden animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-foreground leading-tight">评估</span>
        </div>
        <button
          onClick={onClose}
          className="flex items-center justify-center w-8 h-8 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Stats Summary */}
        {data && data.stats.total > 0 && (
          <div className="px-4 py-3 border-b border-border bg-muted/30">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-bold text-foreground">{data.stats.average}</span>
                <div className="flex">
                  {[1, 2, 3, 4, 5].map(star => (
                    <Star
                      key={star}
                      className={`w-3.5 h-3.5 ${
                        star <= Math.round(data.stats.average)
                          ? 'text-amber-400 fill-amber-400'
                          : 'text-muted-foreground/30'
                      }`}
                    />
                  ))}
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                {data.stats.total} 条评价
              </div>
            </div>
            {/* Rating distribution */}
            <div className="mt-2 flex items-center gap-1">
              {[5, 4, 3, 2, 1].map(star => {
                const count = data.stats.distribution[star] || 0;
                const pct = data.stats.total > 0 ? (count / data.stats.total) * 100 : 0;
                return (
                  <div key={star} className="flex items-center gap-1 flex-1">
                    <span className="text-[10px] text-muted-foreground w-3">{star}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-amber-400 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className="text-[10px] text-muted-foreground w-4 text-right">{count}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Evaluation Form */}
        <div className="px-4 py-4">
          <h4 className="text-sm font-medium text-foreground mb-3">
            {editingId ? '编辑评价' : '添加评价'}
          </h4>

          {/* Rating Stars */}
          <div className="flex items-center gap-1 mb-4">
            {[1, 2, 3, 4, 5].map(star => (
              <button
                key={star}
                onClick={() => setRating(star)}
                onMouseEnter={() => setHovered(star)}
                onMouseLeave={() => setHovered(0)}
                className="p-0.5 transition-all duration-200 hover:scale-125 active:scale-95"
              >
                <Star
                  className={`w-6 h-6 transition-colors duration-200 ${
                    star <= (hovered || rating)
                      ? 'text-amber-400 fill-amber-400'
                      : 'text-muted-foreground/30'
                  }`}
                />
              </button>
            ))}
            {(hovered || rating) > 0 && (
              <span className="ml-2 text-sm text-muted-foreground">
                {RATING_LABELS[hovered || rating]}
              </span>
            )}
          </div>

          {/* Problem Tags */}
          <div className="mb-4">
            <label className="text-xs text-muted-foreground mb-2 block">问题标签（可多选）</label>
            <div className="flex flex-wrap gap-2">
              {PROBLEM_TAGS.map(tag => (
                <button
                  key={tag.key}
                  onClick={() => handleTagToggle(tag.key)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                    selectedTags.includes(tag.key)
                      ? 'bg-error/10 text-error border border-error/30'
                      : 'bg-muted text-muted-foreground hover:bg-muted/70'
                  }`}
                >
                  {tag.label}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div className="mb-4">
            <label className="text-xs text-muted-foreground mb-2 block">评价说明（可选）</label>
            <textarea
              value={comment}
              onChange={e => setComment(e.target.value)}
              placeholder="请输入您的评价说明..."
              rows={3}
              className="w-full resize-none rounded-lg bg-muted border-none px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleSubmit}
              disabled={rating === 0 || isSubmitting}
              className="flex-1 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {editingId ? '保存修改' : '提交评价'}
            </button>
            {editingId && (
              <button
                onClick={handleCancel}
                disabled={isSubmitting}
                className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:bg-muted/70 transition-all disabled:opacity-50"
              >
                取消
              </button>
            )}
          </div>
        </div>

        {/* Existing Evaluations List */}
        <div className="px-4 pb-4">
          <h4 className="text-sm font-medium text-foreground mb-3">评价历史</h4>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
            </div>
          ) : data?.evaluations && data.evaluations.length > 0 ? (
            <div className="space-y-2">
              {data.evaluations.map(evaluation => (
                <div
                  key={evaluation.id}
                  className="p-3 rounded-lg bg-card border border-border"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      {/* Stars */}
                      <div className="flex items-center gap-1 mb-1">
                        {[1, 2, 3, 4, 5].map(star => (
                          <Star
                            key={star}
                            className={`w-3.5 h-3.5 ${
                              star <= evaluation.rating
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-muted-foreground/30'
                            }`}
                          />
                        ))}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {RATING_LABELS[evaluation.rating]}
                        </span>
                      </div>
                      {/* Tags */}
                      {evaluation.tags && evaluation.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {evaluation.tags.map(tag => {
                            const tagInfo = PROBLEM_TAGS.find(t => t.key === tag);
                            return tagInfo ? (
                              <span
                                key={tag}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-error/10 text-error"
                              >
                                {tagInfo.label}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                      {/* Comment */}
                      {evaluation.comment && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {evaluation.comment}
                        </p>
                      )}
                      {/* Time */}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {new Date(evaluation.created_at).toLocaleString('zh-CN', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => handleEdit(evaluation)}
                        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                        title="编辑"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(evaluation.id)}
                        className="p-1 rounded hover:bg-error/10 text-muted-foreground hover:text-error transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-xs text-muted-foreground">
              暂无评价记录
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
