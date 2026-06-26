'use client';

import { useState, useEffect, useCallback } from 'react';
import { Users, RefreshCw, Trash2, Plus, Check, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { FRONTEND } from '@/lib/constants';

// ============================================
// Types
// ============================================

type AssignmentStrategy = 'round_robin' | 'load_balance' | 'designated_shop';

interface ShopBinding {
  id: string;
  shop_id: string;
  user_id: string;
  priority: number;
  is_enabled: boolean;
  shop_name?: string;
  user_name?: string;
  user_email?: string;
}

interface AgentStatus {
  user_id: string;
  name: string;
  email: string;
  status: 'online' | 'away' | 'offline' | 'disconnected';
  current_conversations: number;
  today_completed: number;
  today_assigned: number;
  last_active_at: string | null;
}

interface AgentSummary {
  total: number;
  online: number;
  away: number;
  offline: number;
  disconnected: number;
}

interface Shop {
  id: string;
  name: string;
}

interface User {
  id: string;
  name: string;
  email: string;
  role?: string;
}

// ============================================
// Component
// ============================================

export function AgentAssignmentSettings() {
  // State
  const [currentStrategy, setCurrentStrategy] = useState<AssignmentStrategy>('round_robin');
  const [isSaving, setIsSaving] = useState(false);
  const [bindings, setBindings] = useState<ShopBinding[]>([]);
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [summary, setSummary] = useState<AgentSummary>({ total: 0, online: 0, away: 0, offline: 0, disconnected: 0 });
  const [shops, setShops] = useState<Shop[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // Loading states
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [savingBinding, setSavingBinding] = useState(false);

  // Binding modal state
  const [showBindingModal, setShowBindingModal] = useState(false);
  const [bindingShopId, setBindingShopId] = useState('');
  const [bindingUserId, setBindingUserId] = useState('');
  const [bindingPriority, setBindingPriority] = useState(0);

  // Polling interval for agents status
  const POLL_INTERVAL = FRONTEND.AGENT_STATUS_POLL_MS;

  // ============================================
  // Data Fetching
  // ============================================

  const fetchCurrentStrategy = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-assignment/current-strategy');
      if (res.ok) {
        const data = await res.json();
        if (data.strategy) {
          setCurrentStrategy(data.strategy);
        }
      }
    } catch (error) {
      console.error('Failed to fetch current strategy:', error);
    }
  }, []);

  const fetchBindings = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-assignment/shop-bindings');
      if (res.ok) {
        const data = await res.json();
        setBindings(data.bindings || []);
      }
    } catch (error) {
      console.error('Failed to fetch bindings:', error);
    }
  }, []);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-assignment/agents');
      if (res.ok) {
        const data = await res.json();
        setAgents(data.agents || []);
        setSummary(data.summary || { total: 0, online: 0, away: 0, offline: 0, disconnected: 0 });
      }
    } catch (error) {
      console.error('Failed to fetch agents:', error);
    }
  }, []);

  const fetchShops = useCallback(async () => {
    try {
      const res = await fetch('/api/shops');
      if (res.ok) {
        const data = await res.json();
        setShops(data.shops || []);
      }
    } catch (error) {
      console.error('Failed to fetch shops:', error);
    }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        setUsers((data.users || []).filter((u: User) => u.role === 'agent' || u.role === 'admin'));
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    await Promise.all([fetchCurrentStrategy(), fetchBindings(), fetchAgents(), fetchShops(), fetchUsers()]);
    setIsLoading(false);
  }, [fetchCurrentStrategy, fetchBindings, fetchAgents, fetchShops, fetchUsers]);

  // Initial load
  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Polling for agents
  useEffect(() => {
    const interval = setInterval(fetchAgents, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  // ============================================
  // Handlers
  // ============================================

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchAgents();
    setIsRefreshing(false);
  };

  const handleStrategyChange = async (strategy: AssignmentStrategy) => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/agent-assignment/current-strategy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ strategy }),
      });

      if (res.ok) {
        setCurrentStrategy(strategy);
      } else {
        toast.error('保存失败');
      }
    } catch (error) {
      console.error('Failed to save strategy:', error);
      toast.error('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  const openBindingModal = () => {
    setBindingShopId('');
    setBindingUserId('');
    setBindingPriority(0);
    setShowBindingModal(true);
  };

  const closeBindingModal = () => {
    setShowBindingModal(false);
  };

  const handleSaveBinding = async () => {
    if (!bindingShopId || !bindingUserId) {
      toast.error('请选择店铺和坐席');
      return;
    }

    setSavingBinding(true);
    try {
      const res = await fetch('/api/agent-assignment/shop-bindings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          shop_id: bindingShopId,
          user_id: bindingUserId,
          priority: bindingPriority,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || '保存失败');
        return;
      }

      await fetchBindings();
      closeBindingModal();
    } catch (error) {
      console.error('Failed to save binding:', error);
      toast.error('保存失败');
    } finally {
      setSavingBinding(false);
    }
  };

  const handleDeleteBinding = async (id: string) => {
    if (!confirm('确定要删除这个绑定吗？')) return;
    try {
      const res = await fetch(`/api/agent-assignment/shop-bindings?id=${id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || '删除失败');
        return;
      }
      await fetchBindings();
    } catch (error) {
      console.error('Failed to delete binding:', error);
      toast.error('删除失败');
    }
  };

  // ============================================
  // Render Helpers
  // ============================================

  const getStatusColor = (status: AgentStatus['status']) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'away': return 'text-yellow-500';
      case 'offline': return 'text-red-500';
      case 'disconnected': return 'text-gray-400';
    }
  };

  const getStatusBadge = (status: AgentStatus['status']) => {
    const colors = {
      online: 'bg-green-100 text-green-800',
      away: 'bg-yellow-100 text-yellow-800',
      offline: 'bg-red-100 text-red-800',
      disconnected: 'bg-gray-100 text-gray-500',
    };
    const labels = {
      online: '在线',
      away: '暂离',
      offline: '离线',
      disconnected: '未连接',
    };
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status]}`}>
        {labels[status]}
      </span>
    );
  };

  const getStrategyLabel = (strategy: AssignmentStrategy) => {
    switch (strategy) {
      case 'round_robin': return '轮询分配';
      case 'load_balance': return '负载均衡';
      case 'designated_shop': return '指定店铺';
    }
  };

  const getStrategyDesc = (strategy: AssignmentStrategy) => {
    switch (strategy) {
      case 'round_robin': return '在可用坐席间轮流分配，保证公平性';
      case 'load_balance': return '优先分配给当前会话数最少的坐席';
      case 'designated_shop': return '将会话分配给绑定的专属客服坐席';
    }
  };

  const getStrategyIcon = (strategy: AssignmentStrategy) => {
    switch (strategy) {
      case 'round_robin':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        );
      case 'load_balance':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
          </svg>
        );
      case 'designated_shop':
        return (
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
        );
    }
  };

  // ============================================
  // Render
  // ============================================

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  const strategies: AssignmentStrategy[] = ['round_robin', 'load_balance', 'designated_shop'];

  return (
    <div className="space-y-6">
      {/* Strategy Configuration - Direct Selection */}
      <section>
        <h3 className="text-lg font-medium mb-4">分配策略</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {strategies.map(strategy => (
            <button
              key={strategy}
              onClick={() => handleStrategyChange(strategy)}
              disabled={isSaving}
              className={`relative p-4 border-2 rounded-lg text-left transition-all ${
                currentStrategy === strategy
                  ? 'border-primary bg-primary/5'
                  : 'border-border hover:border-primary/50'
              } ${isSaving ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
            >
              {currentStrategy === strategy && (
                <div className="absolute top-2 right-2">
                  <div className="w-6 h-6 bg-primary rounded-full flex items-center justify-center">
                    <Check className="w-4 h-4 text-primary-foreground" />
                  </div>
                </div>
              )}
              
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${
                currentStrategy === strategy ? 'bg-primary text-primary-foreground' : 'bg-muted'
              }`}>
                {getStrategyIcon(strategy)}
              </div>
              
              <div className="font-medium mb-1">{getStrategyLabel(strategy)}</div>
              <div className="text-sm text-muted-foreground">{getStrategyDesc(strategy)}</div>
            </button>
          ))}
        </div>
      </section>

      {/* Shop Bindings (for designated_shop strategy) */}
      {currentStrategy === 'designated_shop' && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-medium">店铺-坐席绑定</h3>
            <button
              onClick={openBindingModal}
              className="flex items-center gap-1 px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded-md hover:bg-primary/90"
            >
              <Plus className="w-4 h-4" />
              添加绑定
            </button>
          </div>

          {bindings.length === 0 ? (
            <div className="p-8 text-center border border-dashed border-border rounded-lg">
              <p className="text-muted-foreground">暂无店铺绑定</p>
              <p className="text-sm text-muted-foreground mt-1">点击上方按钮添加店铺与坐席的绑定关系</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium">店铺</th>
                    <th className="px-4 py-2 text-left font-medium">坐席</th>
                    <th className="px-4 py-2 text-left font-medium">优先级</th>
                    <th className="px-4 py-2 text-right font-medium">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bindings.map(binding => (
                    <tr key={binding.id} className="hover:bg-muted/30">
                      <td className="px-4 py-2">{binding.shop_name || binding.shop_id}</td>
                      <td className="px-4 py-2">{binding.user_name || binding.user_email || binding.user_id}</td>
                      <td className="px-4 py-2">{binding.priority}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => handleDeleteBinding(binding.id)}
                          className="p-1.5 text-red-600 hover:bg-red-50 rounded-md"
                          title="删除"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* Agent Status Monitor */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium">坐席监控</h3>
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-1 px-3 py-1.5 text-sm border border-border rounded-md hover:bg-muted/50 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            刷新
          </button>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-5 gap-4 mb-4">
          <div className="p-3 bg-muted/30 rounded-lg text-center">
            <div className="text-2xl font-bold">{summary.total}</div>
            <div className="text-xs text-muted-foreground">总坐席</div>
          </div>
          <div className="p-3 bg-green-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-green-600">{summary.online}</div>
            <div className="text-xs text-green-600">在线</div>
          </div>
          <div className="p-3 bg-yellow-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-yellow-600">{summary.away}</div>
            <div className="text-xs text-yellow-600">暂离</div>
          </div>
          <div className="p-3 bg-red-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-red-600">{summary.offline}</div>
            <div className="text-xs text-red-600">离线</div>
          </div>
          <div className="p-3 bg-gray-50 rounded-lg text-center">
            <div className="text-2xl font-bold text-gray-500">{summary.disconnected}</div>
            <div className="text-xs text-gray-500">未连接</div>
          </div>
        </div>

        {/* Agent Table */}
        {agents.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-border rounded-lg">
            <p className="text-muted-foreground">暂无坐席数据</p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">坐席名</th>
                  <th className="px-4 py-2 text-left font-medium">状态</th>
                  <th className="px-4 py-2 text-center font-medium">当前会话</th>
                  <th className="px-4 py-2 text-center font-medium">今日接待</th>
                  <th className="px-4 py-2 text-center font-medium">今日分配</th>
                  <th className="px-4 py-2 text-left font-medium">最后活跃</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {agents.map(agent => (
                  <tr key={agent.user_id} className="hover:bg-muted/30">
                    <td className="px-4 py-2">
                      <div className="font-medium">{agent.name}</div>
                      <div className="text-xs text-muted-foreground">{agent.email}</div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${getStatusColor(agent.status).replace('text-', 'bg-')}`} />
                        {getStatusBadge(agent.status)}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center font-medium">
                      {agent.status === 'disconnected' ? '-' : agent.current_conversations}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {agent.status === 'disconnected' ? '-' : agent.today_completed}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {agent.status === 'disconnected' ? '-' : agent.today_assigned}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {agent.last_active_at
                        ? new Date(agent.last_active_at).toLocaleString('zh-CN', {
                            month: '2-digit',
                            day: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Binding Modal */}
      {showBindingModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background rounded-lg shadow-lg w-full max-w-md p-6">
            <h3 className="text-lg font-medium mb-4">添加店铺-坐席绑定</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">店铺</label>
                <select
                  value={bindingShopId}
                  onChange={e => setBindingShopId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="">选择店铺</option>
                  {shops.map(shop => (
                    <option key={shop.id} value={shop.id}>{shop.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">坐席</label>
                <select
                  value={bindingUserId}
                  onChange={e => setBindingUserId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  <option value="">选择坐席</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">优先级</label>
                <input
                  type="number"
                  value={bindingPriority}
                  onChange={e => setBindingPriority(parseInt(e.target.value) || 0)}
                  className="w-full px-3 py-2 border rounded-md"
                />
                <p className="text-xs text-muted-foreground mt-1">数字越小优先级越高</p>
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6">
              <button
                onClick={closeBindingModal}
                className="px-4 py-2 border rounded-md hover:bg-muted/50"
              >
                取消
              </button>
              <button
                onClick={handleSaveBinding}
                disabled={savingBinding}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50"
              >
                {savingBinding ? <Loader2 className="w-4 h-4 animate-spin inline mr-1" /> : null}
                {savingBinding ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
