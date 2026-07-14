'use client';

import { useState } from 'react';
import { Plus, Trash2, ToggleLeft, ToggleRight, Edit3, Store, Users, UserCheck, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import ShopCreateWizard from './shop-create-wizard';
import type { Shop, ShopStats } from './types';
import { useConfirmDialog } from '@/components/common/confirm-dialog';

interface ShopSettingsProps {
  shops: Shop[];
  shopStats: ShopStats;
  onShopsChange: React.Dispatch<React.SetStateAction<Shop[]>>;
  onShopStatsChange: React.Dispatch<React.SetStateAction<ShopStats>>;
  onDataRefresh: () => void;
}

export function ShopSettings({ shops, shopStats, onShopsChange, onShopStatsChange, onDataRefresh }: ShopSettingsProps) {
  const [showShopWizard, setShowShopWizard] = useState(false);
  const [editingShopId, setEditingShopId] = useState<string | null>(null);
  const [editShop, setEditShop] = useState<{
    name: string;
    platform: string;
    shop_url: string;
    total_accounts: number;
    contact_name: string;
    contact_phone: string;
    remark: string;
    config: Record<string, unknown>;
    knowledge_ids: string[];
  } | null>(null);

  // Confirm dialog
  const { confirm } = useConfirmDialog();

  const handleDeleteShop = async (id: string) => {
    const confirmed = await confirm({
      title: '删除店铺',
      description: '确定删除此店铺？删除后，与该店铺关联的客服账号也将被删除，此操作不可撤销。',
      confirmText: '删除',
      cancelText: '取消',
      destructive: true,
    });
    if (!confirmed) return;
    try {
      const res = await fetch(`/api/shops/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const deleted = shops.find((s) => s.id === id);
        onShopsChange((prev) => prev.filter((s) => s.id !== id));
        if (deleted) {
          onShopStatsChange((prev) => ({
            total: prev.total - 1,
            totalAccounts: prev.totalAccounts - deleted.total_accounts,
            usedAccounts: prev.usedAccounts - deleted.used_accounts,
            availableAccounts: prev.availableAccounts - (deleted.total_accounts - deleted.used_accounts),
          }));
        }
        toast.success('店铺已删除');
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || '删除店铺失败');
      }
    } catch {
      toast.error('删除店铺失败，请检查网络连接');
    }
  };

  const handleToggleShopStatus = async (id: string, currentStatus: string) => {
    const newStatus = currentStatus === 'active' ? 'disabled' : 'active';
    try {
      const res = await fetch(`/api/shops/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (data.shop) {
        onShopsChange((prev) => prev.map((s) => (s.id === id ? { ...s, status: newStatus } : s)));
        toast.success(newStatus === 'active' ? '店铺已启用' : '店铺已禁用');
      }
    } catch {
      toast.error('操作失败');
    }
  };

  const handleUpdateShop = async () => {
    if (!editingShopId || !editShop) return;
    try {
      const res = await fetch(`/api/shops/${editingShopId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: editShop.name,
          platform: editShop.platform,
          shop_url: editShop.shop_url || null,
          total_accounts: editShop.total_accounts,
          contact_name: editShop.contact_name || null,
          contact_phone: editShop.contact_phone || null,
          remark: editShop.remark || null,
          config: editShop.config || {},
          knowledge_ids: editShop.knowledge_ids || [],
        }),
      });
      const data = await res.json();
      if (data.shop) {
        const oldShop = shops.find((s) => s.id === editingShopId);
        onShopsChange((prev) => prev.map((s) => (s.id === editingShopId ? { ...s, ...data.shop } : s)));
        if (oldShop) {
          const accountsDiff = (editShop.total_accounts || 0) - oldShop.total_accounts;
          if (accountsDiff !== 0) {
            onShopStatsChange((prev) => ({
              ...prev,
              totalAccounts: prev.totalAccounts + accountsDiff,
              availableAccounts: prev.availableAccounts + accountsDiff,
            }));
          }
        }
        setEditingShopId(null);
        setEditShop(null);
        toast.success('店铺更新成功');
      }
    } catch {
      toast.error('更新店铺失败');
    }
  };

  const startEditShop = (shop: Shop) => {
    setEditingShopId(shop.id);
    setEditShop({
      name: shop.name,
      platform: shop.platform,
      shop_url: shop.shop_url || '',
      total_accounts: shop.total_accounts,
      contact_name: shop.contact_name || '',
      contact_phone: shop.contact_phone || '',
      remark: shop.remark || '',
      config: (shop.config as Record<string, unknown>) || {},
      knowledge_ids: (shop.knowledge_ids as string[]) || [],
    });
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">店铺管理</h2>
          <p className="text-xs text-muted-foreground mt-0.5">管理您的店铺和客服账号使用情况</p>
        </div>
        <button
          onClick={() => setShowShopWizard(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          添加店铺
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">店铺总数</div>
              <div className="text-2xl font-bold text-foreground mt-1">{shopStats.total}</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Store className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">总账号数</div>
              <div className="text-2xl font-bold text-foreground mt-1">{shopStats.totalAccounts}</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Users className="w-5 h-5 text-amber-500" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">可用账号</div>
              <div className="text-2xl font-bold text-foreground mt-1">{shopStats.availableAccounts}</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
              <UserCheck className="w-5 h-5 text-emerald-500" />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground">已用账号</div>
              <div className="text-2xl font-bold text-foreground mt-1">{shopStats.usedAccounts}</div>
            </div>
            <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <RefreshCw className="w-5 h-5 text-blue-500" />
            </div>
          </div>
        </div>
      </div>

      {/* Shop List */}
      {shops.length > 0 ? (
        <div className="space-y-3">
          {shops.map((shop) => (
            <div key={shop.id} className="rounded-xl border border-border bg-card p-4">
              {editingShopId === shop.id && editShop ? (
                /* Edit Mode */
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">店铺名称</label>
                      <input
                        type="text"
                        value={editShop.name}
                        onChange={(e) => setEditShop((p) => p ? { ...p, name: e.target.value } : p)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">平台</label>
                      <div className="flex gap-2">
                        {['qianniu', 'doudian'].map((p) => (
                          <button
                            key={p}
                            onClick={() => setEditShop((prev) => prev ? { ...prev, platform: p } : prev)}
                            className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg border border-border transition-colors flex-1 ${
                              editShop.platform === p
                                ? 'border-primary bg-primary/10 text-primary font-medium'
                                : 'bg-muted text-muted-foreground hover:bg-muted/80'
                            }`}
                          >
                            <span className="text-base">{p === 'qianniu' ? '💬' : '🛒'}</span>
                            {p === 'qianniu' ? '千牛' : '抖店'}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">店铺链接</label>
                      <input
                        type="text"
                        value={editShop.shop_url}
                        onChange={(e) => setEditShop((p) => p ? { ...p, shop_url: e.target.value } : p)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                        placeholder="https://..."
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">账号配额</label>
                      <input
                        type="number"
                        min={0}
                        value={editShop.total_accounts}
                        onChange={(e) => setEditShop((p) => p ? { ...p, total_accounts: parseInt(e.target.value) || 0 } : p)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">联系人</label>
                      <input
                        type="text"
                        value={editShop.contact_name}
                        onChange={(e) => setEditShop((p) => p ? { ...p, contact_name: e.target.value } : p)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                        placeholder="联系人姓名"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">联系电话</label>
                      <input
                        type="text"
                        value={editShop.contact_phone}
                        onChange={(e) => setEditShop((p) => p ? { ...p, contact_phone: e.target.value } : p)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                        placeholder="联系电话"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">备注</label>
                    <textarea
                      value={editShop.remark}
                      onChange={(e) => setEditShop((p) => p ? { ...p, remark: e.target.value } : p)}
                      className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-muted"
                      rows={2}
                      placeholder="备注信息"
                    />
                  </div>
                  {/* Config editing section */}
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium mb-1.5">发货地</label>
                      <input
                        type="text"
                        value={String((editShop.config as Record<string, unknown> | undefined)?.shipping_origin || '')}
                        onChange={(e) => setEditShop((p) => p ? { ...p, config: { ...p.config as Record<string, unknown>, shipping_origin: e.target.value } } : p)}
                        className="w-full px-3 py-2 text-sm rounded-lg border border-border bg-background"
                        placeholder="如: 杭州"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1.5">包邮策略</label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { value: 'all_free', label: '全店包邮' },
                          { value: 'threshold_free', label: '满额包邮' },
                          { value: 'no_free', label: '不包邮' },
                          { value: 'remote_no_free', label: '偏远不包邮' },
                          { value: 'by_product', label: '按商品' },
                        ].map((opt) => (
                          <label key={opt.value} className="flex items-center gap-1.5 text-xs cursor-pointer">
                            <input
                              type="radio"
                              name={`shipping_policy_${editingShopId}`}
                              value={opt.value}
                              checked={(editShop.config as Record<string, unknown> | undefined)?.shipping_policy === opt.value}
                              onChange={() => setEditShop((p) => p ? { ...p, config: { ...p.config as Record<string, unknown>, shipping_policy: opt.value } } : p)}
                              className="accent-primary"
                            />
                            {opt.label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`7days_${editingShopId}`}
                        checked={Boolean((editShop.config as Record<string, unknown> | undefined)?.return_policy_7days)}
                        onChange={(e) => setEditShop((p) => p ? { ...p, config: { ...p.config as Record<string, unknown>, return_policy_7days: e.target.checked } } : p)}
                        className="accent-primary"
                      />
                      <label htmlFor={`7days_${editingShopId}`} className="text-xs">7天无理由退换</label>
                    </div>
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button
                      onClick={() => { setEditingShopId(null); setEditShop(null); }}
                      className="px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors"
                    >
                      取消
                    </button>
                    <button
                      onClick={handleUpdateShop}
                      disabled={!editShop.name.trim()}
                      className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                /* Display Mode */
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-base">
                      {shop.platform === 'qianniu' ? '💬' : shop.platform === 'doudian' ? '🛒' : '🏪'}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{shop.name}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium ${
                          shop.status === 'active'
                            ? 'bg-emerald-200 text-emerald-700 dark:text-emerald-400'
                            : 'bg-muted text-muted-foreground'
                        }`}>
                          {shop.status === 'active' ? '启用' : '禁用'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span>{shop.platform === 'qianniu' ? '千牛' : shop.platform === 'doudian' ? '抖店' : shop.platform}</span>
                        {shop.contact_name && <span>联系人: {shop.contact_name}</span>}
                        <span>账号: {shop.used_accounts}/{shop.total_accounts}</span>
                        {shop.created_at && <span>添加于 {new Date(shop.created_at).toLocaleDateString()}</span>}
                        {(() => {
                              const _v = (shop.config as Record<string, unknown>)?.shipping_origin;
                              return _v ? (
                                <span className="px-1.5 py-0.5 rounded bg-muted text-[10px]">
                                  📍 {(shop.config as Record<string, unknown>).shipping_origin as string}
                                </span>
                              ) : null;
                            })()}
                        {(() => {
                              const _v = (shop.config as Record<string, unknown>)?.shipping_policy as string | undefined;
                              return _v ? (
                                <span className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 dark:text-blue-400 text-[10px]">
                                  包邮: {(() => {
                                    const sp = ((shop.config as Record<string, unknown>)?.shipping_policy as string) || '';
                                    const map: Record<string, string> = {
                                      all_free: '全店包邮', threshold_free: '满额包邮', no_free: '不包邮',
                                      remote_no_free: '偏远不包邮', by_product: '按商品',
                                    };
                                    return map[sp] || sp;
                                  })()}
                                </span>
                              ) : null;
                            })()}
                        {(() => {
                              const _v = (shop.config as Record<string, unknown>)?.return_policy_7days;
                              return _v ? (
                                <span className="px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-700 dark:text-emerald-400 text-[10px]">
                                  7天退换 ✓
                                </span>
                              ) : null;
                            })()}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {/* Account usage bar */}
                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden" title={`已用 ${shop.used_accounts}/${shop.total_accounts} 个账号`}>
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: shop.total_accounts > 0 ? `${Math.min((shop.used_accounts / shop.total_accounts) * 100, 100)}%` : '0%' }}
                      />
                    </div>
                    <button
                      onClick={() => handleToggleShopStatus(shop.id, shop.status)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title={shop.status === 'active' ? '禁用' : '启用'}
                    >
                      {shop.status === 'active' ? <ToggleRight className="w-4 h-4 text-primary" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => startEditShop(shop)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                      title="编辑"
                    >
                      <Edit3 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteShop(shop.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="删除"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        /* Empty State */
        <div className="flex flex-col items-center justify-center py-16">
          <div
            className="w-48 h-40 rounded-xl border-2 border-dashed border-border flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            onClick={() => setShowShopWizard(true)}
          >
            <div className="w-10 h-10 rounded-full bg-primary flex items-center justify-center">
              <Plus className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="text-center">
              <div className="text-sm font-medium text-foreground">添加店铺</div>
              <div className="text-xs text-muted-foreground mt-0.5">点击创建新店铺</div>
            </div>
          </div>
        </div>
      )}

      <ShopCreateWizard
        open={showShopWizard}
        onClose={() => setShowShopWizard(false)}
        onSuccess={onDataRefresh}
      />
    </section>
  );
}
