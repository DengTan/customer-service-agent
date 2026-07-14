'use client';

import { useState, useCallback, useEffect } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2, ToggleLeft, ToggleRight, Edit3, X, Bot, Network, ChevronRight, ChevronDown, Check, Loader2, Users, Wrench, Settings2, Search } from 'lucide-react';
import type { MainBot, SubAgent, Shop, SkillGroup, BotSettingsPreference } from './types';
import { AVAILABLE_TOOLS as DEFAULT_TOOLS, type Tool } from './types';
import { logger } from '@/lib/logger';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface BotSettingsProps {
  shops: Shop[];
  skillGroups: SkillGroup[];
  settings?: BotSettingsPreference | null;
  onDataRefresh: () => void;
}

const safeParseJSON = <T,>(value: string, fallback: T): T => {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
};

const DEFAULT_MAX_SUB_AGENTS_PER_BOT = 10;
const DEFAULT_MAX_MAIN_BOTS = 10;

/**
 * Parse the configured cap into a positive integer. Falls back to the
 * factory default when the value is missing, non-numeric, or ≤ 0 so the UI
 * never locks the admin out because of a malformed setting.
 */
function parsePositiveInt(value: string | number | undefined | null, fallback: number): number {
  if (value === undefined || value === null || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function BotSettings({ shops, skillGroups, settings, onDataRefresh }: BotSettingsProps) {
  // Caps are dynamic settings (with safe fallback to factory default). They
  // govern the per-parent sub-agent cap and the global main-bot cap.
  // The frontend is informational; the source of truth lives in the database
  // triggers so concurrent inserts cannot bypass the limit.
  const maxMainBots = parsePositiveInt(settings?.max_main_bots, DEFAULT_MAX_MAIN_BOTS);
  const maxSubAgentsPerBot = DEFAULT_MAX_SUB_AGENTS_PER_BOT;
  const [mainBots, setMainBots] = useState<MainBot[]>([]);
  const [subAgents, setSubAgents] = useState<Record<string, SubAgent[]>>({});
  const [expandedBotId, setExpandedBotId] = useState<string | null>(null);
  const [showBotModal, setShowBotModal] = useState(false);
  const [showSubAgentModal, setShowSubAgentModal] = useState(false);
  const [editingBot, setEditingBot] = useState<MainBot | null>(null);
  const [editingSubAgent, setEditingSubAgent] = useState<{ parentBotId: string; agent: SubAgent | null }>({ parentBotId: '', agent: null });
  const [botForm, setBotForm] = useState({ name: '', description: '', system_prompt: '', platform_connection_id: '', skill_group_id: '' });
    const [subAgentForm, setSubAgentForm] = useState<{
    name: string;
    description: string;
    system_prompt: string;
    tools: string[];
    delegation_prompt: string;
    collaboration_config: {
      auto_delegate_enabled: boolean;
      auto_delegate_intents: string[];
      allow_collaborate_with: string[];
    };
  }>({
    name: '',
    description: '',
    system_prompt: '',
    tools: [],
    delegation_prompt: '',
    collaboration_config: { auto_delegate_enabled: false, auto_delegate_intents: [], allow_collaborate_with: [] },
  });
  const [customIntentInput, setCustomIntentInput] = useState('');
  const [selectedParentBotId, setSelectedParentBotId] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadingSubAgents, setLoadingSubAgents] = useState<Record<string, boolean>>({});

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  // Skill group management state
  const [showSkillGroupModal, setShowSkillGroupModal] = useState(false);
  const [editingSkillGroup, setEditingSkillGroup] = useState<SkillGroup | null>(null);
  const [skillGroupForm, setSkillGroupForm] = useState({ name: '', description: '' });
  const [skillGroupSearch, setSkillGroupSearch] = useState('');
  const [skillGroupPage, setSkillGroupPage] = useState(1);
  const [skillGroupSaving, setSkillGroupSaving] = useState(false);
  const SKILL_GROUP_PAGE_SIZE = 5;

  // Tool management state
  const [tools, setTools] = useState<Tool[]>(DEFAULT_TOOLS);
  const [showToolsModal, setShowToolsModal] = useState(false);
  const [editingTool, setEditingTool] = useState<Tool | null>(null);
  const [toolForm, setToolForm] = useState({ value: '', label: '', description: '' });
  const [toolSearch, setToolSearch] = useState('');
  const [toolPage, setToolPage] = useState(1);
  const TOOL_PAGE_SIZE = 5;

  const loadMainBots = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/sub-agents?main_bots=true');
      const data = await res.json();
      setMainBots(data.bots || []);
    } catch (err) {
      logger.error('加载Bot列表失败', { error: err });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const loadTools = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      const raw = data?.settings?.custom_tools;
      const customTools: Tool[] = raw ? safeParseJSON(raw, []) : [];
      const merged: Tool[] = [...DEFAULT_TOOLS, ...customTools];
      setTools(merged);
      setToolPage(1);
    } catch (err) {
      logger.warn('加载自定义工具失败', { error: err });
      setTools(DEFAULT_TOOLS);
    }
  }, []);

  useEffect(() => {
    loadMainBots();
    loadTools();
  }, [loadMainBots, loadTools]);

  const loadSubAgents = useCallback(async (parentBotId: string) => {
    setLoadingSubAgents(prev => ({ ...prev, [parentBotId]: true }));
    try {
      const res = await fetch(`/api/sub-agents?parent_bot_id=${parentBotId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const items = Array.isArray(data.subAgents) ? data.subAgents : [];
      setSubAgents((prev) => ({ ...prev, [parentBotId]: items }));
    } catch (err) {
      logger.error('加载子Agent失败', { error: err, parentBotId });
      toast.error('加载子Agent失败，请重试');
    } finally {
      setLoadingSubAgents(prev => ({ ...prev, [parentBotId]: false }));
    }
  }, []);

  const handleToggleBotExpand = (botId: string) => {
    if (expandedBotId === botId) {
      setExpandedBotId(null);
    } else {
      setExpandedBotId(botId);
      if (!subAgents[botId]) loadSubAgents(botId);
    }
  };

  const resetBotForm = () => {
    setBotForm({ name: '', description: '', system_prompt: '', platform_connection_id: '', skill_group_id: '' });
  };

  const closeBotModal = () => {
    setShowBotModal(false);
    setEditingBot(null);
    resetBotForm();
  };

  const handleCreateBot = async () => {
    if (!botForm.name.trim()) return;
    try {
      if (editingBot) {
        const res = await fetch('/api/bot-configs', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editingBot.id,
            name: botForm.name,
            description: botForm.description,
            system_prompt: botForm.system_prompt,
            platform_connection_id: botForm.platform_connection_id || null,
            skill_group_id: botForm.skill_group_id || null,
          }),
        });
        if (res.ok) {
          loadMainBots();
          setShowBotModal(false);
          setEditingBot(null);
          setBotForm({ name: '', description: '', system_prompt: '', platform_connection_id: '', skill_group_id: '' });
          toast.success('主Bot已更新');
        } else {
          const data = await res.json();
          toast.error(data.error || `保存失败 (${res.status})`);
        }
        return;
      }
      const res = await fetch('/api/bot-configs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: botForm.name,
          description: botForm.description,
          system_prompt: botForm.system_prompt,
          tools: [],
          knowledge_ids: [],
          skill_group_id: botForm.skill_group_id || null,
          platform_connection_id: botForm.platform_connection_id || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        loadMainBots();
        setShowBotModal(false);
        setBotForm({ name: '', description: '', system_prompt: '', platform_connection_id: '', skill_group_id: '' });
        toast.success('主Bot创建成功');
      } else {
        toast.error(data.error || '创建失败');
      }
    } catch (err) {
      logger.error('操作Bot失败', { error: err });
      toast.error('操作Bot失败');
    }
  };

  const handleDeleteBot = async (id: string) => {
    const confirmed = await confirm({
      title: '删除Bot',
      description: '确定删除此Bot？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/bot-configs?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadMainBots();
        toast.success('Bot已删除');
      }
    } catch (err) {
      logger.error('删除Bot失败', { error: err });
      toast.error('删除Bot失败');
    }
  };

  const handleCreateSubAgent = async () => {
    if (!subAgentForm.name.trim() || !selectedParentBotId) return;
    try {
      const collaborationConfig: Record<string, unknown> = subAgentForm.collaboration_config.auto_delegate_enabled
        ? {
            auto_delegate_intents: subAgentForm.collaboration_config.auto_delegate_intents,
            allow_collaborate_with: subAgentForm.collaboration_config.allow_collaborate_with,
          }
        : {};
      const res = await fetch('/api/sub-agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_bot_id: selectedParentBotId,
          name: subAgentForm.name,
          description: subAgentForm.description,
          system_prompt: subAgentForm.system_prompt,
          tools: subAgentForm.tools,
          delegation_prompt: subAgentForm.delegation_prompt || null,
          collaboration_config: collaborationConfig,
        }),
      });
      const data = await res.json();
      if (data.subAgent) {
        loadSubAgents(selectedParentBotId);
        loadMainBots();
        setShowSubAgentModal(false);
        setSubAgentForm({
          name: '', description: '', system_prompt: '', tools: [], delegation_prompt: '',
          collaboration_config: { auto_delegate_enabled: false, auto_delegate_intents: [], allow_collaborate_with: [] },
        });
        toast.success('子Agent创建成功');
      } else {
        const msg = data.error || (res.ok ? null : `创建失败 (${res.status})`);
        if (msg) toast.error(msg);
      }
    } catch (err) {
      logger.error('创建子Agent失败', { error: err });
      toast.error('创建子Agent失败');
    }
  };

  const handleUpdateSubAgent = async () => {
    if (!editingSubAgent.agent || !editingSubAgent.agent.id) return;
    try {
      const collaborationConfig: Record<string, unknown> = subAgentForm.collaboration_config.auto_delegate_enabled
        ? {
            auto_delegate_intents: subAgentForm.collaboration_config.auto_delegate_intents,
            allow_collaborate_with: subAgentForm.collaboration_config.allow_collaborate_with,
          }
        : {};
      const res = await fetch('/api/sub-agents', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingSubAgent.agent.id,
          name: subAgentForm.name,
          description: subAgentForm.description,
          system_prompt: subAgentForm.system_prompt,
          tools: subAgentForm.tools,
          delegation_prompt: subAgentForm.delegation_prompt || null,
          collaboration_config: collaborationConfig,
        }),
      });
      const data = await res.json();
      if (data.subAgent) {
        loadSubAgents(editingSubAgent.parentBotId);
        loadMainBots();
        setShowSubAgentModal(false);
        setEditingSubAgent({ parentBotId: '', agent: null });
        setSubAgentForm({
          name: '', description: '', system_prompt: '', tools: [], delegation_prompt: '',
          collaboration_config: { auto_delegate_enabled: false, auto_delegate_intents: [], allow_collaborate_with: [] },
        });
        toast.success('子Agent已更新');
      }
    } catch (err) {
      logger.error('更新子Agent失败', { error: err });
      toast.error('更新子Agent失败');
    }
  };

  const handleDeleteSubAgent = async (id: string, parentBotId: string) => {
    const confirmed = await confirm({
      title: '删除子Agent',
      description: '确定删除此子Agent？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/sub-agents?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        loadSubAgents(parentBotId);
        loadMainBots();
        toast.success('子Agent已删除');
      }
    } catch (err) {
      logger.error('删除子Agent失败', { error: err });
      toast.error('删除子Agent失败');
    }
  };

  const handleToggleSubAgentStatus = async (agent: SubAgent, parentBotId: string) => {
    try {
      const res = await fetch('/api/sub-agents', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: agent.id, status: agent.status === 'active' ? 'disabled' : 'active' }),
      });
      if (res.ok) {
        loadSubAgents(parentBotId);
      }
    } catch (err) {
      logger.error('更新子Agent状态失败', { error: err });
    }
  };

  const openEditBot = (bot: MainBot) => {
    setEditingBot(bot);
    setBotForm({
      name: bot.name,
      description: bot.description || '',
      system_prompt: bot.system_prompt || '',
      platform_connection_id: bot.platform_connection_id || '',
      skill_group_id: bot.skill_group_id || '',
    });
    setShowBotModal(true);
  };

  const openEditSubAgent = (parentBotId: string, agent: SubAgent) => {
    setEditingSubAgent({ parentBotId, agent });
    setSelectedParentBotId(parentBotId);
    const cfg = (agent.collaboration_config as Record<string, unknown> | null) || {};
    const intents = Array.isArray(cfg?.auto_delegate_intents) ? (cfg!.auto_delegate_intents as string[]) : [];
    const allowList = Array.isArray(cfg?.allow_collaborate_with) ? (cfg!.allow_collaborate_with as string[]) : [];
    setSubAgentForm({
      name: agent.name,
      description: agent.description || '',
      system_prompt: agent.system_prompt || '',
      tools: agent.tools || [],
      delegation_prompt: agent.delegation_prompt || '',
      collaboration_config: {
        auto_delegate_enabled: intents.length > 0,
        auto_delegate_intents: intents,
        allow_collaborate_with: allowList,
      },
    });
    setShowSubAgentModal(true);
  };

  const openCreateSubAgent = (botId: string) => {
    setEditingSubAgent({ parentBotId: botId, agent: null });
    setSelectedParentBotId(botId);
    setSubAgentForm({
      name: '', description: '', system_prompt: '', tools: [], delegation_prompt: '',
      collaboration_config: { auto_delegate_enabled: false, auto_delegate_intents: [], allow_collaborate_with: [] },
    });
    setShowSubAgentModal(true);
  };

  // Skill group management handlers
  const openCreateSkillGroup = () => {
    setEditingSkillGroup(null);
    setSkillGroupForm({ name: '', description: '' });
    setSkillGroupSearch('');
    setSkillGroupPage(1);
    setShowSkillGroupModal(true);
  };

  const openEditSkillGroup = (sg: SkillGroup) => {
    setEditingSkillGroup(sg);
    setSkillGroupForm({ name: sg.name, description: sg.description || '' });
    setSkillGroupSearch('');
    setSkillGroupPage(1);
    setShowSkillGroupModal(true);
  };

  const handleCreateSkillGroup = async () => {
    if (!skillGroupForm.name.trim()) return;
    setSkillGroupSaving(true);
    try {
      const res = await fetch('/api/skill-groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(skillGroupForm),
      });
      const data = await res.json();
      if (data.group) {
        toast.success('技能组创建成功');
        setEditingSkillGroup(null);
        setSkillGroupForm({ name: '', description: '' });
        setSkillGroupSearch('');
        setSkillGroupPage(1);
        onDataRefresh();
      } else {
        toast.error(data.error || '创建失败');
      }
    } catch (err) {
      logger.error('创建技能组失败', { error: err });
      toast.error('创建技能组失败');
    } finally {
      setSkillGroupSaving(false);
    }
  };

  const handleUpdateSkillGroup = async () => {
    if (!editingSkillGroup || !skillGroupForm.name.trim()) return;
    setSkillGroupSaving(true);
    try {
      const res = await fetch('/api/skill-groups', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingSkillGroup.id, ...skillGroupForm }),
      });
      const data = await res.json();
      if (data.group) {
        toast.success('技能组已更新');
        setEditingSkillGroup(null);
        setSkillGroupForm({ name: '', description: '' });
        setSkillGroupSearch('');
        setSkillGroupPage(1);
        onDataRefresh();
      } else {
        toast.error(data.error || '更新失败');
      }
    } catch (err) {
      logger.error('更新技能组失败', { error: err });
      toast.error('更新技能组失败');
    } finally {
      setSkillGroupSaving(false);
    }
  };

  const handleDeleteSkillGroup = async (id: string) => {
    const confirmed = await confirm({
      title: '删除技能组',
      description: '确定删除此技能组？',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/skill-groups?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('技能组已删除');
        setSkillGroupSearch('');
        setSkillGroupPage(1);
        onDataRefresh();
      }
    } catch (err) {
      logger.error('删除技能组失败', { error: err });
      toast.error('删除技能组失败');
    }
  };

  // Tool management handlers
  const persistTools = async (nextTools: Tool[]) => {
    const customOnly = nextTools.filter((t) => !t.builtin);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { custom_tools: JSON.stringify(customOnly) } }),
      });
      if (!res.ok) {
        toast.error('保存工具配置失败');
        return false;
      }
      setTools(nextTools);
      return true;
    } catch (err) {
      logger.error('保存工具配置失败', { error: err });
      toast.error('保存工具配置失败');
      return false;
    }
  };

  const openCreateTool = () => {
    setEditingTool(null);
    setToolForm({ value: '', label: '', description: '' });
  };

  const openEditTool = (tool: Tool) => {
    setEditingTool(tool);
    setToolForm({ value: tool.value, label: tool.label, description: tool.description });
  };

  const handleSaveTool = async () => {
    if (!toolForm.value.trim() || !toolForm.label.trim()) {
      toast.error('工具标识和名称不能为空');
      return;
    }
    const normalizedValue = toolForm.value.trim().replace(/\s+/g, '_');

    if (editingTool) {
      // Edit existing
      const next = tools.map((t) =>
        t.value === editingTool.value ? { ...t, value: normalizedValue, label: toolForm.label.trim(), description: toolForm.description.trim() } : t
      );
      const ok = await persistTools(next);
      if (ok) {
        toast.success('工具已更新');
        setToolPage(1);
      }
    } else {
      // Check duplicate
      if (tools.some((t) => t.value === normalizedValue)) {
        toast.error('工具标识已存在');
        return;
      }
      const newTool: Tool = {
        value: normalizedValue,
        label: toolForm.label.trim(),
        description: toolForm.description.trim(),
        builtin: false,
      };
      const ok = await persistTools([...tools, newTool]);
      if (ok) {
        toast.success('工具已添加');
        setToolPage(1);
      }
    }
  };

  const handleDeleteTool = async (tool: Tool) => {
    if (tool.builtin) {
      toast.error('内置工具不可删除');
      return;
    }
    const confirmed = await confirm({
      title: '删除工具',
      description: `确定删除工具「${tool.label}」吗？`,
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    const filtered = tools.filter((t) => t.value !== tool.value);
    const ok = await persistTools(filtered);
    if (ok) {
      toast.success('工具已删除');
      setToolPage(1);
    }
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-foreground">Bot与子Agent管理</h2>
        <button
          onClick={() => { setEditingBot(null); setBotForm({ name: '', description: '', system_prompt: '', platform_connection_id: '', skill_group_id: '' }); setShowBotModal(true); }}
          disabled={mainBots.length >= maxMainBots}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          title={mainBots.length >= maxMainBots ? `已达上限（${mainBots.length}/${maxMainBots}个主Bot）` : ''}
        >
          <Plus className="w-3.5 h-3.5" />
          新建主Bot
          {mainBots.length > 0 && (
            <span className="text-[10px] opacity-70">({mainBots.length}/{maxMainBots})</span>
          )}
        </button>
      </div>

      {mainBots.length >= maxMainBots && (
        <p className="text-[11px] text-amber-600/80 mb-3 px-2 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/20">
          主Bot数量已达上限（{mainBots.length}/{maxMainBots}），请删除现有主Bot后再创建新的。
        </p>
      )}

      <p className="text-xs text-muted-foreground mb-4">
        创建主Bot作为协调者，在其下添加专项子Agent（如订单处理、退款处理），主Bot会根据意图自动委派任务给子Agent。
      </p>
      <p className="text-[11px] text-muted-foreground/70 mb-4 p-2 rounded-lg bg-muted/50 border border-border">
        <span className="font-medium text-foreground/80">💡 店铺绑定说明</span><br/>
        • 主Bot可绑定店铺，绑定后该店铺的对话将使用此Bot<br/>
        • 每个店铺只能绑定一个Bot，绑定新Bot会自动解除旧绑定<br/>
        • 删除店铺后，该Bot的店铺绑定将自动解除
      </p>

      {/* Management Entries */}
      <div className="grid grid-cols-2 gap-3 mb-4">
        <button
          onClick={() => { openCreateSkillGroup(); }}
          className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0 group-hover:bg-blue-500/20 transition-colors">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">技能组管理</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600">{skillGroups.length}</span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">坐席技能分组配置</p>
          </div>
          <Settings2 className="w-4 h-4 text-muted-foreground/50" />
        </button>

        <button
          onClick={() => setShowToolsModal(true)}
          className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-muted/50 transition-colors text-left group"
        >
          <div className="w-10 h-10 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0 group-hover:bg-purple-500/20 transition-colors">
            <Wrench className="w-5 h-5 text-purple-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">工具管理</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600">{tools.length}</span>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">管理可用AI工具</p>
          </div>
          <Settings2 className="w-4 h-4 text-muted-foreground/50" />
        </button>
      </div>

      {/* Bot Tree */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-xl border border-border bg-card overflow-hidden animate-pulse">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="w-4 h-4 rounded bg-muted shrink-0" />
                <div className="w-8 h-8 rounded-lg bg-muted shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 rounded bg-muted" />
                  <div className="h-2 w-48 rounded bg-muted" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : mainBots.length === 0 ? (
        <div className="text-center py-12">
          <Network className="w-10 h-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">暂无Bot配置</p>
          <p className="text-xs text-muted-foreground/60 mt-1">创建一个主Bot开始配置子Agent</p>
        </div>
      ) : (
        <div className="space-y-2">
          {mainBots.map((bot) => (
            <div key={bot.id} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Main Bot Header */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => handleToggleBotExpand(bot.id)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleToggleBotExpand(bot.id); }}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors text-left cursor-pointer"
              >
                {expandedBotId === bot.id ? (
                  <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                )}
                <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{bot.name}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">主Bot</span>
                    {bot.sub_agent_count != null && bot.sub_agent_count > 0 && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{bot.sub_agent_count} 个子Agent</span>
                    )}
                    {bot.platform_connection_id && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600">
                        {shops.find(s => s.id === bot.platform_connection_id)?.name || '已绑定店铺'}
                      </span>
                    )}
                  </div>
                  {bot.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{bot.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); openEditBot(bot); }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="编辑"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDeleteBot(bot.id); }}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                    title="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Sub-Agents */}
              {expandedBotId === bot.id && (
                <div className="border-t border-border">
                  {loadingSubAgents[bot.id] ? (
                    <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span className="text-xs">加载子Agent...</span>
                    </div>
                  ) : subAgents[bot.id] && subAgents[bot.id].length > 0 ? (
                    <div className="divide-y divide-border">
                      {subAgents[bot.id].map((agent) => (
                        <div key={agent.id} className="flex items-center gap-3 px-4 py-2.5 pl-12">
                          <div className="w-6 h-6 rounded bg-emerald-500/10 flex items-center justify-center shrink-0">
                            <Network className="w-3 h-3 text-emerald-600" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm text-foreground">{agent.name}</span>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${agent.status === 'active' ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground'}`}>
                                {agent.status === 'active' ? '启用' : '停用'}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground truncate">{agent.description || '无描述'}</p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => handleToggleSubAgentStatus(agent, bot.id)}
                              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                              title={agent.status === 'active' ? '停用' : '启用'}
                            >
                              {agent.status === 'active' ? <ToggleRight className="w-4 h-4 text-success" /> : <ToggleLeft className="w-4 h-4" />}
                            </button>
                            <button
                              onClick={() => openEditSubAgent(bot.id, agent)}
                              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            >
                              <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleDeleteSubAgent(agent.id, bot.id)}
                              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center">
                      <p className="text-xs text-muted-foreground">暂无子Agent</p>
                    </div>
                  )}
                  <div className="px-4 py-2.5 border-t border-border bg-muted/30">
                    <button
                      onClick={() => openCreateSubAgent(bot.id)}
                      disabled={bot.sub_agent_count != null && bot.sub_agent_count >= maxSubAgentsPerBot}
                      className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      title={bot.sub_agent_count != null && bot.sub_agent_count >= maxSubAgentsPerBot ? `已达上限（${bot.sub_agent_count}/${maxSubAgentsPerBot}个子Agent）` : ''}
                    >
                      <Plus className="w-3 h-3" />
                      添加子Agent
                      {bot.sub_agent_count != null && (
                        <span className="text-[10px] text-muted-foreground">({bot.sub_agent_count}/{maxSubAgentsPerBot})</span>
                      )}
                    </button>
                    {bot.sub_agent_count != null && bot.sub_agent_count >= maxSubAgentsPerBot && (
                      <p className="text-[10px] text-muted-foreground/60 mt-1">该主Bot已达最大子Agent数量限制（{maxSubAgentsPerBot}个）</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bot Create/Edit Modal */}
      {showBotModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-float w-[520px] max-h-[80vh] overflow-y-auto popup-enter">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-medium text-foreground">{editingBot ? '编辑主Bot' : '新建主Bot'}</h3>
              <button onClick={closeBotModal} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Bot名称</label>
                <input type="text" value={botForm.name} onChange={(e) => setBotForm({ ...botForm, name: e.target.value })} placeholder="如：电商主客服" className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">描述</label>
                <input type="text" value={botForm.description} onChange={(e) => setBotForm({ ...botForm, description: e.target.value })} placeholder="如：处理所有电商客服场景" className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">绑定店铺</label>
                <select
                  value={botForm.platform_connection_id}
                  onChange={(e) => setBotForm({ ...botForm, platform_connection_id: e.target.value })}
                  className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">不绑定（全局Bot）</option>
                  {shops.filter(s => s.status === 'active').map((shop) => (
                    <option key={shop.id} value={shop.id}>{shop.name}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground/60 mt-1">绑定后，该店铺的对话将优先使用此Bot</p>
                <p className="text-[10px] text-amber-600/70 mt-0.5">注意：每个店铺只能绑定一个Bot，绑定新Bot会自动解除旧绑定</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">关联技能组</label>
                <select
                  value={botForm.skill_group_id}
                  onChange={(e) => setBotForm({ ...botForm, skill_group_id: e.target.value })}
                  className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <option value="">不关联（无技能组）</option>
                  {skillGroups.map((sg) => (
                    <option key={sg.id} value={sg.id}>{sg.name}{sg.description ? ` - ${sg.description}` : ''}</option>
                  ))}
                </select>
                <p className="text-[10px] text-muted-foreground/60 mt-1">关联技能组后，对话可转接到此Bot指定的技能组坐席</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">系统提示词</label>
                <textarea value={botForm.system_prompt} onChange={(e) => setBotForm({ ...botForm, system_prompt: e.target.value })} placeholder="定义Bot的角色和行为..." rows={4} className="w-full bg-muted border-none rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border">
              <button onClick={closeBotModal} className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">取消</button>
              <button onClick={handleCreateBot} disabled={!botForm.name.trim()} className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {editingBot ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sub-Agent Create/Edit Modal */}
      {showSubAgentModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-float w-[520px] max-h-[85vh] overflow-hidden flex flex-col popup-enter">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Bot className="w-3.5 h-3.5 text-primary" />
                </div>
                <h3 className="text-sm font-medium text-foreground">
                  {editingSubAgent.agent ? '编辑子Agent' : '新建子Agent'}
                </h3>
              </div>
              <button onClick={() => setShowSubAgentModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto flex-1 space-y-5">
              {/* Basic Info Section */}
              <div className="space-y-3">
                <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">1</span>
                  基础信息
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                    子Agent名称 <span className="text-destructive">*</span>
                  </label>
                  <input type="text" value={subAgentForm.name} onChange={(e) => setSubAgentForm({ ...subAgentForm, name: e.target.value })} placeholder="如：订单处理专家" className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors" />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">描述</label>
                  <input type="text" value={subAgentForm.description} onChange={(e) => setSubAgentForm({ ...subAgentForm, description: e.target.value })} placeholder="如：专注订单查询、修改地址、取消订单" className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors" />
                </div>
                <p className="text-[10px] text-muted-foreground/60 -mt-1">
                  💡 子Agent隶属于主Bot，由主Bot自动委派任务，不能直接绑定店铺
                </p>
              </div>

              {/* Config Section */}
              <div className="space-y-3">
                <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">2</span>
                  配置信息
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">系统提示词</label>
                  <textarea value={subAgentForm.system_prompt} onChange={(e) => setSubAgentForm({ ...subAgentForm, system_prompt: e.target.value })} placeholder="定义子Agent的角色和专业领域..." rows={3} className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-colors" />
                </div>
              </div>

              {/* Tools Section */}
              <div className="space-y-3">
                <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">3</span>
                  可用工具
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {tools.map((tool) => (
                    <button
                      key={tool.value}
                      type="button"
                      onClick={() => {
                        if (subAgentForm.tools.includes(tool.value)) {
                          setSubAgentForm({ ...subAgentForm, tools: subAgentForm.tools.filter((t) => t !== tool.value) });
                        } else {
                          setSubAgentForm({ ...subAgentForm, tools: [...subAgentForm.tools, tool.value] });
                        }
                      }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-left transition-all ${
                        subAgentForm.tools.includes(tool.value)
                          ? 'bg-primary/10 border-primary/30 text-primary'
                          : 'bg-muted/50 hover:bg-muted text-foreground'
                      }`}
                    >
                      <div className={`w-4 h-4 rounded border border-border flex items-center justify-center shrink-0 ${
                          subAgentForm.tools.includes(tool.value) ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                        }`}>
                        {subAgentForm.tools.includes(tool.value) && (
                          <Check className="w-2.5 h-2.5 text-primary-foreground" />
                        )}
                      </div>
                      <span className="text-sm">{tool.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Advanced Config Section */}
              <div className="space-y-3">
                <div className="text-xs font-medium text-foreground/70 uppercase tracking-wider flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded bg-primary/10 flex items-center justify-center text-primary text-[10px]">4</span>
                  高级配置
                  <span className="text-[10px] text-muted-foreground/50 font-normal normal-case ml-1">(可选)</span>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1.5 block">委派提示词</label>
                  <textarea value={subAgentForm.delegation_prompt} onChange={(e) => setSubAgentForm({ ...subAgentForm, delegation_prompt: e.target.value })} placeholder="描述什么情况下应该委派给此Agent..." rows={2} className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-colors" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs text-muted-foreground">协作设置</label>
                    <button
                      type="button"
                      onClick={() => setSubAgentForm({
                        ...subAgentForm,
                        collaboration_config: { auto_delegate_enabled: false, auto_delegate_intents: [], allow_collaborate_with: [] },
                      })}
                      className="text-[10px] text-primary hover:text-primary/80 transition-colors"
                    >
                      恢复默认
                    </button>
                  </div>

                  {/* Auto Delegate Toggle */}
                  <div className="p-3 rounded-lg border border-border bg-card space-y-2.5">
                    <label className="flex items-start gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={subAgentForm.collaboration_config.auto_delegate_enabled}
                        onChange={(e) => setSubAgentForm({
                          ...subAgentForm,
                          collaboration_config: {
                            ...subAgentForm.collaboration_config,
                            auto_delegate_enabled: e.target.checked,
                            auto_delegate_intents: e.target.checked && subAgentForm.collaboration_config.auto_delegate_intents.length === 0
                              ? ['order_query']
                              : subAgentForm.collaboration_config.auto_delegate_intents,
                          },
                        })}
                        className="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-2 focus:ring-primary/20 shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-foreground">启用自动委派</div>
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5 leading-relaxed">
                          开启后，主Bot识别到匹配的意图时会自动委派给此子Agent处理
                        </div>
                      </div>
                    </label>

                    {subAgentForm.collaboration_config.auto_delegate_enabled && (
                      <div className="pl-6 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                          {['order_query', 'logistics_query', 'refund_action', 'product_query', 'size_recommend'].map((preset) => {
                            const intents = subAgentForm.collaboration_config.auto_delegate_intents;
                            const active = intents.includes(preset);
                            return (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => setSubAgentForm({
                                  ...subAgentForm,
                                  collaboration_config: {
                                    ...subAgentForm.collaboration_config,
                                    auto_delegate_intents: active
                                      ? intents.filter((t) => t !== preset)
                                      : [...intents, preset],
                                  },
                                })}
                                className={`px-2 py-1 rounded text-[10px] border transition-colors ${
                                  active
                                    ? 'bg-primary/10 border-primary/30 text-primary'
                                    : 'bg-muted/50 border-border text-muted-foreground hover:bg-muted'
                                }`}
                              >
                                {preset}
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={customIntentInput}
                            onChange={(e) => setCustomIntentInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && customIntentInput.trim()) {
                                e.preventDefault();
                                const trimmed = customIntentInput.trim();
                                if (!subAgentForm.collaboration_config.auto_delegate_intents.includes(trimmed)) {
                                  setSubAgentForm({
                                    ...subAgentForm,
                                    collaboration_config: {
                                      ...subAgentForm.collaboration_config,
                                      auto_delegate_intents: [...subAgentForm.collaboration_config.auto_delegate_intents, trimmed],
                                    },
                                  });
                                }
                                setCustomIntentInput('');
                              }
                            }}
                            placeholder="自定义意图关键词，回车添加"
                            className="flex-1 bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors font-mono"
                          />
                        </div>
                        {subAgentForm.collaboration_config.auto_delegate_intents.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 pt-1">
                            {subAgentForm.collaboration_config.auto_delegate_intents.map((intent) => {
                              const isPreset = ['order_query', 'logistics_query', 'refund_action', 'product_query', 'size_recommend'].includes(intent);
                              return (
                                <span key={intent} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-primary/10 text-primary text-[10px]">
                                  {intent}
                                  <button
                                    type="button"
                                    onClick={() => setSubAgentForm({
                                      ...subAgentForm,
                                      collaboration_config: {
                                        ...subAgentForm.collaboration_config,
                                        auto_delegate_intents: subAgentForm.collaboration_config.auto_delegate_intents.filter((t) => t !== intent),
                                      },
                                    })}
                                    className="hover:text-primary/60 transition-colors"
                                  >
                                    ×
                                  </button>
                                </span>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Allow Collaborate With */}
                  <div className="mt-2.5 p-3 rounded-lg border border-border bg-card space-y-2">
                    <div className="text-xs font-medium text-foreground mb-1">允许协作的子Agent</div>
                    <div className="text-[10px] text-muted-foreground/70 mb-2 leading-relaxed">
                      勾选同主Bot下其他子Agent，授权当前Agent与它们协作通信
                    </div>
                    {(() => {
                      const peers = subAgents[selectedParentBotId] || [];
                      const currentAgentId = editingSubAgent.agent?.id;
                      const allowList = subAgentForm.collaboration_config.allow_collaborate_with;
                      const selectable = peers.filter((p) => p.id !== currentAgentId);
                      if (selectable.length === 0) {
                        return <p className="text-[10px] text-muted-foreground/50 italic">当前主Bot下暂无其他子Agent</p>;
                      }
                      return (
                        <div className="space-y-1.5 max-h-32 overflow-y-auto">
                          {selectable.map((peer) => {
                            const checked = allowList.includes(peer.name);
                            return (
                              <label key={peer.id} className="flex items-center gap-2 p-1.5 rounded hover:bg-muted/50 cursor-pointer transition-colors">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => setSubAgentForm({
                                    ...subAgentForm,
                                    collaboration_config: {
                                      ...subAgentForm.collaboration_config,
                                      allow_collaborate_with: checked
                                        ? allowList.filter((n) => n !== peer.name)
                                        : [...allowList, peer.name],
                                    },
                                  })}
                                  className="w-3.5 h-3.5 rounded border-border text-primary focus:ring-2 focus:ring-primary/20"
                                />
                                <span className="text-xs text-foreground truncate">{peer.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0 bg-muted/30">
              <button onClick={() => setShowSubAgentModal(false)} className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">取消</button>
              <button onClick={editingSubAgent.agent ? handleUpdateSubAgent : handleCreateSubAgent} disabled={!subAgentForm.name.trim()} className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {editingSubAgent.agent ? '保存' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Skill Group Management Modal */}
      {showSkillGroupModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-float w-[640px] max-h-[80vh] overflow-hidden flex flex-col popup-enter">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <h3 className="text-sm font-medium text-foreground">技能组管理</h3>
              </div>
              <button onClick={() => setShowSkillGroupModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <p className="text-xs text-muted-foreground mb-4">
                管理坐席技能组，支持创建、编辑和删除技能组。每个坐席可归属于一个或多个技能组，便于按业务类型分配对话。
              </p>

              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={skillGroupSearch}
                  onChange={(e) => { setSkillGroupSearch(e.target.value); setSkillGroupPage(1); }}
                  placeholder="搜索技能组名称..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-muted border border-transparent focus:border-primary/30 rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                />
              </div>

              {/* Skill Group List */}
              <div className="space-y-2 mb-4">
                {(() => {
                  const filtered = skillGroups.filter(sg =>
                    sg.name.toLowerCase().includes(skillGroupSearch.toLowerCase())
                  );
                  const totalPages = Math.max(1, Math.ceil(filtered.length / SKILL_GROUP_PAGE_SIZE));
                  const paginated = filtered.slice((skillGroupPage - 1) * SKILL_GROUP_PAGE_SIZE, skillGroupPage * SKILL_GROUP_PAGE_SIZE);

                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-8 border border-dashed border-border rounded-lg">
                        <Users className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">
                          {skillGroupSearch ? '未找到匹配的技能组' : '暂无技能组'}
                        </p>
                        {!skillGroupSearch && (
                          <p className="text-[10px] text-muted-foreground/60 mt-0.5">点击下方按钮创建一个</p>
                        )}
                      </div>
                    );
                  }

                  return (
                    <>
                      {paginated.map((sg) => (
                        <div key={sg.id} className="p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                              <Users className="w-4 h-4 text-blue-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-foreground">{sg.name}</span>
                                {sg.is_default && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-600">默认</span>
                                )}
                              </div>
                              {sg.description && (
                                <p className="text-[11px] text-muted-foreground mt-1">{sg.description}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                onClick={() => openEditSkillGroup(sg)}
                                className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                                title="编辑"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              {!sg.is_default && (
                                <button
                                  onClick={() => handleDeleteSkillGroup(sg.id)}
                                  className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                                  title="删除"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </>
                  );
                })()}
              </div>

              {/* Pagination */}
              {(() => {
                const filtered = skillGroups.filter(sg =>
                  sg.name.toLowerCase().includes(skillGroupSearch.toLowerCase())
                );
                const totalPages = Math.max(1, Math.ceil(filtered.length / SKILL_GROUP_PAGE_SIZE));
                if (filtered.length <= SKILL_GROUP_PAGE_SIZE) return null;
                return (
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs text-muted-foreground">
                      共 {filtered.length} 个技能组
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setSkillGroupPage(p => Math.max(1, p - 1))}
                        disabled={skillGroupPage === 1}
                        className="px-2 py-1 rounded text-xs border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        上一页
                      </button>
                      <span className="px-2 text-xs text-muted-foreground">
                        {skillGroupPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setSkillGroupPage(p => Math.min(totalPages, p + 1))}
                        disabled={skillGroupPage === totalPages}
                        className="px-2 py-1 rounded text-xs border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Create/Edit Form */}
              <div className="border-t border-border pt-4">
                <h4 className="text-xs font-medium text-foreground/70 mb-3">
                  {editingSkillGroup ? '编辑技能组' : '新建技能组'}
                </h4>
                <div className="space-y-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                      技能组名称 <span className="text-destructive">*</span>
                    </label>
                    <input
                      type="text"
                      value={skillGroupForm.name}
                      onChange={(e) => setSkillGroupForm({ ...skillGroupForm, name: e.target.value })}
                      placeholder="如：售后组"
                      className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">描述</label>
                    <input
                      type="text"
                      value={skillGroupForm.description}
                      onChange={(e) => setSkillGroupForm({ ...skillGroupForm, description: e.target.value })}
                      placeholder="如：处理退货、换货、维修等售后问题"
                      className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <button
                      onClick={() => { setShowSkillGroupModal(false); setSkillGroupSearch(''); setSkillGroupPage(1); }}
                      className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={editingSkillGroup ? handleUpdateSkillGroup : handleCreateSkillGroup}
                      disabled={!skillGroupForm.name.trim() || skillGroupSaving}
                      className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {skillGroupSaving ? '保存中...' : (editingSkillGroup ? '保存' : '创建')}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tools Management Modal */}
      {showToolsModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-card rounded-lg shadow-float w-[640px] max-h-[80vh] overflow-hidden flex flex-col popup-enter">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                  <Wrench className="w-4 h-4 text-purple-600" />
                </div>
                <h3 className="text-sm font-medium text-foreground">工具管理</h3>
              </div>
              <button onClick={() => setShowToolsModal(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              <p className="text-xs text-muted-foreground mb-4">
                管理子Agent可用的AI工具。内置工具不可删除，可编辑描述说明；自定义工具支持增删改。
              </p>

              {/* Search */}
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  value={toolSearch}
                  onChange={(e) => { setToolSearch(e.target.value); setToolPage(1); }}
                  placeholder="搜索工具名称或标识..."
                  className="w-full pl-9 pr-4 py-2 text-sm bg-muted border border-transparent focus:border-primary/30 rounded-lg placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                />
              </div>

              {/* Tool List */}
              <div className="space-y-2 mb-4">
                {(() => {
                  const filtered = tools.filter(t =>
                    t.label.toLowerCase().includes(toolSearch.toLowerCase()) ||
                    t.value.toLowerCase().includes(toolSearch.toLowerCase())
                  );
                  const totalPages = Math.max(1, Math.ceil(filtered.length / TOOL_PAGE_SIZE));
                  const paginated = filtered.slice((toolPage - 1) * TOOL_PAGE_SIZE, toolPage * TOOL_PAGE_SIZE);

                  if (filtered.length === 0) {
                    return (
                      <div className="text-center py-8 border border-dashed border-border rounded-lg">
                        <Wrench className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                        <p className="text-xs text-muted-foreground">暂无工具</p>
                      </div>
                    );
                  }

                  return (
                    <>
                      {paginated.map((tool) => (
                    <div key={tool.value} className="p-3 rounded-lg border border-border bg-card hover:bg-muted/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                          <Wrench className="w-4 h-4 text-purple-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{tool.label}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-600">{tool.value}</span>
                            {tool.builtin ? (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">内置</span>
                            ) : (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600">自定义</span>
                            )}
                          </div>
                          {tool.description && (
                            <p className="text-[11px] text-muted-foreground mt-1">{tool.description}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            onClick={() => openEditTool(tool)}
                            className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                            title="编辑"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          {!tool.builtin && (
                            <button
                              onClick={() => handleDeleteTool(tool)}
                              className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-destructive"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                      ))}
                    </>
                  );
                })()}
              </div>

              {/* Pagination */}
              {(() => {
                const filtered = tools.filter(t =>
                  t.label.toLowerCase().includes(toolSearch.toLowerCase()) ||
                  t.value.toLowerCase().includes(toolSearch.toLowerCase())
                );
                const totalPages = Math.max(1, Math.ceil(filtered.length / TOOL_PAGE_SIZE));
                if (filtered.length <= TOOL_PAGE_SIZE) return null;
                return (
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-xs text-muted-foreground">
                      共 {filtered.length} 个工具
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setToolPage(p => Math.max(1, p - 1))}
                        disabled={toolPage === 1}
                        className="px-2 py-1 rounded text-xs border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        上一页
                      </button>
                      <span className="px-2 text-xs text-muted-foreground">
                        {toolPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setToolPage(p => Math.min(totalPages, p + 1))}
                        disabled={toolPage === totalPages}
                        className="px-2 py-1 rounded text-xs border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                );
              })()}

              {/* Add/Edit Form */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-xs font-medium text-foreground/70">
                    {editingTool ? '编辑工具' : '添加工具'}
                  </h4>
                  <button
                    onClick={() => { setEditingTool(null); setToolForm({ value: '', label: '', description: '' }); }}
                    className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    新建工具
                  </button>
                </div>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                        工具标识 <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={toolForm.value}
                        onChange={(e) => setToolForm({ ...toolForm, value: e.target.value })}
                        placeholder="如：query_product_detail"
                        disabled={editingTool?.builtin}
                        className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors disabled:opacity-60 font-mono"
                      />
                      <p className="text-[10px] text-muted-foreground/60 mt-1">英文/下划线，用于系统标识</p>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                        显示名称 <span className="text-destructive">*</span>
                      </label>
                      <input
                        type="text"
                        value={toolForm.label}
                        onChange={(e) => setToolForm({ ...toolForm, label: e.target.value })}
                        placeholder="如：查询商品详情"
                        className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 transition-colors"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block">功能描述</label>
                    <textarea
                      value={toolForm.description}
                      onChange={(e) => setToolForm({ ...toolForm, description: e.target.value })}
                      placeholder="简要说明此工具的用途，帮助AI理解何时调用"
                      rows={2}
                      className="w-full bg-muted border border-transparent focus:border-primary/30 rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none transition-colors"
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-1">
                    <button
                      onClick={() => { setEditingTool(null); setToolForm({ value: '', label: '', description: '' }); }}
                      className="px-4 py-1.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleSaveTool}
                      disabled={!toolForm.value.trim() || !toolForm.label.trim()}
                      className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {editingTool ? '保存' : '添加'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
