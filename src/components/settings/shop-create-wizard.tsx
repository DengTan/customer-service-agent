'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';
import { logger } from '@/lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ShopConfig {
  shipping_policy: string;
  allow_designated_express: boolean;
  shipping_time: string;
  shipping_origin: string;
  return_policy_7days: boolean;
  handoff_timeout_hours: number;
  work_hours: { start: string; end: string };
  default_reply_ids: string[];
  handoff_reply_ids: string[];
}

export interface ShopCreateWizardProps {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export interface QuickReply {
  id: string;
  title: string;
  content: string;
  category?: string;
}

// ─── Step 1: 知识库选择 ──────────────────────────────────────────────────────

interface Step1Props {
  knowledgeIds: string[];
  setKnowledgeIds: (ids: string[]) => void;
}

function Step1Knowledge({ knowledgeIds, setKnowledgeIds }: Step1Props) {
  const [search, setSearch] = useState('');
  const [items, setItems] = useState<Array<{ id: string; title: string; category: string }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set('query', search.trim());
    fetch(`/api/knowledge/items?${params}`)
      .then(r => r.json())
      .then(json => {
        if (json.success && json.data?.items) {
          setItems(json.data.items);
        } else {
          setItems([]);
        }
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [search]);

  const toggle = (id: string) => {
    setKnowledgeIds(
      knowledgeIds.includes(id)
        ? knowledgeIds.filter(i => i !== id)
        : [...knowledgeIds, id]
    );
  };

  return (
    <div className="space-y-5 max-h-[420px] overflow-y-auto pr-1">
      <p className="text-sm text-gray-500">勾选与该店铺相关的行业知识，AI 在回复买家咨询时将优先参考已选知识。</p>

      <input
        type="text"
        placeholder="搜索知识库..."
        value={search}
        onChange={e => setSearch(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
      />

      {loading ? (
        <div className="text-center py-8 text-gray-400 text-sm">加载中...</div>
      ) : items.length === 0 ? (
        <div className="text-center py-8 text-gray-400 text-sm">
          {search ? '未找到匹配的知识库条目' : '暂无知识库条目，请先在知识库页面添加'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {items.map(item => {
            const selected = knowledgeIds.includes(item.id);
            return (
              <div
                key={item.id}
                onClick={() => toggle(item.id)}
                className={`relative p-3 border rounded-lg cursor-pointer transition-all ${
                  selected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                }`}
              >
                <div className={`absolute -top-2 -right-2 w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold ${
                  selected ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300'
                }`}>
                  {selected ? '✓' : '+'}
                </div>
                <p className="text-sm font-medium text-gray-800 pr-6 line-clamp-2">{item.title}</p>
                {item.category && (
                  <p className="text-xs text-gray-400 mt-1">{item.category}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {knowledgeIds.length > 0 && (
        <div className="text-sm text-blue-600 font-medium">
          已选择 {knowledgeIds.length} 个知识库条目
        </div>
      )}
    </div>
  );
}

// ─── Step 2: 基础配置 ────────────────────────────────────────────────────────

interface Step2Props {
  config: ShopConfig;
  setConfig: (c: ShopConfig) => void;
}

function Step2BasicConfig({ config, setConfig }: Step2Props) {
  const update = <K extends keyof ShopConfig>(key: K, value: ShopConfig[K]) =>
    setConfig({ ...config, [key]: value });

  return (
    <div className="space-y-5 max-h-[420px] overflow-y-auto pr-1">
      {/* 1. 包邮策略 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">
          <span className="text-orange-500 mr-1">*</span>包邮策略
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'all_free', label: '全场包邮' },
            { value: 'threshold_free', label: '满额包邮' },
            { value: 'no_free', label: '不包邮' },
            { value: 'remote_no_free', label: '偏远地区不包邮' },
            { value: 'by_product', label: '按商品设置' },
          ].map(opt => (
            <label
              key={opt.value}
              className={`px-3 py-1.5 border rounded-lg text-sm cursor-pointer transition-colors ${
                config.shipping_policy === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-300'
              }`}
            >
              <input
                type="radio"
                name="shipping_policy"
                value={opt.value}
                checked={config.shipping_policy === opt.value}
                onChange={() => update('shipping_policy', opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* 2. 指定快递 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">是否支持指定快递</label>
        <div className="flex gap-2">
          {[true, false].map(v => (
            <label
              key={String(v)}
              className={`px-3 py-1.5 border rounded-lg text-sm cursor-pointer transition-colors ${
                config.allow_designated_express === v
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              <input
                type="radio"
                name="express"
                value={String(v)}
                checked={config.allow_designated_express === v}
                onChange={() => update('allow_designated_express', v)}
                className="sr-only"
              />
              {v ? '是' : '否'}
            </label>
          ))}
        </div>
      </div>

      {/* 3. 发货时间 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">
          <span className="text-orange-500 mr-1">*</span>发货时间
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'same_day', label: '当日发' },
            { value: '24h', label: '24小时内' },
            { value: '48h', label: '48小时内' },
            { value: 'longer', label: '较长时间' },
          ].map(opt => (
            <label
              key={opt.value}
              className={`px-3 py-1.5 border rounded-lg text-sm cursor-pointer transition-colors ${
                config.shipping_time === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-300'
              }`}
            >
              <input
                type="radio"
                name="shipping_time"
                value={opt.value}
                checked={config.shipping_time === opt.value}
                onChange={() => update('shipping_time', opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>

      {/* 4. 发货地 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">
          <span className="text-orange-500 mr-1">*</span>发货地
        </label>
        <input
          type="text"
          value={config.shipping_origin}
          onChange={e => update('shipping_origin', e.target.value)}
          placeholder="如：浙江省杭州市"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
        />
      </div>

      {/* 5. 7天退换 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">是否支持7天无理由退换</label>
        <div className="flex gap-2">
          {[true, false].map(v => (
            <label
              key={String(v)}
              className={`px-3 py-1.5 border rounded-lg text-sm cursor-pointer transition-colors ${
                config.return_policy_7days === v
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300'
              }`}
            >
              <input
                type="radio"
                name="return"
                value={String(v)}
                checked={config.return_policy_7days === v}
                onChange={() => update('return_policy_7days', v)}
                className="sr-only"
              />
              {v ? '是' : '否'}
            </label>
          ))}
        </div>
      </div>

      {/* 6. 超时转人工 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">快递超时转人工阈值</label>
        <div className="flex flex-wrap gap-2">
          {[
            { value: 24, label: '24小时内' },
            { value: 48, label: '超过24小时' },
            { value: 72, label: '超过48小时' },
            { value: 96, label: '超过72小时' },
          ].map(opt => (
            <label
              key={opt.value}
              className={`px-3 py-1.5 border rounded-lg text-sm cursor-pointer transition-colors ${
                config.handoff_timeout_hours === opt.value
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-blue-300'
              }`}
            >
              <input
                type="radio"
                name="handoff"
                value={String(opt.value)}
                checked={config.handoff_timeout_hours === opt.value}
                onChange={() => update('handoff_timeout_hours', opt.value)}
                className="sr-only"
              />
              {opt.label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: 客服信息 ─────────────────────────────────────────────────────────

interface Step3Props {
  config: ShopConfig;
  setConfig: (c: ShopConfig) => void;
  agentAccounts: Array<{ account_name: string; password: string; platform: string }>;
  setAgentAccounts: (a: Array<{ account_name: string; password: string; platform: string }>) => void;
  quickReplies: QuickReply[];
  quota: number;
  setQuota: (q: number) => void;
  usedAgents: number;
}

function Step3AgentInfo({
  config, setConfig,
  agentAccounts, setAgentAccounts,
  quickReplies,
  quota, setQuota,
  usedAgents,
}: Step3Props) {
  const calcWorkHours = () => {
    const [sh, sm] = config.work_hours.start.split(':').map(Number);
    const [eh, em] = config.work_hours.end.split(':').map(Number);
    const mins = (eh * 60 + em) - (sh * 60 + sm);
    return mins > 0 ? `${Math.floor(mins / 60)}小时${mins % 60 > 0 ? mins % 60 + '分钟' : ''}` : '0小时';
  };

  const addAccount = () =>
    setAgentAccounts([...agentAccounts, { account_name: '', password: '', platform: 'qianniu' }]);

  const removeAccount = (i: number) =>
    setAgentAccounts(agentAccounts.filter((_, idx) => idx !== i));

  const updateAccount = (i: number, field: string, val: string) => {
    const updated = [...agentAccounts];
    updated[i] = { ...updated[i], [field]: val };
    setAgentAccounts(updated);
  };

  return (
    <div className="space-y-5 max-h-[420px] overflow-y-auto pr-1">
      {/* 坐席额度 */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-medium text-amber-800">客服坐席额度</p>
          <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded">剩余 {Math.max(0, quota - usedAgents)} 个可用</span>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            value={quota}
            onChange={e => setQuota(Math.max(0, parseInt(e.target.value) || 0))}
            className="w-24 px-3 py-1.5 border border-amber-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-100"
          />
          <span className="text-sm text-amber-600">个坐席（已用 {usedAgents} 个）</span>
        </div>
      </div>

      {/* 托管客服账号 */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium text-gray-700">托管客服账号</label>
          <button
            onClick={addAccount}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium"
          >
            + 添加账号
          </button>
        </div>

        {agentAccounts.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-3">暂未添加客服账号</p>
        ) : (
          <div className="space-y-3">
            {agentAccounts.map((acc, i) => (
              <div key={i} className="flex gap-2 items-start p-3 border border-gray-100 rounded-lg">
                <div className="flex-1 grid grid-cols-3 gap-2">
                  <input
                    type="text"
                    placeholder="账号名称"
                    value={acc.account_name}
                    onChange={e => updateAccount(i, 'account_name', e.target.value)}
                    className="px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-100"
                  />
                  <input
                    type="password"
                    placeholder="密码"
                    value={acc.password}
                    onChange={e => updateAccount(i, 'password', e.target.value)}
                    className="px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-100"
                  />
                  <select
                    value={acc.platform}
                    onChange={e => updateAccount(i, 'platform', e.target.value)}
                    className="px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-blue-100"
                  >
                    <option value="qianniu">千牛</option>
                    <option value="doudian">抖音小店</option>
                  </select>
                </div>
                <button
                  onClick={() => removeAccount(i)}
                  className="text-gray-400 hover:text-red-500 mt-1"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {agentAccounts.length > 0 && (
          <div className="flex items-start gap-1.5 p-2 bg-amber-50 border border-amber-200 rounded-lg">
            <span className="text-amber-500 mt-0.5">⚠</span>
            <p className="text-xs text-amber-700">账号创建后密码不可修改，请妥善保存</p>
          </div>
        )}
      </div>

      {/* 默认回复 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">默认回复（AI自动回复）</label>
        <select
          multiple
          value={config.default_reply_ids}
          onChange={e => {
            const selected = Array.from(e.target.selectedOptions, opt => opt.value);
            setConfig({ ...config, default_reply_ids: Array.from(e.target.selectedOptions, (opt: HTMLOptionElement) => opt.value) });
          }}
          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 min-h-[60px]"
        >
          {quickReplies
            .filter(q => !q.category || q.category !== 'agent')
            .map(q => (
              <option key={q.id} value={q.id}>{q.title}</option>
            ))}
        </select>
        <p className="text-xs text-gray-400">按住 Ctrl / Cmd 多选</p>
      </div>

      {/* 转人工回复 */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-gray-700">转人工回复（触发转人工时发送）</label>
        <select
          multiple
          value={config.handoff_reply_ids}
          onChange={e => {
            const selected = Array.from(e.target.selectedOptions, opt => opt.value);
            setConfig({ ...config, handoff_reply_ids: Array.from(e.target.selectedOptions, (opt: HTMLOptionElement) => opt.value) });
          }}
          className="w-full px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-100 min-h-[60px]"
        >
          {quickReplies
            .filter(q => !q.category || q.category !== 'ai')
            .map(q => (
              <option key={q.id} value={q.id}>{q.title}</option>
            ))}
        </select>
        <p className="text-xs text-gray-400">按住 Ctrl / Cmd 多选</p>
      </div>

      {/* 工作时间 */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">工作时间</label>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">上班</span>
            <input
              type="time"
              value={config.work_hours.start}
              onChange={e => setConfig({ ...config, work_hours: { ...config.work_hours, start: e.target.value } })}
              className="px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">下班</span>
            <input
              type="time"
              value={config.work_hours.end}
              onChange={e => setConfig({ ...config, work_hours: { ...config.work_hours, end: e.target.value } })}
              className="px-2 py-1.5 border border-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
            每日工作 {calcWorkHours()}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── 主组件 ────────────────────────────────────────────────────────────────────

export default function ShopCreateWizard({ open, onClose, onSuccess }: ShopCreateWizardProps) {
  const [step, setStep] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [shopName, setShopName] = useState('');
  const [platform, setPlatform] = useState('qianniu');
  const [knowledgeIds, setKnowledgeIds] = useState<string[]>([]);
  const [config, setConfig] = useState<ShopConfig>({
    shipping_policy: 'threshold_free',
    allow_designated_express: false,
    shipping_time: '24h',
    shipping_origin: '',
    return_policy_7days: true,
    handoff_timeout_hours: 48,
    work_hours: { start: '08:00', end: '22:00' },
    default_reply_ids: [],
    handoff_reply_ids: [],
  });
  const [agentAccounts, setAgentAccounts] = useState<Array<{ account_name: string; password: string; platform: string }>>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [quota, setQuota] = useState(0);

  useEffect(() => {
    if (open && step === 3) {
      Promise.all([
        fetch('/api/quick-replies'),
        fetch('/api/quick-replies?scope=ai'),
        fetch('/api/quick-replies?scope=agent'),
      ])
        .then(([r1, r2, r3]) => Promise.all([r1.json(), r2.json(), r3.json()]))
        .then(([all, ai, agent]) => {
          const merged: QuickReply[] = [];
          const seen = new Set<string>();
          [all, ai, agent].forEach(json => {
            if (json.success && json.data) {
              (json.data as QuickReply[]).forEach(q => {
                if (!seen.has(q.id)) {
                  seen.add(q.id);
                  merged.push(q);
                }
              });
            }
          });
          setQuickReplies(merged);
        })
        .catch((err) => logger.error('[ShopCreateWizard] Failed to fetch quick replies', { error: err }));
    }
  }, [open, step]);

  const resetForm = useCallback(() => {
    setStep(1);
    setShopName('');
    setPlatform('qianniu');
    setKnowledgeIds([]);
    setConfig({
      shipping_policy: 'threshold_free',
      allow_designated_express: false,
      shipping_time: '24h',
      shipping_origin: '',
      return_policy_7days: true,
      handoff_timeout_hours: 48,
      work_hours: { start: '08:00', end: '22:00' },
      default_reply_ids: [],
      handoff_reply_ids: [],
    });
    setAgentAccounts([]);
    setQuickReplies([]);
    setQuota(0);
    setError('');
    setSubmitting(false);
  }, []);

  const handleClose = () => {
    onClose();
    setTimeout(resetForm, 200);
  };

  const canNext = () => {
    if (step === 1) return true;
    if (step === 2) {
      return (
        config.shipping_policy.trim() !== '' &&
        config.shipping_time.trim() !== '' &&
        config.shipping_origin.trim() !== ''
      );
    }
    return true;
  };

  const handleNext = () => {
    if (!canNext()) return;
    setStep(s => Math.min(s + 1, 3));
  };

  const handleSubmit = async () => {
    // Validate at least one account has name and password
    const validAccounts = agentAccounts.filter(a => a.account_name.trim() && a.password.trim());
    if (validAccounts.length === 0) {
      setError('请至少添加一个完整的客服账号（账号名和密码必填）');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: shopName,
        platform,
        knowledge_ids: knowledgeIds,
        config,
        agent_quota: quota,
        agentAccounts: validAccounts,
      };

      const res = await fetch('/api/shops', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!json.success) {
        setError(json.error || '创建失败');
        setSubmitting(false);
        return;
      }

      resetForm();
      onSuccess();
    } catch {
      setError('网络错误，请重试');
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={handleClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-2xl bg-white rounded-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">AI 客服店铺创建引导</h2>
            <p className="text-xs text-gray-400 mt-0.5">三步完成店铺配置</p>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Progress */}
        <div className="flex items-center gap-4 px-6 py-3 bg-gray-50 border-b border-gray-100">
          {[
            { n: 1, label: '选择行业知识' },
            { n: 2, label: '店铺基础配置' },
            { n: 3, label: '客服信息' },
          ].map(({ n, label }) => (
            <React.Fragment key={n}>
              <div className="flex items-center gap-1.5">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                  step > n
                    ? 'bg-green-500 text-white'
                    : step === n
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-300'
                }`}>
                  {step > n ? '✓' : n}
                </div>
                <span className={`text-sm ${
                  step === n ? 'text-gray-900 font-medium' : 'text-gray-400'
                }`}>{label}</span>
              </div>
              {n < 3 && (
                <div className={`flex-1 h-px ${step > n ? 'bg-green-400' : 'bg-gray-200'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden px-6 py-5">
          {step === 1 && (
            <Step1Knowledge knowledgeIds={knowledgeIds} setKnowledgeIds={setKnowledgeIds} />
          )}
          {step === 2 && (
            <Step2BasicConfig config={config} setConfig={setConfig} />
          )}
          {step === 3 && (
            <Step3AgentInfo
              config={config} setConfig={setConfig}
              agentAccounts={agentAccounts} setAgentAccounts={setAgentAccounts}
              quickReplies={quickReplies}
              quota={quota} setQuota={setQuota}
              usedAgents={0}
            />
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <button
            onClick={() => step > 1 ? setStep(s => s - 1) : handleClose()}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            {step === 1 ? '取消' : '上一步'}
          </button>

          {step < 3 ? (
            <button
              onClick={handleNext}
              disabled={!canNext()}
              className="px-6 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              下一步
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="px-6 py-2 bg-blue-500 text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? '创建中...' : '创建店铺'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
