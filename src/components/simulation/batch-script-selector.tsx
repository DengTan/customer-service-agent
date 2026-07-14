'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Trash2,
  CheckCircle2,
  Layers,
  FileText,
  ChevronDown,
  ChevronRight,
  Edit3,
  Check,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { TEST_SCENARIOS, PRELOADED_SCRIPTS, type TestScenario } from '@/lib/simulation-scenarios';

export interface ScriptItem {
  id: string;
  content: string;
  source: 'scenario' | 'custom';
  scenarioId?: string;
  scenarioName?: string;
}

export interface BatchScriptSelectorProps {
  onConfirm: (scripts: string[]) => void;
  onClose: () => void;
}

const MAX_SCRIPTS = 50;
const MAX_SCRIPT_LENGTH = 10000;

export function BatchScriptSelector({ onConfirm, onClose }: BatchScriptSelectorProps) {
  const [selectedScenarioId, setSelectedScenarioId] = useState<string>('order_inquiry');
  const [customScripts, setCustomScripts] = useState<string[]>([]);
  const [newScript, setNewScript] = useState('');
  const [mode, setMode] = useState<'scenario' | 'custom'>('scenario');
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState('');

  const selectedScenario = TEST_SCENARIOS.find(s => s.id === selectedScenarioId);
  const scenarioScripts = PRELOADED_SCRIPTS[selectedScenarioId] || [];

  // Get all selected scripts based on mode
  const getSelectedScripts = (): string[] => {
    if (mode === 'scenario') {
      return scenarioScripts;
    }
    return customScripts;
  };

  const selectedScripts = getSelectedScripts();
  const totalScripts = selectedScripts.length;

  const addCustomScript = () => {
    const trimmed = newScript.trim();
    if (!trimmed) return;
    if (customScripts.length >= MAX_SCRIPTS) {
      toast.error(`最多只能添加 ${MAX_SCRIPTS} 条脚本`);
      return;
    }
    if (trimmed.length > MAX_SCRIPT_LENGTH) {
      toast.error(`脚本内容不能超过 ${MAX_SCRIPT_LENGTH} 字符`);
      return;
    }
    setCustomScripts([...customScripts, trimmed]);
    setNewScript('');
  };

  const removeCustomScript = (index: number) => {
    setCustomScripts(customScripts.filter((_, i) => i !== index));
  };

  const startEditing = (id: string, content: string) => {
    setEditingScriptId(id);
    setEditingContent(content);
  };

  const saveEditing = () => {
    if (!editingScriptId || !editingContent.trim()) return;
    if (editingContent.length > MAX_SCRIPT_LENGTH) {
      toast.error(`脚本内容不能超过 ${MAX_SCRIPT_LENGTH} 字符`);
      return;
    }
    setCustomScripts(customScripts.map((s, i) =>
      i === parseInt(editingScriptId) ? editingContent.trim() : s
    ));
    setEditingScriptId(null);
    setEditingContent('');
  };

  const cancelEditing = () => {
    setEditingScriptId(null);
    setEditingContent('');
  };

  const handleConfirm = () => {
    const scripts = getSelectedScripts();
    if (scripts.length === 0) {
      toast.error('请至少添加一条测试脚本');
      return;
    }
    onConfirm(scripts);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      addCustomScript();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 batch-panel-overlay">
      <div className="bg-background rounded-xl shadow-xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden" style={{ animation: 'panelContentIn 0.25s ease-out 0.05s both' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Layers className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">批量测试脚本</h2>
              <p className="text-sm text-muted-foreground">
                选择场景脚本或自定义编辑，共 {totalScripts} 条
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-border/50 bg-muted/20 shrink-0">
          <button
            onClick={() => setMode('scenario')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'scenario'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="w-4 h-4" />
            场景脚本
          </button>
          <button
            onClick={() => setMode('custom')}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              mode === 'custom'
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            <Edit3 className="w-4 h-4" />
            自定义脚本
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {mode === 'scenario' ? (
            /* Scenario Mode */
            <div className="flex flex-col h-full">
              {/* Scenario Selector */}
              <div className="px-6 py-3 border-b border-border/50 shrink-0">
                <div className="relative">
                  <button
                    onClick={() => setShowScenarioDropdown(!showScenarioDropdown)}
                    className="flex items-center justify-between w-full max-w-md px-4 py-2.5 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{selectedScenario?.icon}</span>
                      <span className="font-medium">{selectedScenario?.name}</span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                  </button>

                  {showScenarioDropdown && (
                    <>
                      <div
                        className="fixed inset-0 z-10"
                        onClick={() => setShowScenarioDropdown(false)}
                      />
                      <div className="absolute top-full left-0 mt-1 w-full max-w-md bg-card border border-border rounded-lg shadow-lg z-20 max-h-80 overflow-y-auto">
                        {TEST_SCENARIOS.filter(s => s.id !== 'custom').map(scenario => (
                          <button
                            key={scenario.id}
                            onClick={() => {
                              setSelectedScenarioId(scenario.id);
                              setShowScenarioDropdown(false);
                            }}
                            className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-muted/50 transition-colors ${
                              selectedScenarioId === scenario.id ? 'bg-primary/5' : ''
                            }`}
                          >
                            <span className="text-lg">{scenario.icon}</span>
                            <div className="flex-1 text-left">
                              <div className="font-medium text-sm">{scenario.name}</div>
                              <div className="text-xs text-muted-foreground">{scenario.description}</div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {PRELOADED_SCRIPTS[scenario.id]?.length || 0} 条
                            </div>
                            {selectedScenarioId === scenario.id && (
                              <Check className="w-4 h-4 text-primary" />
                            )}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Script List */}
              <div className="flex-1 overflow-y-auto p-6">
                <div className="flex items-center gap-2 mb-4">
                  <CheckCircle2 className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">预定义脚本 ({scenarioScripts.length} 条)</span>
                </div>
                <div className="space-y-2">
                  {scenarioScripts.map((script, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50"
                    >
                      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-xs font-medium text-primary">{idx + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground">{script}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* Custom Mode */
            <div className="flex flex-col h-full">
              {/* Add Script Input */}
              <div className="px-6 py-3 border-b border-border/50 shrink-0">
                <div className="flex items-center gap-2 mb-2">
                  <Plus className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">添加自定义脚本</span>
                  <span className="text-xs text-muted-foreground">
                    ({customScripts.length}/{MAX_SCRIPTS})
                  </span>
                </div>
                <div className="flex gap-2">
                  <textarea
                    value={newScript}
                    onChange={(e) => setNewScript(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入测试消息，按回车添加...（支持多行输入）"
                    rows={2}
                    className="flex-1 bg-muted rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                  <button
                    onClick={addCustomScript}
                    disabled={!newScript.trim() || customScripts.length >= MAX_SCRIPTS}
                    className="px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors self-end"
                  >
                    添加
                  </button>
                </div>
              </div>

              {/* Script List */}
              <div className="flex-1 overflow-y-auto p-6">
                {customScripts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <FileText className="w-12 h-12 text-muted-foreground/30 mb-3" />
                    <p className="text-sm text-muted-foreground">暂无自定义脚本</p>
                    <p className="text-xs text-muted-foreground/60 mt-1">
                      在上方输入框中添加测试消息
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customScripts.map((script, idx) => (
                      <div
                        key={idx}
                        className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/50 group"
                      >
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                          <span className="text-xs font-medium text-primary">{idx + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          {editingScriptId === String(idx) ? (
                            <div className="space-y-2">
                              <textarea
                                value={editingContent}
                                onChange={(e) => setEditingContent(e.target.value)}
                                rows={3}
                                className="w-full bg-card rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none border border-border"
                                autoFocus
                              />
                              <div className="flex gap-2">
                                <button
                                  onClick={saveEditing}
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
                                >
                                  <Check className="w-3 h-3" />
                                  保存
                                </button>
                                <button
                                  onClick={cancelEditing}
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-muted text-muted-foreground text-xs font-medium hover:bg-muted/80 transition-colors"
                                >
                                  取消
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm text-foreground whitespace-pre-wrap">{script}</p>
                              <div className="flex items-center gap-2 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                <button
                                  onClick={() => startEditing(String(idx), script)}
                                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                  <Edit3 className="w-3 h-3" />
                                  编辑
                                </button>
                                <button
                                  onClick={() => removeCustomScript(idx)}
                                  className="flex items-center gap-1 px-2 py-1 rounded text-xs text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
                                >
                                  <Trash2 className="w-3 h-3" />
                                  删除
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-border shrink-0 bg-card">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">{totalScripts} 条脚本</span>
            </div>
            {totalScripts > 0 && (
              <div className="text-xs text-muted-foreground">
                预计耗时: {Math.ceil(totalScripts * 2)}~{Math.ceil(totalScripts * 5)} 秒
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-muted text-muted-foreground text-sm font-medium hover:bg-muted/80 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleConfirm}
              disabled={totalScripts === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Layers className="w-4 h-4" />
              开始批量测试
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
