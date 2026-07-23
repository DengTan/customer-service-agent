'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { Loader2, Sparkles, RotateCcw, Database, Zap, AlertCircle } from 'lucide-react';
import { useConfirmDialog } from '@/components/common/confirm-dialog';
import { logger } from '@/lib/logger';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────

type SearchMode = 'embedding' | 'hybrid';

export interface InternalKnowledgeSettingsState {
  searchMode: SearchMode;
  vectorWeight: number;
  bm25Weight: number;
  rerankEnabled: boolean;
  rerankTopN: number;
  rerankModel: string;
  vectorTopK: number;
  bm25TopK: number;
  rrfK: number;
  minScoreThreshold: number;
  searchLimit: number;
  imageSearchLimit: number;
  imageMaxCitations: number;
}

interface InternalKnowledgeSettingsInput {
  searchMode?: SearchMode;
  vectorWeight?: number;
  bm25Weight?: number;
  rerankEnabled?: boolean;
  rerankTopN?: number;
  rerankModel?: string;
  vectorTopK?: number;
  bm25TopK?: number;
  rrfK?: number;
  minScoreThreshold?: number;
  searchLimit?: number;
  imageSearchLimit?: number;
  imageMaxCitations?: number;
}

const DEFAULT_SETTINGS: InternalKnowledgeSettingsState = {
  searchMode: 'hybrid',
  vectorWeight: 0.6,
  bm25Weight: 0.4,
  rerankEnabled: false,
  rerankTopN: 10,
  rerankModel: 'mock',
  vectorTopK: 20,
  bm25TopK: 20,
  rrfK: 60,
  minScoreThreshold: 0.75,
  searchLimit: 5,
  imageSearchLimit: 3,
  imageMaxCitations: 9,
};

const RERANK_MODEL_OPTIONS = [
  { value: 'mock', label: 'Mock (本地模拟)' },
  { value: 'bge', label: 'BGE Reranker V2 M3' },
  { value: 'cohere', label: 'Cohere Rerank' },
  { value: 'generic', label: 'Generic' },
];

export function InternalKnowledgeSettings() {
  const { confirm } = useConfirmDialog();
  const [settings, setSettings] = useState<InternalKnowledgeSettingsState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingField, setSavingField] = useState<string | null>(null);

  // Local editable state
  const [searchMode, setSearchMode] = useState<SearchMode>('hybrid');
  const [vectorWeight, setVectorWeight] = useState(0.6);
  const [bm25Weight, setBm25Weight] = useState(0.4);
  const [rerankEnabled, setRerankEnabled] = useState(false);
  const [rerankTopN, setRerankTopN] = useState(10);
  const [rerankModel, setRerankModel] = useState('mock');
  const [vectorTopK, setVectorTopK] = useState(20);
  const [bm25TopK, setBm25TopK] = useState(20);
  const [rrfK, setRrfK] = useState(60);
  const [minScoreThreshold, setMinScoreThreshold] = useState(0.75);
  const [searchLimit, setSearchLimit] = useState(5);
  const [imageSearchLimit, setImageSearchLimit] = useState(3);
  const [imageMaxCitations, setImageMaxCitations] = useState(9);

  // Load settings
  useEffect(() => {
    fetch('/api/knowledge/internal/settings')
      .then((r) => r.json())
      .then((data) => {
        setSettings(data);
        setSearchMode(data.searchMode ?? 'hybrid');
        setVectorWeight(data.vectorWeight ?? 0.6);
        setBm25Weight(data.bm25Weight ?? 0.4);
        setRerankEnabled(data.rerankEnabled ?? false);
        setRerankTopN(data.rerankTopN ?? 10);
        setRerankModel(data.rerankModel ?? 'mock');
        setVectorTopK(data.vectorTopK ?? 20);
        setBm25TopK(data.bm25TopK ?? 20);
        setRrfK(data.rrfK ?? 60);
        setMinScoreThreshold(data.minScoreThreshold ?? 0.75);
        setSearchLimit(data.searchLimit ?? 5);
        setImageSearchLimit(data.imageSearchLimit ?? 3);
        setImageMaxCitations(data.imageMaxCitations ?? 9);
      })
      .catch((err) => {
        logger.error('加载内部知识库设置失败', { error: err });
        setLoadError('加载设置失败，请重试');
        toast.error('加载设置失败');
      })
      .finally(() => setLoading(false));
  }, []);

  const applyUpdates = (updates: InternalKnowledgeSettingsInput) => {
    if (updates.searchMode !== undefined) setSearchMode(updates.searchMode);
    if (updates.vectorWeight !== undefined) setVectorWeight(updates.vectorWeight);
    if (updates.bm25Weight !== undefined) setBm25Weight(updates.bm25Weight);
    if (updates.rerankEnabled !== undefined) setRerankEnabled(updates.rerankEnabled);
    if (updates.rerankTopN !== undefined) setRerankTopN(updates.rerankTopN);
    if (updates.rerankModel !== undefined) setRerankModel(updates.rerankModel);
    if (updates.vectorTopK !== undefined) setVectorTopK(updates.vectorTopK);
    if (updates.bm25TopK !== undefined) setBm25TopK(updates.bm25TopK);
    if (updates.rrfK !== undefined) setRrfK(updates.rrfK);
    if (updates.minScoreThreshold !== undefined) setMinScoreThreshold(updates.minScoreThreshold);
    if (updates.searchLimit !== undefined) setSearchLimit(updates.searchLimit);
    if (updates.imageSearchLimit !== undefined) setImageSearchLimit(updates.imageSearchLimit);
    if (updates.imageMaxCitations !== undefined) setImageMaxCitations(updates.imageMaxCitations);
  };

  const save = async (updates: InternalKnowledgeSettingsInput, fieldName?: string) => {
    if (fieldName) setSavingField(fieldName);
    else setSaving(true);
    try {
      const res = await fetch('/api/knowledge/internal/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (data.demo) {
          toast.info('Demo 模式：设置未实际保存');
        } else {
          // Sync local state with saved values
          applyUpdates(updates);
        }
        return true;
      }
      toast.error(data.error || '保存失败');
      return false;
    } catch (err) {
      logger.error('保存内部知识库设置失败', { error: err });
      toast.error('保存失败');
      return false;
    } finally {
      if (fieldName) setSavingField(null);
      else setSaving(false);
    }
  };

  const handleRestoreDefaults = async () => {
    const confirmed = await confirm({
      title: '恢复默认',
      description: '确定要恢复内部知识库设置为默认值吗？',
      confirmText: '恢复',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    const ok = await save(DEFAULT_SETTINGS);
    if (ok) {
      setSearchMode(DEFAULT_SETTINGS.searchMode);
      setVectorWeight(DEFAULT_SETTINGS.vectorWeight);
      setBm25Weight(DEFAULT_SETTINGS.bm25Weight);
      setRerankEnabled(DEFAULT_SETTINGS.rerankEnabled);
      setRerankTopN(DEFAULT_SETTINGS.rerankTopN);
      setRerankModel(DEFAULT_SETTINGS.rerankModel);
      setVectorTopK(DEFAULT_SETTINGS.vectorTopK);
      setBm25TopK(DEFAULT_SETTINGS.bm25TopK);
      setRrfK(DEFAULT_SETTINGS.rrfK);
      setMinScoreThreshold(DEFAULT_SETTINGS.minScoreThreshold);
      setSearchLimit(DEFAULT_SETTINGS.searchLimit);
      setImageSearchLimit(DEFAULT_SETTINGS.imageSearchLimit);
      setImageMaxCitations(DEFAULT_SETTINGS.imageMaxCitations);
      toast.success('已恢复默认值');
    }
  };

  const handleSearchModeChange = async (mode: SearchMode) => {
    setSearchMode(mode);
    await save({ searchMode: mode }, 'searchMode');
  };

  const handleWeightSync = async (type: 'vector' | 'bm25', value: number) => {
    const newVector = type === 'vector' ? value : 1 - value;
    const newBm25 = type === 'bm25' ? value : 1 - value;
    setVectorWeight(newVector);
    setBm25Weight(newBm25);
    await save({ vectorWeight: newVector, bm25Weight: newBm25 }, 'weight');
  };

  const isLoaded = settings !== null;

  if (loading) {
    return (
      <section>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          正在加载内部知识库配置…
        </div>
      </section>
    );
  }

  if (loadError) {
    return (
      <section>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <div className="rounded-full bg-destructive/10 p-4">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{loadError}</p>
            <p className="text-xs text-muted-foreground mt-1">请检查网络连接后重试</p>
          </div>
          <button
            onClick={() => {
              setLoading(true);
              setLoadError(null);
              fetch('/api/knowledge/internal/settings')
                .then((r) => r.json())
                .then((data) => {
                  setSettings(data);
                  setSearchMode(data.searchMode ?? 'hybrid');
                  setVectorWeight(data.vectorWeight ?? 0.6);
                  setBm25Weight(data.bm25Weight ?? 0.4);
                  setRerankEnabled(data.rerankEnabled ?? false);
                  setRerankTopN(data.rerankTopN ?? 10);
                  setRerankModel(data.rerankModel ?? 'mock');
                  setVectorTopK(data.vectorTopK ?? 20);
                  setBm25TopK(data.bm25TopK ?? 20);
                  setRrfK(data.rrfK ?? 60);
                  setMinScoreThreshold(data.minScoreThreshold ?? 0.75);
                  setSearchLimit(data.searchLimit ?? 5);
                  setImageSearchLimit(data.imageSearchLimit ?? 3);
                  setImageMaxCitations(data.imageMaxCitations ?? 9);
                })
                .catch((err) => {
                  logger.error('重试加载内部知识库设置失败', { error: err });
                  setLoadError('加载设置失败');
                })
                .finally(() => setLoading(false));
            }}
            className="px-4 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors"
          >
            重试
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="flex items-center justify-between mb-1">
        <div>
          <h2 className="text-sm font-semibold text-foreground">内部知识库</h2>
          <p className="text-xs text-muted-foreground mt-0.5">配置 Ollama 向量检索和混合检索参数</p>
        </div>
        <button
          onClick={handleRestoreDefaults}
          className="text-xs text-primary hover:underline"
        >
          恢复默认
        </button>
      </div>

      {/* Search Mode */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex items-center gap-2 mb-4">
          <Database className="w-4 h-4 text-muted-foreground" />
          <label className="text-xs font-medium text-foreground">检索模式</label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {([
            { value: 'embedding' as SearchMode, label: '向量检索', desc: '纯语义相似度匹配', icon: '🔍' },
            { value: 'hybrid' as SearchMode, label: '混合检索', desc: '向量 + BM25 + RRF 融合', icon: '⚡' },
          ]).map((mode) => (
            <button
              key={mode.value}
              onClick={() => handleSearchModeChange(mode.value)}
              disabled={savingField === 'searchMode'}
              className={cn(
                'p-4 rounded-lg border text-left transition-all relative',
                searchMode === mode.value
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/30 hover:bg-muted/30'
              )}
            >
              {savingField === 'searchMode' && (
                <Loader2 className="absolute top-2 right-2 w-3 h-3 animate-spin text-muted-foreground" />
              )}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{mode.icon}</span>
                <span className="text-sm font-medium text-foreground">{mode.label}</span>
              </div>
              <p className="text-xs text-muted-foreground">{mode.desc}</p>
            </button>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-2">
          {searchMode === 'embedding'
            ? '基于语义理解，适合模糊问题匹配'
            : '结合向量和关键词，平衡精确度与召回率（推荐）'}
        </p>
      </div>

      {/* Hybrid Weights (only shown when hybrid mode) */}
      {searchMode === 'hybrid' && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-4 h-4 text-muted-foreground" />
            <label className="text-xs font-medium text-foreground">混合权重</label>
          </div>

          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">向量权重</label>
                <span className="text-xs font-medium text-foreground">{vectorWeight.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={vectorWeight}
                onChange={(e) => handleWeightSync('vector', parseFloat(e.target.value))}
                className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">BM25 权重</label>
                <span className="text-xs font-medium text-foreground">{bm25Weight.toFixed(2)}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={bm25Weight}
                onChange={(e) => handleWeightSync('bm25', parseFloat(e.target.value))}
                className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Rerank Settings */}
      {searchMode === 'hybrid' && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-muted-foreground" />
              <label className="text-xs font-medium text-foreground">重排序 (ReRank)</label>
            </div>
            <button
              onClick={async () => {
                setRerankEnabled(!rerankEnabled);
                await save({ rerankEnabled: !rerankEnabled }, 'rerankEnabled');
              }}
              disabled={savingField === 'rerankEnabled'}
              className={cn(
                'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                rerankEnabled ? 'bg-primary' : 'bg-muted'
              )}
            >
              {savingField === 'rerankEnabled' && (
                <Loader2 className="absolute left-1/2 -translate-x-1/2 w-3 h-3 animate-spin text-white" />
              )}
              {!savingField && (
                <span className={cn(
                  'inline-block h-4 w-4 transform rounded-full bg-white transition-transform',
                  rerankEnabled ? 'translate-x-6' : 'translate-x-1'
                )} />
              )}
            </button>
          </div>

          {rerankEnabled && (
            <div className="space-y-4 mt-4 pt-4 border-t border-border">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">重排序模型</label>
                <select
                  value={rerankModel}
                  onChange={async (e) => {
                    setRerankModel(e.target.value);
                    await save({ rerankModel: e.target.value }, 'rerankModel');
                  }}
                  className="w-full px-3 py-2 rounded-lg bg-muted border-none text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  {RERANK_MODEL_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs text-muted-foreground">重排序 Top N</label>
                  <span className="text-xs font-medium text-foreground">{rerankTopN}</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  step="1"
                  value={rerankTopN}
                  onChange={async (e) => {
                    setRerankTopN(parseInt(e.target.value));
                  }}
                  onMouseUp={async (e) => {
                    await save({ rerankTopN }, 'rerankTopN');
                  }}
                  onTouchEnd={async (e) => {
                    await save({ rerankTopN }, 'rerankTopN');
                  }}
                  className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* RRF & TopK Settings */}
      {searchMode === 'hybrid' && (
        <div className="rounded-xl border border-border bg-card p-5">
          <label className="text-xs font-medium text-foreground mb-4 block">检索参数</label>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">向量 Top K</label>
                <span className="text-xs font-medium text-foreground">{vectorTopK}</span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={vectorTopK}
                onChange={async (e) => setVectorTopK(parseInt(e.target.value))}
                onMouseUp={async () => await save({ vectorTopK }, 'vectorTopK')}
                onTouchEnd={async () => await save({ vectorTopK }, 'vectorTopK')}
                className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">BM25 Top K</label>
                <span className="text-xs font-medium text-foreground">{bm25TopK}</span>
              </div>
              <input
                type="range"
                min="5"
                max="100"
                step="5"
                value={bm25TopK}
                onChange={async (e) => setBm25TopK(parseInt(e.target.value))}
                onMouseUp={async () => await save({ bm25TopK }, 'bm25TopK')}
                onTouchEnd={async () => await save({ bm25TopK }, 'bm25TopK')}
                className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground">RRF K</label>
                <span className="text-xs font-medium text-foreground">{rrfK}</span>
              </div>
              <input
                type="range"
                min="10"
                max="120"
                step="5"
                value={rrfK}
                onChange={async (e) => setRrfK(parseInt(e.target.value))}
                onMouseUp={async () => await save({ rrfK }, 'rrfK')}
                onTouchEnd={async () => await save({ rrfK }, 'rrfK')}
                className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
              />
            </div>
          </div>
        </div>
      )}

      {/* Threshold Settings */}
      <div className="rounded-xl border border-border bg-card p-5">
        <label className="text-xs font-medium text-foreground mb-4 block">阈值与限制</label>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">最小相关度阈值</label>
              <span className="text-xs font-medium text-foreground">{minScoreThreshold.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={minScoreThreshold}
              onChange={async (e) => setMinScoreThreshold(parseFloat(e.target.value))}
              onMouseUp={async () => await save({ minScoreThreshold }, 'minScoreThreshold')}
              onTouchEnd={async () => await save({ minScoreThreshold }, 'minScoreThreshold')}
              className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
            />
            <p className="text-[10px] text-muted-foreground/70 mt-1">
              低于此分数的结果将被过滤（默认 0.75）
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">检索结果条数</label>
              <span className="text-xs font-medium text-foreground">{searchLimit}</span>
            </div>
            <input
              type="range"
              min="1"
              max="20"
              step="1"
              value={searchLimit}
              onChange={async (e) => setSearchLimit(parseInt(e.target.value))}
              onMouseUp={async () => await save({ searchLimit }, 'searchLimit')}
              onTouchEnd={async () => await save({ searchLimit }, 'searchLimit')}
              className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">图片检索条数</label>
              <span className="text-xs font-medium text-foreground">{imageSearchLimit}</span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              step="1"
              value={imageSearchLimit}
              onChange={async (e) => setImageSearchLimit(parseInt(e.target.value))}
              onMouseUp={async () => await save({ imageSearchLimit }, 'imageSearchLimit')}
              onTouchEnd={async () => await save({ imageSearchLimit }, 'imageSearchLimit')}
              className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-muted-foreground">单次回复最大图片引用数</label>
              <span className="text-xs font-medium text-foreground">{imageMaxCitations}</span>
            </div>
            <input
              type="range"
              min="0"
              max="20"
              step="1"
              value={imageMaxCitations}
              onChange={async (e) => setImageMaxCitations(parseInt(e.target.value))}
              onMouseUp={async () => await save({ imageMaxCitations }, 'imageMaxCitations')}
              onTouchEnd={async () => await save({ imageMaxCitations }, 'imageMaxCitations')}
              className="w-full h-2 rounded-full appearance-none bg-primary/20 accent-primary cursor-pointer"
            />
          </div>
        </div>
      </div>
    </section>
  );
}
