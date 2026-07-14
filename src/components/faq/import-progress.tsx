'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { X, CheckCircle, AlertCircle, FileText, ChevronDown, ChevronUp } from 'lucide-react';

interface ChunkPreview {
  index: number;
  content: string;
  content_hash: string;
}

interface ImportJobStatus {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: number;
  currentStage: string;
  chunkPreview: ChunkPreview[] | null;
  totalChunks: number;
  rawTextPreview: string | null;
  errorMessage: string | null;
  knowledgeItemId: string | null;
  createdAt: string;
}

interface ImportProgressProps {
  jobId: string;
  onComplete?: (knowledgeItemId: string) => void;
  onClose?: () => void;
}

const stageLabels: Record<string, string> = {
  uploading: '上传文件',
  parsing: '解析文档',
  chunking: '切分文本',
  vectorizing: '发送向量化',
  syncing: '同步状态',
  completed: '已完成',
  failed: '失败',
};

const stageOrder = ['uploading', 'parsing', 'chunking', 'vectorizing', 'syncing', 'completed'];

export function ImportProgress({ jobId, onComplete, onClose }: ImportProgressProps) {
  const [job, setJob] = useState<ImportJobStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllChunks, setShowAllChunks] = useState(false);
  const pollingRef = useRef(false); // 防止并发轮询

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/knowledge/import-jobs/${jobId}`);
      const data = await res.json();

      // 支持 apiSuccess 格式: { success: true, ...jobData }
      // 和旧格式: { code: 0, data: { ...jobData } }
      let jobData: ImportJobStatus | null = null;

      if (data.success && !data.code) {
        // apiSuccess format: job data is spread at root level
        jobData = data as unknown as ImportJobStatus;
      } else if (data.code === 0 && data.data) {
        // Old format: { code: 0, data: { ...jobData } }
        jobData = data.data;
      } else {
        throw new Error(data.message || data.error || '获取任务状态失败');
      }

      setJob(jobData);
      setError(null);

      // 如果完成或有错误，停止轮询
      if (jobData && (jobData.status === 'completed' || jobData.status === 'failed')) {
        if (jobData.status === 'completed' && jobData.knowledgeItemId && onComplete) {
          onComplete(jobData.knowledgeItemId);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取任务状态失败');
    }
  }, [jobId, onComplete]);

  useEffect(() => {
    fetchStatus();

    // 轮询状态（每秒一次）
    const interval = setInterval(async () => {
      // 使用 ref 来跟踪是否已完成，避免闭包问题
      if (!pollingRef.current) {
        pollingRef.current = true;
        await fetchStatus();
        pollingRef.current = false;
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [fetchStatus]);

  const getCurrentStageIndex = () => {
    if (!job?.currentStage) return -1;
    return stageOrder.indexOf(job.currentStage);
  };

  const isStageComplete = (stage: string) => {
    const stageIdx = stageOrder.indexOf(stage);
    const currentIdx = getCurrentStageIndex();
    return stageIdx < currentIdx;
  };

  const isStageCurrent = (stage: string) => {
    return job?.currentStage === stage;
  };

  if (error) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
          <div className="flex items-center gap-3 text-destructive mb-4">
            <AlertCircle className="h-5 w-5" />
            <h3 className="font-semibold">导入失败</h3>
          </div>
          <p className="text-muted-foreground mb-4">{error}</p>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
            >
              关闭
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-background rounded-lg shadow-lg p-6 w-full max-w-md mx-4">
          <div className="flex items-center gap-3 mb-4">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-primary border-t-transparent" />
            <h3 className="font-semibold">加载中...</h3>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-2xl mx-4 max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div className="flex items-center gap-3">
            <FileText className="h-5 w-5 text-primary" />
            <h3 className="font-semibold">导入进度</h3>
          </div>
          {job.status === 'completed' || job.status === 'failed' ? (
            <button onClick={onClose} className="p-1 hover:bg-secondary rounded">
              <X className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {/* Progress Bar */}
          <div className="mb-6">
            <div className="flex justify-between text-sm mb-2">
              <span className="font-medium">{job.progress}%</span>
              <span className="text-muted-foreground">{stageLabels[job.currentStage] || '处理中'}</span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          </div>

          {/* Stages */}
          <div className="space-y-3 mb-6">
            {stageOrder.slice(0, -1).map((stage) => {
              const complete = isStageComplete(stage);
              const current = isStageCurrent(stage);
              
              return (
                <div key={stage} className="flex items-center gap-3">
                  {complete ? (
                    <CheckCircle className="h-5 w-5 text-green-500 shrink-0" />
                  ) : current ? (
                    <div className="h-5 w-5 rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/30 shrink-0" />
                  )}
                  <span className={`text-sm ${complete ? 'text-foreground' : current ? 'text-primary font-medium' : 'text-muted-foreground'}`}>
                    {stageLabels[stage]}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Chunk Preview */}
          {job.status === 'processing' && job.chunkPreview && job.chunkPreview.length > 0 && (
            <div className="border rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-sm">
                  切分预览 {job.totalChunks > 0 && `（共 ${job.totalChunks} 个片段）`}
                </h4>
              </div>
              
              <div className="space-y-3">
                {showAllChunks
                  ? job.chunkPreview.map((chunk) => (
                      <div key={chunk.index} className="bg-muted/50 rounded p-3">
                        <div className="text-xs text-muted-foreground mb-1">Chunk #{chunk.index + 1}</div>
                        <p className="text-sm line-clamp-3">{chunk.content}</p>
                      </div>
                    ))
                  : job.chunkPreview.slice(0, 3).map((chunk) => (
                      <div key={chunk.index} className="bg-muted/50 rounded p-3">
                        <div className="text-xs text-muted-foreground mb-1">Chunk #{chunk.index + 1}</div>
                        <p className="text-sm line-clamp-3">{chunk.content}</p>
                      </div>
                    ))}
              </div>

              {job.chunkPreview.length > 3 && (
                <button
                  onClick={() => setShowAllChunks(!showAllChunks)}
                  className="mt-3 flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  {showAllChunks ? (
                    <>
                      <ChevronUp className="h-4 w-4" /> 收起
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4" /> 查看全部 {job.chunkPreview.length} 个片段
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Success State */}
          {job.status === 'completed' && (
            <div className="text-center py-4">
              <CheckCircle className="h-12 w-12 text-green-500 mx-auto mb-3" />
              <p className="font-medium mb-1">导入完成！</p>
              {job.totalChunks > 0 && (
                <p className="text-sm text-muted-foreground mb-4">
                  已切分为 {job.totalChunks} 个片段并成功向量化
                </p>
              )}
            </div>
          )}

          {/* Error State */}
          {job.status === 'failed' && (
            <div className="text-center py-4">
              <AlertCircle className="h-12 w-12 text-destructive mx-auto mb-3" />
              <p className="font-medium mb-1 text-destructive">导入失败</p>
              <p className="text-sm text-muted-foreground">{job.errorMessage || '未知错误'}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-muted/30">
          {job.status === 'completed' ? (
            <button
              onClick={onClose}
              className="w-full py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
            >
              完成并返回知识库
            </button>
          ) : job.status === 'failed' ? (
            <button
              onClick={onClose}
              className="w-full py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
            >
              关闭
            </button>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              正在处理中，请稍候...
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
