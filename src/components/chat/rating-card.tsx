'use client';

import { useState } from 'react';
import { Star } from 'lucide-react';

interface RatingCardProps {
  onSubmit: (rating: number, comment: string) => void;
}

export function RatingCard({ onSubmit }: RatingCardProps) {
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const [comment, setComment] = useState('');

  const ratingLabels = ['', '非常不满意', '不满意', '一般', '满意', '非常满意'];

  const handleSubmit = () => {
    if (rating === 0) return;
    onSubmit(rating, comment);
  };

  return (
    <div className="max-w-md mx-auto mt-4 p-5 rounded-xl border border-border bg-card animate-fade-in-up">
      <h4 className="text-sm font-semibold text-foreground mb-3">请对本次服务进行评价</h4>
      <div className="flex items-center gap-1 mb-2">
        {[1, 2, 3, 4, 5].map((star) => (
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
            {ratingLabels[hovered || rating]}
          </span>
        )}
      </div>
      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder="请输入您的建议（可选）"
        rows={2}
        className="w-full resize-none rounded-lg bg-muted border-none px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 mb-3"
      />
      <button
        onClick={handleSubmit}
        disabled={rating === 0}
        className="w-full py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        提交评价
      </button>
    </div>
  );
}
