'use client';

import { Headset, PlusCircle, Clock, BookOpen } from 'lucide-react';

interface WelcomeScreenProps {
  onNew: () => void;
}

export function WelcomeScreen({ onNew }: WelcomeScreenProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full px-8">
      <div className="text-center max-w-md animate-fade-in-up">
        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <Headset className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">SmartAssist 智能客服</h1>
        <p className="text-sm text-muted-foreground mb-8">选择左侧对话开始服务，或创建新对话</p>
        <div className="grid grid-cols-3 gap-3">
          <button
            onClick={onNew}
            className="bg-card shadow-card rounded-lg p-4 hover:shadow-float hover:-translate-y-0.5 active:scale-[0.98] transition-all duration-200 text-center"
          >
            <PlusCircle className="w-6 h-6 text-primary mx-auto mb-2" />
            <span className="text-sm font-medium text-foreground block">新建对话</span>
          </button>
          <a
            href="/history"
            className="bg-card shadow-card rounded-lg p-4 hover:shadow-float hover:-translate-y-0.5 transition-all duration-200 text-center"
          >
            <Clock className="w-6 h-6 text-primary mx-auto mb-2" />
            <span className="text-sm font-medium text-foreground block">查看历史</span>
          </a>
          <a
            href="/faq"
            className="bg-card shadow-card rounded-lg p-4 hover:shadow-float hover:-translate-y-0.5 transition-all duration-200 text-center"
          >
            <BookOpen className="w-6 h-6 text-primary mx-auto mb-2" />
            <span className="text-sm font-medium text-foreground block">知识库</span>
          </a>
        </div>
      </div>
    </div>
  );
}
